import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { CanvasNode } from "../src/components/canvas/canvas-node";
import { NodeCreateMenu } from "../src/components/canvas/canvas-create-menus";
import { ConnectionPath } from "../src/components/canvas/canvas-connections";
import { CanvasNodeContextMenu } from "../src/components/canvas/canvas-context-menu";
import { useImageEditorViewport } from "../src/components/canvas/use-image-editor-viewport";
import { dxosNodeDefinitions } from "../src/components/canvas/nodes/dxos-workflow-nodes";
import { registerNodeDefinitions } from "../src/lib/canvas/node-registry";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { arrangeGrid } from "../src/lib/canvas/canvas-grid-layout";
import { canvasDownloadMimeType, canvasDownloadName } from "../src/lib/canvas/canvas-download-name";
import { TABLE_TYPE, CONCURRENT_TYPE, emptyTable } from "../src/lib/canvas/dxos-table";
import { computeMediaSize, mediaRatioOptions, mediaScaleOptions } from "../src/lib/media-size";
import { defaultConfig } from "../src/stores/use-config-store";
import { relayImageInput } from "../src/services/api/relay-tasks";
import type { CanvasNodeData, ViewportTransform } from "../src/types/canvas";
import type { CanvasPluginHost } from "../src/types/canvas-plugin";

registerNodeDefinitions([...dxosNodeDefinitions, ...["image", "text", "video", "group"].map((type) => ({ type, title: type, icon: null, defaultSize: { width: 300, height: 240 } }))]);
const no = () => {};
const makeNode = (id: string, type = "image", metadata = {}): CanvasNodeData => ({ id, type, title: `节点-${id}`, width: 300, height: 240, position: { x: 40, y: 80 }, metadata });
const passed: string[] = [];
async function test(name: string, work: () => Promise<void> | void) { await work(); passed.push(name); console.log(`PASS ${name}`); }
const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(1); }); }
const mouse = (type: string, options = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options });
const pointer = (type: string, options = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, ...options });
async function down(target: EventTarget, options = {}) { await fire(target, pointer("pointerdown", options)); await fire(target, mouse("mousedown", options)); }
async function up() { await fire(window, pointer("pointerup", { buttons: 0 })); await fire(window, mouse("mouseup", { buttons: 0 })); }
async function key(type: string, target: EventTarget = window) { await fire(target, new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true, cancelable: true })); }
async function value(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, next: string) {
    const proto = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(target, next);
    await fire(target, new Event(target instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
const label = (host: HTMLElement, name: string) => { const el = host.querySelector(`[aria-label="${name}"]`); assert.ok(el, name); return el as HTMLInputElement; };
const button = (host: HTMLElement, text: string) => { const el = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text)); assert.ok(el, text); return el; };

async function mount(element: React.ReactNode) { const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); await act(async () => { root.render(element); }); return { host, root, close: async () => { await act(async () => root.unmount()); host.remove(); } }; }

const baseProps = {
    scale: 1, isSelected: false, isRelated: false, isFocusRelated: false, isConnectionTarget: false, isConnecting: false, showPanel: false, showImageInfo: false,
    onHoverStart: no, onHoverEnd: no, onConnectStart: no, onResizeStart: no, onResize: no, onResizeEnd: no, onContentChange: no, onTitleChange: no, onContextMenu: no,
};

