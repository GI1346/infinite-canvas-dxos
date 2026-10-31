import assert from "node:assert/strict";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { CanvasNodePaintDialog } from "../src/components/canvas/canvas-node-paint-dialog";
import { CanvasNodeHoverToolbar } from "../src/components/canvas/canvas-node-hover-toolbar";
import { IMAGE_QUICK_TOOLS_STORAGE_KEY } from "../src/components/canvas/canvas-image-toolbar-tools";
import { renderImagePaint, type ImagePaintMode, type ImagePaintStroke } from "../src/lib/canvas/canvas-image-paint";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "../src/types/canvas";

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(1); }); }
const pointer = (type: string, x = 100, y = 100, extra = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1, clientX: x, clientY: y, ...extra });
const click = (target: EventTarget) => fire(target, new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
const key = (target: EventTarget, name: string, extra = {}) => fire(target, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name, ...extra }));
const button = (scope: ParentNode, text: string) => { const result = [...scope.querySelectorAll("button")].find((element) => element.textContent?.replace(/\s/g, "") === text.replace(/\s/g, "")); assert.ok(result, text); return result; };
const labeled = (scope: ParentNode, text: string) => { const result = scope.querySelector(`[aria-label="${text}"]`); assert.ok(result, text); return result as HTMLButtonElement; };
const no = () => {};
let passed = 0;
async function check(name: string, work: () => void | Promise<void>) { await work(); console.log(`PASS ${name}`); passed++; }
const commands = (canvas: HTMLCanvasElement): any[] => (canvas.getContext("2d") as any).rendered;
const decode = (url: string) => JSON.parse(Buffer.from(url.split(",")[1], "base64").toString());

async function rendererChecks() {
    await check("画笔真实渲染器覆盖自由画、箭头、序号、矩形、圆形、橡皮及透明度", () => {
        const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!;
        const make = (mode: ImagePaintMode): ImagePaintStroke => ({ mode, color: "#123456", textColor: "#abcdef", size: 10, opacity: 35, number: 23, points: [{ x: 20, y: 30 }, { x: 90, y: 110 }] });
        renderImagePaint(context, [make("draw")], 1200, 900);
        assert.equal(commands(canvas)[0].op, "stroke"); assert.deepEqual(commands(canvas)[0].path, [["moveTo", 20, 30], ["lineTo", 90, 110]]);
        assert.equal(commands(canvas)[0].strokeStyle, "#123456"); assert.equal(commands(canvas)[0].lineWidth, 10); assert.equal(commands(canvas)[0].globalAlpha, .35);
        renderImagePaint(context, [{ ...make("draw"), points: [{ x: 20, y: 30 }] }], 1200, 900);
        assert.equal(commands(canvas)[0].op, "fill"); assert.equal(commands(canvas)[0].path[0][0], "arc");
        renderImagePaint(context, [make("arrow")], 1200, 900); assert.deepEqual(commands(canvas).map((op) => op.op), ["stroke", "fill"]); assert.equal(commands(canvas)[1].path.at(-1)[0], "closePath");
        renderImagePaint(context, [make("rectangle")], 1200, 900); assert.deepEqual(commands(canvas)[0].args, [20, 30, 70, 80]);
        renderImagePaint(context, [make("ellipse")], 1200, 900); assert.deepEqual(commands(canvas)[0].path[0].slice(0, 5), ["ellipse", 55, 70, 35, 40]);
        renderImagePaint(context, [make("number")], 1200, 900); assert.deepEqual(commands(canvas).map((op) => op.op), ["fill", "fillText"]); assert.deepEqual(commands(canvas)[1].args, ["23", 20, 30]); assert.equal(commands(canvas)[1].fillStyle, "#abcdef");
        renderImagePaint(context, [make("draw"), make("erase")], 1200, 900); assert.equal(commands(canvas)[0].globalCompositeOperation, "source-over"); assert.equal(commands(canvas)[1].globalCompositeOperation, "destination-out");
        assert.equal(context.globalCompositeOperation, "source-over", "renderer restores compositing state after erasing");
    });
}