async function gestures() {
    let viewport: ViewportTransform = { x: 12, y: 24, k: 1 }, drags = 0, clicks = 0, selects = 0;
    const ref = createRef<HTMLDivElement>();
    const node = makeNode("gesture", "text", { content: "内容" });
    function Harness() { const [v, setV] = useState(viewport); return <InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => { viewport = next; setV(next); }} onCanvasMouseDown={() => selects++}>
        <CanvasNode {...baseProps} data={node} onMouseDown={() => drags++} renderNodeContent={() => null} />
        <div data-node-id="controls" onMouseDown={() => drags++} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            <input aria-label="test-input" /><textarea /><select><option>A</option></select><button onClick={() => clicks++}>action</button><div contentEditable suppressContentEditableWarning>editable</div><div data-canvas-no-zoom>node embedded</div>
        </div><div data-canvas-overlay><button>overlay</button></div>
    </InfiniteCanvas>; }
    const ui = await mount(<Harness />);
    let rect = { left: 10, top: 20, width: 1000, height: 800 };
    ref.current!.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: no });
    const controls = [...ui.host.querySelectorAll('[data-node-id="controls"] > *'), ui.host.querySelector('[data-node-id="gesture"] button')!];
    await test("画布根和外层包裹使用非滚动裁切，焦点不会引入与viewport无关的原生滚动坐标", () => {
        assert.ok(ref.current!.classList.contains("overflow-clip"));
        assert.equal(ref.current!.classList.contains("overflow-hidden"), false);
        assert.equal(ref.current!.style.overflow, "");
        const project = readFileSync("src/pages/canvas/project.tsx", "utf8");
        assert.ok(project.includes('<main className="flex h-full min-h-0 overflow-clip"'));
        assert.ok(project.includes('<section className="relative min-w-0 flex-1 overflow-clip"'));
        assert.equal(/<(?:main|section) className="[^"]*overflow-(?:hidden|auto|scroll)/.test(project), false);
    });
    await test("空格+左键在节点输入框/文本区/选择器/按钮/编辑区/内嵌区/名称上平移且不拖节点", async () => {
        for (const control of controls) {
            const start = { ...viewport };
            await key("keydown"); await down(control, { clientX: 100, clientY: 120 });
            await fire(window, pointer("pointermove", { clientX: 170, clientY: 150 }));
            await act(async () => { await tick(); });
            await up(); await fire(control, mouse("click")); await key("keyup");
            assert.equal(viewport.x, start.x + 70); assert.equal(viewport.y, start.y + 30); assert.equal(viewport.k, start.k);
            assert.equal(drags, 0); assert.equal(clicks, 0); assert.equal(selects, 0);
            assert.deepEqual(node.position, { x: 40, y: 80 });
        }
    });
    await test("滚轮悬停所有节点控件仍以鼠标点为中心缩放且不移动节点", async () => {
        for (const control of controls) {
            const start = { ...viewport }, worldX = (200 - 10 - start.x) / start.k, worldY = (180 - 20 - start.y) / start.k;
            const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 200, clientY: 180 });
            await fire(control, event);
            assert.ok(event.defaultPrevented); assert.ok(viewport.k > start.k);
            assert.ok(Math.abs((190 - viewport.x) / viewport.k - worldX) < 1e-8); assert.ok(Math.abs((160 - viewport.y) / viewport.k - worldY) < 1e-8);
            assert.equal(drags, 0); assert.deepEqual(node.position, { x: 40, y: 80 });
        }
    });
    await test("同一渲染批次的连续滚轮累计缩放，不丢失高频滚轮事件", async () => {
        const start = { ...viewport };
        await act(async () => { for (let i = 0; i < 3; i++) controls[0].dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10, clientX: 200, clientY: 180 })); });
        assert.ok(Math.abs(viewport.k - start.k * Math.pow(1.1, -0.3)) < 1e-8, `expected cumulative zoom ${start.k * Math.pow(1.1, -0.3)}, got ${viewport.k}`);
    });
    await test("平移尚未渲染的一帧后滚轮缩放不被旧帧覆写，后续平移保持新缩放", async () => {
        await key("keydown"); await down(controls[0], { clientX: 100, clientY: 100 });
        const start = { ...viewport }; let zoomed: ViewportTransform;
        await act(async () => {
            window.dispatchEvent(pointer("pointermove", { clientX: 130, clientY: 120 }));
            controls[0].dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 180, clientY: 160 })); zoomed = { ...viewport };
            await tick(40);
        });
        assert.ok(viewport.k > start.k); assert.deepEqual(viewport, zoomed!);
        const before = { ...viewport }; await fire(window, pointer("pointermove", { clientX: 150, clientY: 130 })); await act(async () => { await tick(); });
        assert.equal(viewport.k, before.k); assert.equal(viewport.x, before.x + 20); assert.equal(viewport.y, before.y + 10);
        await up(); await key("keyup");
    });
    await test("侧栏改变容器边界后嵌套节点滚轮始终锚定鼠标世界坐标，连续事件可跨不同鼠标位置", async () => {
        const nested = document.createElement("span"); controls[3].appendChild(nested);
        const worldAt = (v: ViewportTransform, x: number, y: number) => ({ x: (x - rect.left - v.x) / v.k, y: (y - rect.top - v.y) / v.k });
        for (const bounds of [{ left: 280, top: 88, width: 920, height: 700 }, { left: 48, top: 156, width: 640, height: 500 }]) {
            rect = bounds;
            let expected = { ...viewport };
            await act(async () => {
                for (const [x, y, deltaY] of [[520, 340, -30], [620, 440, 15], [430, 380, -45]]) {
                    const world = worldAt(expected, x, y), k = Math.min(5, Math.max(0.05, expected.k * Math.pow(1.1, -deltaY / 100)));
                    expected = { x: x - rect.left - world.x * k, y: y - rect.top - world.y * k, k };
                    nested.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY }));
                }
            });
            assert.ok(Math.abs(viewport.x - expected.x) < 1e-8); assert.ok(Math.abs(viewport.y - expected.y) < 1e-8); assert.ok(Math.abs(viewport.k - expected.k) < 1e-8);
            assert.equal(drags, 0); assert.deepEqual(node.position, { x: 40, y: 80 });
        }
        nested.remove();
    });
    await test("普通左键背景进入框选、节点不误入框选，空格松开后恢复正常拖动", async () => {
        const start = { ...viewport }; await down(ref.current!, { clientX: 3, clientY: 3 }); await up(); assert.equal(selects, 1); assert.deepEqual(viewport, start);
        await down(controls[0]); await up(); assert.equal(selects, 1); assert.equal(drags, 1);
    });
    await test("输入文字时空格保留输入，失焦清除平移状态", async () => {
        const input = controls[0] as HTMLInputElement; input.focus();
        const event = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }); await fire(input, event); assert.equal(event.defaultPrevented, false);
        await down(input); await up(); assert.equal(drags, 2);
        await key("keydown"); await fire(window, new Event("blur")); await down(input); await up(); assert.equal(drags, 3);
    });
    await test("画布外浮层滚动不被画布缩放接管", async () => {
        const start = { ...viewport }, overlay = ui.host.querySelector("[data-canvas-overlay]")!;
        // Popover/dropdown/modal are deliberately excluded from zoom; ordinary toolbar overlay does not trap wheel.
        overlay.classList.add("ant-popover"); const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }); await fire(overlay, event);
        assert.deepEqual(viewport, start); assert.equal(event.defaultPrevented, false);
    });
    await ui.close();
}

async function workflows() {
    const table = makeNode("table", TABLE_TYPE, { table: { ...emptyTable(), rows: [["翻译英文", "商品图"]] }, tableInputChannels: [{ id: "input-1" }] });
    const image = makeNode("reference", "image", { content: "https://example.test/reference.png", status: "success" });
    const concurrent = makeNode("batch", CONCURRENT_TYPE, { generationMode: "image", tableBatchConcurrency: 1 });
    let state: CanvasAgentSnapshot = { projectId: "test", title: "test", nodes: [table, image, concurrent], connections: [{ id: "ref-input", fromNodeId: image.id, toNodeId: table.id, toPort: "input-1" }, { id: "table-batch", fromNodeId: table.id, toNodeId: concurrent.id }], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    let render: () => void = no, drags: string[] = [], models: string[] = [], calls: { mode: string; prompt: string; options: any }[] = [];
    let imageWork = async (_options: any) => ({ images: ["data:image/png;base64,AA=="] });
    const host: CanvasPluginHost = {
        getNode: (id) => state.nodes.find((n) => n.id === id) || null, getNodes: () => state.nodes, getConnections: () => state.connections, getUpstream: () => [], getDownstream: () => [],
        updateNode: (id, patch) => { state = applyCanvasAgentOps(state, [{ type: "update_node", id, patch }]); render(); },
        updateMetadata: (id, patch) => { state = applyCanvasAgentOps(state, [{ type: "update_node", id, metadata: patch }]); render(); },
        applyOps: (ops) => { state = applyCanvasAgentOps(state, ops); render(); }, openPanel: no, closePanel: no,
        ai: { listModels: (mode) => { models.push(mode || ""); return [{ value: `${mode}-relay:model`, label: `${mode} 测试模型` }]; }, defaultModel: (mode) => `${mode}-default`, generateImage: async (prompt, options) => { calls.push({ mode: "image", prompt, options }); return imageWork(options); }, generateText: async (prompt, options) => { calls.push({ mode: "text", prompt, options }); return { text: "English" }; }, generateVideo: async (prompt, options) => { calls.push({ mode: "video", prompt, options }); return { url: "https://example.test/output.mp4", mimeType: "video/mp4" }; } },
    };
    let viewport: ViewportTransform = { x: 0, y: 0, k: 1 };
    const canvasRef = createRef<HTMLDivElement>();
    function Harness() { const [, setVersion] = useState(0), [v, setV] = useState(viewport); render = () => setVersion((n) => n + 1); return <InfiniteCanvas containerRef={canvasRef} viewport={v} tool="select" onViewportChange={(next) => { viewport = next; setV(next); }}>{[table.id, concurrent.id].map((id) => <CanvasNode key={id} {...baseProps} data={host.getNode(id)!} pluginHost={host} onMouseDown={(_, id) => drags.push(id)} onTitleChange={(id, title) => host.updateNode(id, { title })} />)}</InfiniteCanvas>; }
    const ui = await mount(<Harness />), tableEl = () => ui.host.querySelector(`[data-node-id="${table.id}"]`)! as HTMLElement, batchEl = () => ui.host.querySelector(`[data-node-id="${concurrent.id}"]`)! as HTMLElement;
    await test("真实表格/并发节点的单元格、模型、尺寸、运行按钮上空格平移和滚轮缩放均不拖动或点击节点", async () => {
        const positions = state.nodes.map((n) => ({ ...n.position }));
        for (const el of [label(tableEl(), "第 1 行第 1 字段"), label(tableEl(), "输入 1 配对方式"), label(batchEl(), "模型与中转站"), label(batchEl(), "生成分辨率"), label(batchEl(), "附加提示词"), button(batchEl(), "▶ 运行"), tableEl().querySelector("[data-node-drag-handle]")!, batchEl().querySelector("[data-node-drag-handle]")!]) {
            const start = { ...viewport }; await key("keydown"); await down(el, { clientX: 100, clientY: 100 }); await fire(window, pointer("pointermove", { clientX: 150, clientY: 130 })); await act(async () => { await tick(); }); await up(); await fire(el, mouse("click")); await key("keyup");
            assert.equal(viewport.x, start.x + 50); assert.equal(viewport.y, start.y + 30); assert.equal(drags.length, 0); assert.equal(calls.length, 0);
            const scale = viewport.k; await fire(el, new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 100, clientY: 100 })); assert.ok(viewport.k > scale); assert.equal(drags.length, 0); assert.deepEqual(state.nodes.map((n) => n.position), positions);
        }
    });
    await test("表格与并发节点的标题句柄可拖动，输入编辑不触发父拖动", async () => {
        for (const el of [tableEl(), batchEl()]) { await down(el.querySelector("[data-node-drag-handle]")!); await up(); }
        assert.deepEqual(drags, [table.id, concurrent.id]);
        for (const el of [label(tableEl(), "字段 1 名称"), label(tableEl(), "第 1 行第 1 字段"), label(batchEl(), "模型与中转站"), label(batchEl(), "生成分辨率"), label(batchEl(), "附加提示词")]) { await down(el); await up(); }
        assert.deepEqual(drags, [table.id, concurrent.id]);
        await value(label(tableEl(), "第 1 行第 1 字段"), "翻译成英文"); assert.equal(host.getNode(table.id)!.metadata!.table!.rows[0][0], "翻译成英文");
    });
    await test("移除重复尺寸输入，1K/2K/4K/AUTO 与全部比例共同计算原生任务尺寸且覆盖旧自定义尺寸", async () => {
        assert.equal(batchEl().querySelector('[aria-label="自定义生成尺寸"]'), null);
        for (const scale of mediaScaleOptions) for (const { value: ratio } of mediaRatioOptions.filter((r) => r.value !== "auto")) {
            await act(async () => host.updateMetadata(concurrent.id, { size: "1700x1100" }));
            await value(label(batchEl(), "生成比例"), ratio);
            await value(label(batchEl(), "生成分辨率"), scale);
            const size = computeMediaSize(scale, ratio);
            assert.equal(host.getNode(concurrent.id)!.metadata!.size, size, `${scale} ${ratio}`);
            assert.equal(label(batchEl(), "生成比例").value, ratio); assert.equal(label(batchEl(), "生成分辨率").value, scale);
            assert.equal(relayImageInput({ ...defaultConfig, size }, "尺寸验收", []).input.size, size);
            await act(async () => host.updateMetadata(concurrent.id, { size: "1700x1100" }));
            await value(label(batchEl(), "生成分辨率"), scale); await value(label(batchEl(), "生成比例"), ratio);
            assert.equal(host.getNode(concurrent.id)!.metadata!.size, size, `resolution first: ${scale} ${ratio}`);
        }
        await value(label(batchEl(), "生成比例"), "auto");
        assert.equal(host.getNode(concurrent.id)!.metadata!.size, "auto");
        assert.equal(relayImageInput({ ...defaultConfig, size: "auto" }, "尺寸验收", []).input.size, undefined);
        await value(label(batchEl(), "生成分辨率"), "1k");
        assert.equal(host.getNode(concurrent.id)!.metadata!.size, "1024x1024");
    });
    await test("模型、比例、分辨率、质量选择写入节点元数据", async () => {
        await value(label(batchEl(), "模型与中转站"), "image-relay:model"); assert.equal(host.getNode(concurrent.id)!.metadata!.model, "image-relay:model");
        await value(label(batchEl(), "生成比例"), "16:9"); assert.equal(host.getNode(concurrent.id)!.metadata!.size, "1536x864");
        await value(label(batchEl(), "生成分辨率"), "4k"); assert.equal(host.getNode(concurrent.id)!.metadata!.size, "3840x2160");
        await value(label(batchEl(), "生成质量"), "high"); await value(label(batchEl(), "附加提示词"), "保持构图");
    });
    await test("并发运行传递所选图像模型/尺寸/质量/参考图，结果节点成功落图与连线", async () => {
        await fire(button(batchEl(), "▶ 运行"), mouse("click")); await act(async () => { await tick(); });
        assert.equal(calls.length, 1); const call = calls[0]; assert.equal(call.mode, "image"); assert.equal(call.options.model, "image-relay:model"); assert.equal(call.options.size, "3840x2160"); assert.equal(call.options.quality, "high"); assert.deepEqual(call.options.references, [image.metadata!.content]); assert.ok(call.options.signal instanceof AbortSignal); assert.equal(call.options.count, 1); assert.ok(call.prompt.includes("翻译成英文")); assert.ok(call.prompt.includes("保持构图"));
        const run = host.getNode(concurrent.id)!.metadata!.tableBatchRun!; assert.equal(run.state, "completed"); assert.equal(run.tasks[0].status, "success"); const output = host.getNode(run.tasks[0].outputIds[0])!; assert.equal(output.metadata!.status, "success"); assert.ok(state.connections.some((c) => c.fromNodeId === concurrent.id && c.toNodeId === output.id));
    });
    await test("切换文本/视频后按对应能力展示模型，视频时长与尺寸传入生成", async () => {
        await value(label(batchEl(), "生成类型"), "text"); assert.equal(host.getNode(concurrent.id)!.metadata!.model, undefined); assert.equal(batchEl().querySelector('[aria-label="生成比例"]'), null); assert.ok(models.includes("text"));
        await value(label(batchEl(), "模型与中转站"), "text-relay:model"); await fire(button(batchEl(), "▶ 运行"), mouse("click")); await act(async () => { await tick(); }); assert.equal(calls.at(-1)!.options.model, "text-relay:model"); assert.equal(calls.at(-1)!.mode, "text");
        await value(label(batchEl(), "生成类型"), "video"); await value(label(batchEl(), "模型与中转站"), "video-relay:model"); await value(label(batchEl(), "视频时长"), "8"); await value(label(batchEl(), "生成比例"), "9:16"); assert.equal(batchEl().querySelector('[aria-label="自定义生成尺寸"]'), null); await fire(button(batchEl(), "▶ 运行"), mouse("click")); await act(async () => { await tick(); }); assert.equal(calls.at(-1)!.mode, "video"); assert.equal(calls.at(-1)!.options.seconds, "8"); assert.equal(calls.at(-1)!.options.size, "2160x3840");
    });
    await test("运行时配置锁定、停止中断当前任务，重试未完成行可恢复成功", async () => {
        await value(label(batchEl(), "生成类型"), "image");
        imageWork = (options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => reject(new Error("测试停止")), { once: true }); });
        await fire(button(batchEl(), "▶ 运行"), mouse("click"));
        for (const name of ["生成类型", "模型与中转站", "生成比例", "生成分辨率", "生成质量", "并发数"]) assert.equal(label(batchEl(), name).disabled, true, name);
        await fire(button(batchEl(), "停止"), mouse("click")); await act(async () => { await tick(); });
        assert.equal(host.getNode(concurrent.id)!.metadata!.tableBatchRun!.state, "stopped"); assert.equal(host.getNode(concurrent.id)!.metadata!.tableBatchRun!.tasks[0].status, "stopped"); assert.equal(calls.at(-1)!.options.signal.aborted, true);
        imageWork = async () => ({ images: ["data:image/png;base64,AA=="] }); await fire(button(batchEl(), "重试未完成行"), mouse("click")); await act(async () => { await tick(); }); assert.equal(host.getNode(concurrent.id)!.metadata!.tableBatchRun!.tasks[0].status, "success"); assert.equal(label(batchEl(), "模型与中转站").disabled, false);
    });
    await test("节点名称未选中/未悬停常显，双击名称编辑并保存", async () => {
        for (const el of [tableEl(), batchEl()]) {
            const title = el.querySelector("button")!; assert.ok(title.textContent?.startsWith("节点-")); assert.ok(!title.className.includes("opacity-0")); assert.ok(!title.parentElement!.className.includes("hidden"));
            await fire(title, mouse("dblclick")); const input = label(el, "节点名称"); await value(input, `已重命名-${el.dataset.nodeId}`); await fire(input, new KeyboardEvent("keydown", { bubbles: true, key: "Enter" })); assert.equal(host.getNode(el.dataset.nodeId!)!.title, `已重命名-${el.dataset.nodeId}`); assert.equal(el.querySelector('[aria-label="节点名称"]'), null);
        }
    });
    await test("表格的一键连接并发节点创建真实节点与输出连线", async () => {
        const before = state.nodes.length; await fire(button(tableEl(), "连接并发节点"), mouse("click")); assert.equal(state.nodes.length, before + 1); const added = state.nodes.at(-1)!; assert.equal(added.type, CONCURRENT_TYPE); assert.ok(state.connections.some((c) => c.fromNodeId === table.id && c.toNodeId === added.id));
    });
    await ui.close();
}