async function paintUiChecks() {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), ref = createRef<HTMLDivElement>();
    let viewport: ViewportTransform = { x: 25, y: 35, k: 1 }, closed = 0, saves: string[] = [];
    let saveWork = async (url: string) => { saves.push(url); };
    function Harness() {
        const [v, setV] = useState(viewport);
        return <ConfigProvider virtual={false}><App><InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => { viewport = next; setV(next); }}><div data-node-id="background"><button>背景节点</button></div></InfiniteCanvas><CanvasNodePaintDialog dataUrl="data:image/png;base64,original" open onClose={() => closed++} onConfirm={(url) => saveWork(url)} /></App></ConfigProvider>;
    }
    await act(async () => { root.render(<Harness />); await tick(40); });
    const modal = document.querySelector(".ant-modal")! as HTMLElement, image = modal.querySelector("img")!;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1200 }); Object.defineProperty(image, "naturalHeight", { configurable: true, value: 900 });
    await fire(image, new Event("load"));
    const canvas = labeled(modal, "画笔绘制区域") as unknown as HTMLCanvasElement, scroll = canvas.closest(".overflow-hidden,.overflow-scroll")! as HTMLElement;
    const undo = () => labeled(modal, "撤销绘制"), redo = () => labeled(modal, "重做绘制");
    const stroke = async (x = 100, y = 100, endX = 200, endY = 180) => { await fire(canvas, pointer("pointerdown", x, y)); await fire(canvas, pointer("pointermove", endX, endY)); await fire(canvas, pointer("pointerup", endX, endY, { buttons: 0 })); };
    const mode = async (text: string) => { const label = [...modal.querySelectorAll("label")].find((element) => element.textContent === text); assert.ok(label, text); await click(label.querySelector("input")!); };
    try {
        await check("画笔弹窗加载原始像素尺寸，未绘制时禁止保存、撤销和重做", () => {
            assert.equal(canvas.width, 1200); assert.equal(canvas.height, 900); assert.ok(modal.textContent?.includes("1200 × 900 px"));
            assert.equal(button(modal, "保存为新图片").disabled, true); assert.equal(undo().disabled, true); assert.equal(redo().disabled, true);
        });
        await check("自由画笔提交完整笔划，按钮及 Ctrl/Cmd 快捷键可撤销重做", async () => {
            await stroke(); assert.equal(commands(canvas).length, 1); assert.equal(commands(canvas)[0].op, "stroke"); assert.equal(undo().disabled, false);
            await click(undo()); assert.equal(commands(canvas).length, 0); assert.equal(redo().disabled, false);
            await click(redo()); assert.equal(commands(canvas).length, 1);
            button(modal, "保存为新图片").focus(); await key(window, "z", { ctrlKey: true }); assert.equal(commands(canvas).length, 0);
            await key(window, "z", { metaKey: true, shiftKey: true }); assert.equal(commands(canvas).length, 1);
        });
        await check("箭头/矩形/圆形保留起终点，序号点击自动递增，橡皮仅操作绘制层", async () => {
            for (const [name, op] of [["箭头", "fill"], ["矩形", "strokeRect"], ["圆形", "stroke"]]) { await mode(name); await stroke(); assert.equal(commands(canvas).at(-1).op, op); }
            await mode("序号"); await stroke(); assert.equal((labeled(modal, "当前序号") as unknown as HTMLInputElement).value, "2"); assert.equal(commands(canvas).at(-1).args[0], "1");
            await stroke(); assert.equal((labeled(modal, "当前序号") as unknown as HTMLInputElement).value, "3"); assert.equal(commands(canvas).at(-1).args[0], "2");
            await mode("橡皮"); await stroke(); assert.equal(commands(canvas).at(-1).globalCompositeOperation, "destination-out"); assert.equal(image.getAttribute("src"), "data:image/png;base64,original");
        });
        await check("画笔参数控件修改颜色、粗细和透明度并进入实际渲染命令", async () => {
            await mode("自由画笔");
            const color = labeled(modal, "画笔颜色") as unknown as HTMLInputElement;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(color, "#123456"); await fire(color, new Event("input", { bubbles: true })); await fire(color, new Event("change", { bubbles: true }));
            const sliders = [...modal.querySelectorAll('[role="slider"]')]; assert.equal(sliders.length, 2);
            await key(sliders[0], "ArrowRight", { code: "ArrowRight", keyCode: 39, which: 39 }); await key(sliders[1], "ArrowLeft", { code: "ArrowLeft", keyCode: 37, which: 37 });
            await stroke(); const last = commands(canvas).at(-1); assert.equal(last.strokeStyle, "#123456"); assert.equal(last.lineWidth, 13); assert.equal(last.globalAlpha, .99);
        });
        await check("空格按住/重复和画布内拖动只平移预览，不画线、不清空、不激活焦点按钮", async () => {
            const snapshot = JSON.stringify(commands(canvas)); const clear = button(modal, "清除全部绘制"); clear.focus(); let controlKeys = 0; const count = () => controlKeys++;
            clear.addEventListener("keydown", count); clear.addEventListener("keyup", count);
            for (let i = 0; i < 4; i++) { const event = new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: i > 0, bubbles: true, cancelable: true }); await fire(clear, event); assert.equal(event.defaultPrevented, true); }
            scroll.scrollLeft = 130; scroll.scrollTop = 100;
            await fire(canvas, pointer("pointerdown")); await fire(canvas, pointer("pointermove", 145, 130)); await fire(canvas, pointer("pointerup", 145, 130, { buttons: 0 }));
            assert.equal(scroll.scrollLeft, 85); assert.equal(scroll.scrollTop, 70);
            const up = new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true }); await fire(clear, up); assert.equal(up.defaultPrevented, true);
            assert.equal(JSON.stringify(commands(canvas)), snapshot); assert.equal(controlKeys, 0); assert.equal(saves.length, 0); assert.equal(closed, 0); assert.deepEqual(viewport, { x: 25, y: 35, k: 1 });
            const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 300, clientY: 225 }); await fire(canvas, wheel); assert.equal(wheel.defaultPrevented, true); assert.ok(modal.textContent?.includes("120%")); assert.equal(JSON.stringify(commands(canvas)), snapshot);
        });
        await check("取消中的笔划不进入历史，新笔划清除重做记录，清除全部后禁用保存", async () => {
            await click(undo()); assert.equal(redo().disabled, false); const snapshot = JSON.stringify(commands(canvas));
            await fire(canvas, pointer("pointerdown")); await fire(canvas, pointer("pointermove", 160, 150)); await fire(canvas, pointer("pointercancel", 160, 150)); assert.equal(JSON.stringify(commands(canvas)), snapshot);
            await stroke(); assert.equal(redo().disabled, true); await click(button(modal, "清除全部绘制")); assert.equal(commands(canvas).length, 0); assert.equal(undo().disabled, true); assert.equal(button(modal, "保存为新图片").disabled, true);
        });
        await check("本地保存按原始尺寸先绘原图再合成绘制层，原图不改且不发起任何 API 请求", async () => {
            await stroke(); await click(button(modal, "保存为新图片")); assert.equal(saves.length, 1);
            const result = decode(saves[0]); assert.equal(result.width, 1200); assert.equal(result.height, 900); assert.equal(result.commands.length, 2);
            assert.equal(result.commands[0].source, image.src); assert.deepEqual(result.commands[0].args, [0, 0]); assert.equal(result.commands[1].source, "layer"); assert.deepEqual(result.commands[1].args, [0, 0, 1200, 900]); assert.equal(result.commands[1].layer.length, 1);
            assert.equal(image.getAttribute("src"), "data:image/png;base64,original"); assert.equal((globalThis as any).__paintNetworkCalls, 0);
        });
        await check("保存异常显示错误并可重试，保存后仍可取消退出", async () => {
            saveWork = async () => { throw new Error("验收保存失败"); }; await click(button(modal, "保存为新图片")); assert.ok(modal.textContent?.includes("验收保存失败")); assert.equal(button(modal, "保存为新图片").disabled, false);
            saveWork = async (url) => { saves.push(url); }; await click(button(modal, "保存为新图片")); assert.equal(saves.length, 2); assert.equal(modal.textContent?.includes("验收保存失败"), false);
            await click(button(modal, "取消")); assert.equal(closed, 1);
        });
    } finally { await act(async () => root.unmount()); host.remove(); }
}