async function layout() {
    await test("宫格按列/间距排版，分组子项保持偏移，全部连线与图片尺寸不变", () => {
        const group = { ...makeNode("group", "group"), position: { x: 400, y: 400 }, width: 400, height: 350 };
        const child = { ...makeNode("child", "image", { groupId: group.id, content: "image" }), position: { x: 450, y: 460 } };
        const a = { ...makeNode("a"), position: { x: 80, y: 120 }, width: 200, height: 100 };
        const b = { ...makeNode("b"), position: { x: 980, y: 760 }, width: 300, height: 200 };
        const untouched = makeNode("untouched"); const nodes = [a, group, child, b, untouched], copy = structuredClone(nodes), connections = [{ id: "keep", fromNodeId: child.id, toNodeId: b.id }], selected = new Set([a.id, group.id, child.id, b.id]);
        const next = arrangeGrid(nodes, selected, 2, 40);
        assert.deepEqual(next[0].position, { x: 80, y: 120 }); assert.deepEqual(next[1].position, { x: 420, y: 120 }); assert.deepEqual(next[2].position, { x: 470, y: 180 }); assert.deepEqual(next[3].position, { x: 80, y: 538 }); assert.equal(next[4], untouched);
        next.forEach((n, i) => { assert.equal(n.width, nodes[i].width); assert.equal(n.height, nodes[i].height); assert.deepEqual(n.metadata, nodes[i].metadata); }); assert.deepEqual(nodes, copy); assert.deepEqual(connections, [{ id: "keep", fromNodeId: "child", toNodeId: "b" }]); assert.equal(arrangeGrid(nodes, new Set(), 2, 40), nodes);
    });
    await test("宫格移动嵌套组的全部后代，祖组与孙节点同时选中不拆散", () => {
        const a = { ...makeNode("outside"), position: { x: 0, y: 0 } };
        const top = { ...makeNode("top", "group"), position: { x: 600, y: 600 }, width: 600, height: 500 };
        const sub = { ...makeNode("sub", "group", { groupId: top.id }), position: { x: 650, y: 680 } };
        const leaf = { ...makeNode("leaf", "image", { groupId: sub.id }), position: { x: 680, y: 720 } };
        for (const selected of [new Set([a.id, top.id]), new Set([a.id, top.id, leaf.id]), new Set([a.id, top.id, sub.id, leaf.id])]) {
            const next = arrangeGrid([a, top, sub, leaf], selected, 2, 40), d = { x: next[1].position.x - top.position.x, y: next[1].position.y - top.position.y };
            assert.deepEqual(next[2].position, { x: sub.position.x + d.x, y: sub.position.y + d.y }); assert.deepEqual(next[3].position, { x: leaf.position.x + d.x, y: leaf.position.y + d.y }); assert.deepEqual(next[1].position, { x: 340, y: 0 });
        }
        const invalid = makeNode("cycle", "group", { groupId: "cycle" }); assert.doesNotThrow(() => arrangeGrid([a, invalid], new Set([a.id, invalid.id]), 2, 40));
    });
    await test("下载沿用重命名并按真实 MIME/URL 选择后缀，单图和批次不重复扩展名", () => {
        assert.equal(canvasDownloadName("商品图", "blob:http://localhost/1", "image/jpeg", "png"), "商品图.jpg");
        assert.equal(canvasDownloadName("logo.png", "data:image/png;base64,AA==", undefined, "png"), "logo.png");
        assert.equal(canvasDownloadName("logo.JPG", "blob:http://localhost/1", "image/jpeg", "png"), "logo.jpg");
        assert.equal(canvasDownloadName("修改后的名称.png", "blob:http://localhost/1", "image/webp", "png", 2), "修改后的名称-2.webp");
        assert.equal(canvasDownloadName("产品 v2.1", "https://example.test/a.jpeg?signature=1#x", undefined, "png"), "产品 v2.1.jpg");
        assert.equal(canvasDownloadName("对话截图", "data:image/svg+xml;base64,AA==", undefined, "png"), "对话截图.svg");
        assert.equal(canvasDownloadName("a<>:\"/\\|?*\x01", "x", "image/png", "png"), "a__________.png");
        assert.equal(canvasDownloadName("NUL.txt", "x", "image/png", "png"), "_NUL.txt.png");
        assert.equal(canvasDownloadName(" . ", "x", undefined, "png"), "image.png");
        assert.equal(canvasDownloadName("视频.mov", "blob:x", "video/quicktime", "mp4"), "视频.mov");
        assert.equal(canvasDownloadName("语音.wav", "blob:x", "audio/mpeg", "mp3"), "语音.mp3");
    });
    await test("旧 blob 缺少 MIME 时读取原 blob.type，已有 MIME/远程链接不额外请求、不改图片内容", async () => {
        const originalFetch = globalThis.fetch, bytes = new Uint8Array([1, 2, 3]); let requests = 0;
        globalThis.fetch = async (input) => { requests++; assert.equal(input, "blob:legacy"); return new Response(new Blob([bytes], { type: "image/jpeg" })); };
        try {
            const mime = await canvasDownloadMimeType("blob:legacy"); assert.equal(mime, "image/jpeg"); assert.equal(canvasDownloadName("重命名", "blob:legacy", mime, "png"), "重命名.jpg");
            assert.equal(await canvasDownloadMimeType("blob:legacy", "image/webp"), "image/webp"); assert.equal(await canvasDownloadMimeType("https://example.test/a.png"), undefined); assert.equal(requests, 1); assert.deepEqual([...bytes], [1, 2, 3]);
            globalThis.fetch = async () => { throw new Error("revoked blob"); }; assert.equal(await canvasDownloadMimeType("blob:deleted"), undefined);
        } finally { globalThis.fetch = originalFetch; }
    });
}

async function referenceNames() {
    await test("选择参考图模式下全部名称常显，名称禁止重命名与拖动，点击可选名称选中参考", async () => {
        for (const mode of ["available", "target", "disabled"] as const) {
            let drags = 0, renames = 0, selected = 0;
            const data = makeNode(`reference-${mode}`);
            const ui = await mount(<CanvasNode {...baseProps} data={data} referenceSelectionState={mode} onMouseDown={() => drags++} onTitleChange={() => renames++} onSelectReference={() => selected++} />);
            const title = [...ui.host.querySelectorAll("button")].find((b) => b.textContent === data.title); assert.ok(title, mode); assert.ok(!title.className.includes("opacity-0"));
            await down(title); await up(); await fire(title, mouse("dblclick"));
            assert.equal(ui.host.querySelector('[aria-label="节点名称"]'), null); assert.equal(drags, 0); assert.equal(renames, 0); assert.equal(selected, mode === "available" ? 1 : 0);
            await ui.close();
        }
    });
}


async function rightClickCreation() {
    const source = readFileSync("src/pages/canvas/project.tsx", "utf8");
    const callbackSource = source.match(/onCanvasContextMenu=\{\(event\) => \{([\s\S]*?)\}\}/)?.[1];
    const coordinatesSource = source.match(/const screenToCanvas = useCallback\(\(clientX: number, clientY: number\) => \{([\s\S]*?)\n    \}, \[\]\);/)?.[1];
    assert.ok(callbackSource, "must use the project's real blank-canvas right-click callback"); assert.ok(coordinatesSource); assert.ok(!source.includes("onCanvasDoubleClick="));
    const actualCallback = new Function("event", "referencePickerNodeId", "setContextMenu", "setNodeCreatePosition", "screenToCanvas", callbackSource);
    const coordinates = new Function("clientX", "clientY", "containerRef", "viewportRef", coordinatesSource);
    const ref = createRef<HTMLDivElement>(), viewportRef = { current: { x: 20, y: 40, k: 0.5 } };
    let referenceMode = false, blankMenus = 0, nodeMenus = 0, connectionMenus = 0, selects = 0, imagePreviews = 0, nodeMoves = 0;
    const created: { type: string; position: { x: number; y: number } }[] = [];
    const textNode = makeNode("right-text", "text", { content: "双击编辑内容" }), imageNode = makeNode("right-image", "image", { content: "https://example.test/picture.png" });
    const configNode = makeNode("right-controls", "config");
    function Harness() {
        const [position, setPosition] = useState<{ x: number; y: number } | null>(null), [menu, setMenu] = useState<any>(null);
        return <InfiniteCanvas containerRef={ref} viewport={viewportRef.current} tool="select" onViewportChange={no} onCanvasMouseDown={() => selects++} onCanvasContextMenu={(event) => actualCallback(event, referenceMode ? textNode.id : null, setMenu, (next: { x: number; y: number }) => { blankMenus++; setPosition(next); }, (x: number, y: number) => coordinates(x, y, ref, viewportRef))}>
            {[textNode, imageNode, configNode].map((data) => <CanvasNode key={data.id} {...baseProps} data={data} onMouseDown={() => nodeMoves++} onViewImage={() => imagePreviews++} renderNodeContent={() => <div><input aria-label="context-input" /><textarea aria-label="context-textarea" /><select aria-label="context-select"><option>A</option></select><div contentEditable suppressContentEditableWarning><span data-native-editable>editable</span></div></div>} onContextMenu={(event, nodeId) => { event.preventDefault(); event.stopPropagation(); nodeMenus++; setMenu({ type: "node", nodeId, x: event.clientX, y: event.clientY }); }} />)}
            <svg><ConnectionPath connection={{ id: "right-edge", fromNodeId: textNode.id, toNodeId: imageNode.id }} from={textNode} to={imageNode} active={false} onSelect={no} onContextMenu={() => connectionMenus++} /></svg>
            <div data-canvas-overlay><button data-overlay-target>overlay</button></div><div data-connection-create-menu><button data-connection-menu-target>connection options</button></div><input aria-label="canvas-editor" />
            {position ? <NodeCreateMenu position={position} scale={viewportRef.current.k} onClose={() => setPosition(null)} onCreate={(type) => { created.push({ type, position }); setPosition(null); }} /> : null}
            {menu ? <CanvasNodeContextMenu menu={menu} canCaptureVideoFrame={false} onClose={() => setMenu(null)} onCaptureVideoFrame={no} onDuplicate={no} onDelete={no} /> : null}
        </InfiniteCanvas>;
    }
    const ui = await mount(<Harness />);
    ref.current!.getBoundingClientRect = () => ({ left: 280, top: 72, width: 800, height: 600, x: 280, y: 72, right: 1080, bottom: 672, toJSON: no });
    const right = async (target: EventTarget, clientX = 600, clientY = 360) => { await down(target, { button: 2, buttons: 2, clientX, clientY }); await up(); const event = mouse("contextmenu", { button: 2, buttons: 0, clientX, clientY }); await fire(target, event); return event; };
    await test("空白处双击不再添加，右键一次在准确画布坐标打开真实节点菜单并能创建节点", async () => {
        await fire(ref.current!, mouse("dblclick", { clientX: 600, clientY: 360 })); assert.equal(ui.host.querySelector("[data-canvas-no-zoom]"), null); assert.equal(blankMenus, 0);
        const event = await right(ref.current!); assert.ok(event.defaultPrevented); assert.equal(blankMenus, 1); assert.equal(selects, 0); assert.equal(nodeMoves, 0);
        const menu = ui.host.querySelector("[data-canvas-no-zoom]") as HTMLElement; assert.ok(menu); assert.equal(menu.style.left, "600px"); assert.equal(menu.style.top, "496px"); assert.equal(menu.style.transform, "scale(2)");
        const option = [...menu.querySelectorAll("button")].find((b) => b.textContent === "图片"); assert.ok(option); await down(option); await up(); await fire(option, mouse("click"));
        assert.deepEqual(created, [{ type: "image", position: { x: 600, y: 496 } }]); assert.equal(ui.host.querySelector("[data-canvas-no-zoom]"), null); assert.equal(selects, 0);
        await right(ref.current!, 700, 400); const reopened = ui.host.querySelector("[data-canvas-no-zoom]") as HTMLElement; assert.equal(reopened.style.left, "800px"); assert.equal(reopened.style.top, "576px");
        await right(reopened.querySelector("button")!); assert.equal(blankMenus, 2, "right-click inside the create menu must not replace it");
    });
    await test("节点与连线保留原有右键菜单，节点双击名称/文字/图片操作不触发添加菜单", async () => {
        const node = ui.host.querySelector('[data-node-id="right-text"]')!;
        const event = await right(node); assert.ok(event.defaultPrevented); assert.equal(nodeMenus, 1); assert.equal(blankMenus, 2); assert.ok([...ui.host.querySelectorAll("button")].some((b) => b.textContent === "复制"));
        await fire(node.querySelector("button")!, mouse("dblclick")); assert.ok(node.querySelector('[aria-label="节点名称"]')); assert.equal(blankMenus, 2);
        await fire(label(node as HTMLElement, "节点名称"), new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await fire(node.children[1], mouse("dblclick")); assert.ok(node.querySelector("textarea"), "text body must still enter editing");
        await fire(ui.host.querySelector('[data-node-id="right-image"]')!.children[1], mouse("dblclick")); assert.equal(imagePreviews, 1); assert.equal(blankMenus, 2);
        const edge = ui.host.querySelector('[data-connection-id="right-edge"]')!; const edgeEvent = await right(edge); assert.ok(edgeEvent.defaultPrevented); assert.equal(connectionMenus, 1); assert.equal(nodeMenus, 1); assert.equal(blankMenus, 2);
    });
    await test("节点输入框/文字编辑器/可编辑区保留原生右键，浮层与参考图模式不打开创建菜单", async () => {
        const node = ui.host.querySelector('[data-node-id="right-text"]')!; await fire(node.children[1], mouse("dblclick"));
        const config = ui.host.querySelector('[data-node-id="right-controls"]')!;
        for (const control of [node.querySelector("textarea")!, ...config.querySelectorAll("input,textarea,select,[data-native-editable]"), label(ui.host, "canvas-editor"), ui.host.querySelector("[data-overlay-target]")!, ui.host.querySelector("[data-connection-menu-target]")!]) {
            assert.ok(control); const event = mouse("contextmenu", { button: 2, buttons: 0, clientX: 450, clientY: 280 }); await fire(control, event); assert.equal(event.defaultPrevented, false); assert.equal(nodeMenus, 1); assert.equal(connectionMenus, 1); assert.equal(blankMenus, 2);
        }
        await fire(node.querySelector("button")!, mouse("dblclick")); const titleEvent = mouse("contextmenu", { button: 2, buttons: 0 }); await fire(label(node as HTMLElement, "节点名称"), titleEvent); assert.equal(titleEvent.defaultPrevented, false); assert.equal(nodeMenus, 1); assert.equal(blankMenus, 2);
        referenceMode = true; const event = await right(ref.current!); assert.ok(event.defaultPrevented); assert.equal(blankMenus, 2); assert.equal(ui.host.querySelector("[data-canvas-no-zoom]"), null);
    });
    await ui.close();
}


async function focusedSpace() {
    const ref = createRef<HTMLDivElement>(), node = makeNode("focused-space", "config");
    let viewport: ViewportTransform = { x: 12, y: 24, k: 1 }, clicks = 0, nodeMoves = 0, controlKeys = 0;
    const countKey = (event: React.KeyboardEvent) => { if (event.code === "Space") { controlKeys++; event.currentTarget.dispatchEvent(mouse("click")); } };
    function Harness() {
        const [v, setV] = useState(viewport);
        return <><div data-node-toolbar="focused-space"><button aria-label="focused-toolbar" onClick={() => clicks++} onKeyDown={countKey} onKeyUp={countKey}>节点工具</button></div><div className="ant-modal"><button aria-label="modal-space" onKeyDown={() => controlKeys++}>模态操作</button></div><InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => { viewport = next; setV(next); }}>
            <CanvasNode {...baseProps} data={node} onMouseDown={() => nodeMoves++} renderNodeContent={() => <div>
                <button aria-label="focused-button" onClick={() => clicks++} onKeyDown={countKey} onKeyUp={countKey}>操作节点</button>
                <select aria-label="focused-select" onKeyDown={countKey} onKeyUp={countKey}><option>A</option><option>B</option></select>
                <input type="checkbox" aria-label="focused-checkbox" onKeyDown={countKey} onKeyUp={countKey} />
                <input type="range" aria-label="focused-range" onKeyDown={countKey} onKeyUp={countKey} />
                <input readOnly aria-label="focused-readonly" value="只读内容" onKeyDown={countKey} onKeyUp={countKey} />
                <input aria-label="editing-text" /><input type="password" aria-label="editing-password" /><textarea aria-label="editing-textarea" />
                <div contentEditable="plaintext-only" tabIndex={0} suppressContentEditableWarning data-editing-plaintext><span>编辑文字</span></div>
            </div>} />
        </InfiniteCanvas></>;
    }
    const ui = await mount(<Harness />);
    const space = async (type: string, target: EventTarget, repeat = false) => { const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, code: "Space", key: " ", repeat }); await fire(target, event); return event; };
    await test("操作后焦点留在节点按钮/标题/选择器/勾选/滑杆/只读框时空格按住及重复按键都只平移，不激活控件", async () => {
        const title = ui.host.querySelector('[data-node-id="focused-space"] button') as HTMLButtonElement;
        title.addEventListener("keydown", () => controlKeys++); title.addEventListener("keyup", () => controlKeys++);
        for (const control of [label(ui.host, "focused-button"), label(ui.host, "focused-toolbar"), title, label(ui.host, "focused-select"), label(ui.host, "focused-checkbox"), label(ui.host, "focused-range"), label(ui.host, "focused-readonly")]) {
            control.focus(); assert.equal(document.activeElement, control);
            if (control.tagName === "BUTTON") await fire(control, mouse("click"));
            const start = { ...viewport }, initialClicks = clicks, initialKeys = controlKeys;
            assert.equal((await space("keydown", control)).defaultPrevented, true);
            for (let i = 0; i < 4; i++) assert.equal((await space("keydown", control, true)).defaultPrevented, true);
            assert.equal(ref.current!.style.cursor, "grab"); assert.equal(clicks, initialClicks); assert.equal(controlKeys, initialKeys);
            const dragTarget = control.closest("[data-node-toolbar]") ? ui.host.querySelector('[data-node-id="focused-space"]')! : control;
            await down(dragTarget, { clientX: 100, clientY: 120 }); await fire(window, pointer("pointermove", { clientX: 165, clientY: 155 })); await act(async () => { await tick(); }); await up(); await fire(dragTarget, mouse("click"));
            assert.equal((await space("keyup", control)).defaultPrevented, true);
            assert.deepEqual(viewport, { ...start, x: start.x + 65, y: start.y + 35 }); assert.equal(nodeMoves, 0); assert.equal(clicks, initialClicks); assert.equal(controlKeys, initialKeys); assert.equal(ref.current!.style.cursor, ""); assert.deepEqual(node.position, { x: 40, y: 80 });
        }
    });
    await test("文字/密码/文本区/plaintext-only编辑时空格与长按正常输入，不接管平移；按住后焦点变化仍正确释放", async () => {
        const start = { ...viewport };
        for (const editor of [label(ui.host, "editing-text"), label(ui.host, "editing-password"), label(ui.host, "editing-textarea"), ui.host.querySelector("[data-editing-plaintext]")!]) {
            (editor as HTMLElement).focus();
            for (const repeat of [false, true]) { const event = await space("keydown", editor, repeat); assert.equal(event.defaultPrevented, false); }
            assert.equal((await space("keyup", editor)).defaultPrevented, false); assert.equal(ref.current!.style.cursor, ""); assert.deepEqual(viewport, start);
        }
        const modal = label(ui.host, "modal-space"), initialKeys = controlKeys; modal.focus(); assert.equal((await space("keydown", modal)).defaultPrevented, false); assert.equal((await space("keyup", modal)).defaultPrevented, false); assert.equal(controlKeys, initialKeys + 1); assert.equal(ref.current!.style.cursor, "");
        const button = label(ui.host, "focused-button"), editor = label(ui.host, "editing-text"); button.focus(); await space("keydown", button); assert.equal(ref.current!.style.cursor, "grab"); editor.focus(); assert.equal((await space("keyup", editor)).defaultPrevented, true); assert.equal(ref.current!.style.cursor, "");
        await down(ref.current!, { clientX: 100, clientY: 100 }); await fire(window, pointer("pointermove", { clientX: 160, clientY: 160 })); await up(); assert.deepEqual(viewport, start);
    });
    await ui.close();
}