async function toolbarChecks() {
    await check("不同缩放下悬浮工具栏底边始终位于节点名称上方，保留固定 8px 间隔", async () => {
        const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
        const node: CanvasNodeData = { id: "toolbar-name-gap", type: CanvasNodeType.Image, title: "商品主图", position: { x: 100, y: 300 }, width: 300, height: 225, metadata: { content: "data:image/png;base64,original" } };
        for (const k of [.25, 1, 2, 5]) {
            const viewport = { x: 24, y: 70, k };
            await act(async () => { root.render(<ConfigProvider virtual={false}><App><CanvasNodeHoverToolbar node={node} viewport={viewport} onKeep={no} onLeave={no} onInfo={no} onDecreaseFont={no} onIncreaseFont={no} onToggleDialog={no} onGenerateImage={no} onUpload={no} onDownload={no} onSaveAsset={no} onPaint={no} onMaskEdit={no} onCrop={no} onExtractSelection={no} onAddToAgent={no} onSplit={no} onUpscale={no} onSuperResolve={no} onAngle={no} onViewImage={no} onReversePrompt={no} onRetry={no} onToggleFreeResize={no} onDelete={no} /></App></ConfigProvider>); });
            const toolbar = host.querySelector('[data-node-toolbar="toolbar-name-gap"]') as HTMLElement; assert.ok(toolbar);
            assert.ok(toolbar.classList.contains("-translate-y-full"));
            const toolbarBottom = parseFloat(toolbar.style.top), titleTop = viewport.y + (node.position.y - 44) * k;
            assert.equal(titleTop - toolbarBottom, 8, `scale=${k}: toolbar must not overlap the normally scaled image title`);
            assert.equal(parseFloat(toolbar.style.left), viewport.x + (node.position.x + node.width / 2) * k);
        }
        await act(async () => root.unmount()); host.remove();
    });
    await check("清空快捷工具仍固定显示画笔/裁剪扩图/多宫格裁剪/提取选区/添加Agent，点击分别转发正确节点", async () => {
        for (const settings of [[], { ids: [], showLabels: false }]) {
            localStorage.setItem(IMAGE_QUICK_TOOLS_STORAGE_KEY, JSON.stringify(settings));
            const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), calls: string[] = [];
            const node: CanvasNodeData = { id: "local-image-tools", type: CanvasNodeType.Image, title: "商品主图", position: { x: 100, y: 100 }, width: 300, height: 225, metadata: { content: "data:image/png;base64,original" } };
            const record = (name: string) => (value: CanvasNodeData) => { assert.equal(value, node); calls.push(name); };
            await act(async () => { root.render(<ConfigProvider virtual={false}><App><CanvasNodeHoverToolbar node={node} viewport={{ x: 0, y: 0, k: 1 }} onKeep={no} onLeave={no} onInfo={no} onDecreaseFont={no} onIncreaseFont={no} onToggleDialog={no} onGenerateImage={no} onUpload={no} onDownload={no} onSaveAsset={no} onPaint={record("paint")} onMaskEdit={no} onCrop={record("crop")} onExtractSelection={record("extract")} onAddToAgent={record("agent")} onSplit={record("split")} onUpscale={no} onSuperResolve={no} onAngle={no} onViewImage={no} onReversePrompt={no} onRetry={no} onToggleFreeResize={no} onDelete={no} /></App></ConfigProvider>); await tick(); });
            const toolbar = host.querySelector('[data-node-toolbar="local-image-tools"]')!; assert.ok(toolbar);
            assert.deepEqual([...toolbar.querySelectorAll("button")].slice(0, 5).map((element) => element.textContent), ["画笔", "裁剪/扩图", "多宫格裁剪", "提取选区", "添加到 Agent"]); assert.equal(toolbar.querySelectorAll("button").length, 6);
            for (const name of ["画笔", "裁剪/扩图", "多宫格裁剪", "提取选区", "添加到 Agent"]) await click(labeled(toolbar, name));
            assert.deepEqual(calls, ["paint", "crop", "split", "extract", "agent"]); assert.equal((globalThis as any).__paintNetworkCalls, 0);
            await act(async () => root.unmount()); host.remove();
        }
        localStorage.removeItem(IMAGE_QUICK_TOOLS_STORAGE_KEY);
    });
}

(async () => { await rendererChecks(); await paintUiChecks(); await toolbarChecks(); console.log(`PASS local image tools: ${passed}/${passed} checks; real React/Ant Design/render commands, mocked image metadata and 2D canvas, no live API`); })().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