async function modalSpaceIsolation() {
    await test("主画布与图片编辑器共存时空格只平移当前模态，重复按键不激活按钮，编辑文本不丢空格", async () => {
        const oldObserver = (globalThis as any).ResizeObserver;
        (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
        const ref = createRef<HTMLDivElement>(); let viewport: ViewportTransform = { x: 10, y: 20, k: 1 }, editorSpace = false, editorClicks = 0, editorKeys = 0;
        function Editor() {
            const view = useImageEditorViewport({ width: 1200, height: 900 }, true); editorSpace = view.spacePressed;
            return <div className="ant-modal" data-canvas-no-zoom><button aria-label="editor-apply" onClick={() => editorClicks++} onKeyDown={() => editorKeys++} onKeyUp={() => editorKeys++}>应用</button><input aria-label="editor-prompt" /><div ref={view.viewportRef} {...view.panHandlers} data-editor-viewport><div ref={view.stageRef}>图像</div></div></div>;
        }
        function Harness() { const [v, setV] = useState(viewport); return <><InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => { viewport = next; setV(next); }}><div data-node-id="background-editor"><button>背景节点</button></div></InfiniteCanvas><Editor /></>; }
        const ui = await mount(<Harness />), button = label(ui.host, "editor-apply"), editor = ui.host.querySelector("[data-editor-viewport]")! as HTMLElement, prompt = label(ui.host, "editor-prompt");
        const space = async (type: string, target: EventTarget, repeat = false) => { const event = new KeyboardEvent(type, { key: " ", code: "Space", repeat, bubbles: true, cancelable: true }); await fire(target, event); return event; };
        try {
            button.focus(); assert.equal((await space("keydown", button)).defaultPrevented, true); assert.equal(editorSpace, true); assert.equal(ref.current!.style.cursor, "");
            for (let i = 0; i < 4; i++) assert.equal((await space("keydown", button, true)).defaultPrevented, true);
            editor.scrollLeft = 120; editor.scrollTop = 90; await down(editor, { clientX: 100, clientY: 100 }); await fire(editor, pointer("pointermove", { clientX: 140, clientY: 125 })); await fire(editor, pointer("pointerup", { buttons: 0 }));
            assert.equal(editor.scrollLeft, 80); assert.equal(editor.scrollTop, 65); assert.deepEqual(viewport, { x: 10, y: 20, k: 1 }); assert.equal((await space("keyup", button)).defaultPrevented, true); assert.equal(editorKeys, 0); assert.equal(editorClicks, 0); assert.equal(editorSpace, false);
            prompt.focus(); assert.equal((await space("keydown", prompt)).defaultPrevented, false); assert.equal((await space("keydown", prompt, true)).defaultPrevented, false); assert.equal((await space("keyup", prompt)).defaultPrevented, false); assert.equal(editorSpace, false);
            button.focus(); await space("keydown", button); await fire(window, new Event("blur")); assert.equal(editorSpace, false); assert.equal(ref.current!.style.cursor, "");
        } finally { await ui.close(); (globalThis as any).ResizeObserver = oldObserver; }
    });
}

async function focusCompetition() {
    await test("聚焦动画进行中滚轮操作取消父动画，不被后续动画帧回弹覆盖", async () => {
        const source = readFileSync("src/pages/canvas/project.tsx", "utf8"), callbackSource = source.match(/<InfiniteCanvas\b[\s\S]*?onViewportChange=\{\(next\) => \{([\s\S]*?)\}\}/)?.[1];
        assert.ok(callbackSource, "must test the actual project's manual viewport callback");
        const focusAnimRef = { current: null as number | null }, viewportRef = { current: { x: 20, y: 40, k: 1 } };
        let viewport = { ...viewportRef.current }, render: (next: ViewportTransform) => void = no, animationFrames = 0;
        const actualCallback = new Function("next", "focusAnimRef", "viewportRef", "cancelAnimationFrame", "setViewport", "setContextMenu", callbackSource);
        const ref = createRef<HTMLDivElement>();
        function Harness() { const [v, setV] = useState(viewport); render = (next) => { viewport = next; setV(next); }; return <InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => actualCallback(next, focusAnimRef, viewportRef, cancelAnimationFrame, render, no)}><div data-node-id="animated"><button><span>inside</span></button></div></InfiniteCanvas>; }
        const ui = await mount(<Harness />); ref.current!.getBoundingClientRect = () => ({ left: 280, top: 72, width: 800, height: 600, x: 280, y: 72, right: 1080, bottom: 672, toJSON: no });
        const frame = () => { animationFrames++; render({ x: animationFrames * 10, y: animationFrames * 20, k: 1 }); focusAnimRef.current = requestAnimationFrame(frame); };
        await act(async () => { focusAnimRef.current = requestAnimationFrame(frame); await tick(25); }); assert.ok(animationFrames > 0);
        const before = { ...viewport }, world = { x: (520 - 280 - before.x) / before.k, y: (320 - 72 - before.y) / before.k };
        await fire(ui.host.querySelector("span")!, new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 520, clientY: 320, deltaY: -100 }));
        const after = { ...viewport }, count = animationFrames; assert.equal(focusAnimRef.current, null); assert.deepEqual(viewportRef.current, after); assert.ok(Math.abs((240 - after.x) / after.k - world.x) < 1e-8); assert.ok(Math.abs((248 - after.y) / after.k - world.y) < 1e-8);
        await act(async () => { await tick(70); }); assert.deepEqual(viewport, after); assert.equal(animationFrames, count); await ui.close();
    });
}

(async () => { await gestures(); await workflows(); await referenceNames(); await layout(); await focusCompetition(); await rightClickCreation(); await focusedSpace(); await modalSpaceIsolation(); console.log(`PASS interactions: ${passed.length}/${passed.length} checks (jsdom + real React components; AI/media I/O mocked; no live API spend)`); })().catch((error) => { console.error(error); process.exitCode = 1; });
