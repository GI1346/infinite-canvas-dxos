import assert from "node:assert/strict";
import fs from "node:fs";
import axios from "axios";
import React, { act, createRef, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { collectLlmInputs, buildLlmPrompt, parseLlmTable, buildLlmOutputOps, LLM_TYPE } from "../src/lib/canvas/dxos-llm";
import { llmNodeDefinition } from "../src/components/canvas/nodes/dxos-llm-node";
import { dxosNodeDefinitions } from "../src/components/canvas/nodes/dxos-workflow-nodes";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { CanvasNode } from "../src/components/canvas/canvas-node";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { registerNodeDefinitions } from "../src/lib/canvas/node-registry";
import { channelItems, TABLE_TYPE, CONCURRENT_TYPE, tableRows, generationRows } from "../src/lib/canvas/dxos-table";
import { canvasThemes } from "../src/lib/canvas-theme";
import { usePluginHost } from "../src/pages/canvas/hooks/use-plugin-host";
import { createModelChannel, defaultConfig, useConfigStore, modelOptionName, type AiConfig } from "../src/stores/use-config-store";
import { useCallProtocolStore } from "../src/stores/use-call-protocol-store";
import type { CanvasNodeData, CanvasConnection, CanvasNodeMetadata, ViewportTransform } from "../src/types/canvas";
import type { CanvasPluginHost } from "../src/types/canvas-plugin";

// Offline acceptance: real node, host, API and protocol runner; only transport replies are synthetic.
const original = { fetch: globalThis.fetch, adapter: axios.defaults.adapter };
const results: { name: string; passed: boolean; detail?: string }[] = [];
const noop = () => {};
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name: string, work: () => unknown | Promise<unknown>) {
    try { await work(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, detail: String(error) }); console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
const node = (id: string, type = "image", metadata: CanvasNodeMetadata = {}): CanvasNodeData => ({ id, type, title: id, position: { x: 50, y: 70 }, width: 430, height: 540, metadata });
const edge = (fromNodeId: string, toNodeId: string, toPort?: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}-${toPort}`, fromNodeId, toNodeId, ...(toPort ? { toPort } : {}) });
const input = "data:image/png;base64,AQID";
const input2 = "data:image/png;base64,BAUG";
const llm = () => node("llm", LLM_TYPE, { prompt: "请分析图片", llmOutputMode: "text" });
const image = (id = "img", content = input, metadata = {}) => node(id, "image", { content, status: "success", ...metadata });
const tableJson = JSON.stringify({ kind: "table", version: 1, columns: ["描述", "提示词"], rows: [["图片一", "翻译英文"], ["图片二", "保留构图"]] });
const imageChannel = createModelChannel({ id: "image", name: "独立生图", baseUrl: "https://image.invalid", apiKey: "synthetic-image-key", models: [{ name: "same-model", capability: "image" }] });
const textChannel = createModelChannel({ id: "text-a", name: "对话 A", baseUrl: "https://text-a.invalid", apiKey: "synthetic-text-a", models: [{ name: "same-model", capability: "text" }, { name: "other-text", capability: "text" }] });
const secondChannel = createModelChannel({ id: "text-b", name: "对话 B", baseUrl: "https://text-b.invalid", apiKey: "synthetic-text-b", models: [{ name: "same-model", capability: "text" }] });
const config = (): AiConfig => ({ ...defaultConfig, channels: [imageChannel, textChannel, secondChannel], models: ["image::same-model", "text-a::same-model", "text-a::other-text", "text-b::same-model"], model: "image::same-model", imageModel: "image::same-model", textModel: "text-a::same-model", apiKey: "must-not-use-global", systemPrompt: "全局系统要求" });
registerNodeDefinitions([llmNodeDefinition, ...dxosNodeDefinitions, ...["image", "text", "group", "video", "audio"].map((type) => ({ type, title: type, icon: null, defaultSize: { width: 300, height: 240 } }))]);

const mouse = (type = "click", options = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options });
const pointer = (type: string, options = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, ...options });
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); return event; }
async function value(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, next: string) {
    const proto = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(target, next);
    await fire(target, new Event(target instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}
function button(host: HTMLElement, text: string) { const result = [...host.querySelectorAll("button")].find((el) => el.textContent?.includes(text)); assert.ok(result, text); return result; }
function label(host: HTMLElement, name: string) { const result = host.querySelector(`[aria-label="${name}"]`); assert.ok(result, name); return result as HTMLSelectElement; }
const space = (type: string, repeat = false) => new KeyboardEvent(type, { bubbles: true, cancelable: true, key: " ", code: "Space", repeat });

type Request = { url: string; headers: Record<string, string>; body: any; signal?: AbortSignal | null };
const requests: Request[] = [];
let reply: (request: Request) => Promise<Response> = async () => responseText("分析成功");
function responseText(text: string) { return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { output_text: text } })}\n\n`, { headers: { "Content-Type": "text/event-stream" } }); }
function resetTransport() {
    requests.length = 0; reply = async () => responseText("分析成功");
    axios.defaults.adapter = async () => { throw new Error("Unexpected Axios request: offline test refused network"); };
    globalThis.fetch = async (url, options) => {
        if (String(url) === "/plugins/index.json") return new Response("[]", { headers: { "content-type": "application/json" } });
        const request = { url: String(url), headers: options?.headers as Record<string, string>, body: JSON.parse(String(options?.body || "{}")), signal: options?.signal };
        requests.push(request); return reply(request);
    };
}

async function setup(startNode = llm(), extra: CanvasNodeData[] = [], connections: CanvasConnection[] = [], initialConfig = config()) {
    resetTransport(); useConfigStore.setState({ config: initialConfig });
    let state: CanvasAgentSnapshot = { projectId: "test", title: "test", nodes: [startNode, ...extra], connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    let render = noop, host!: CanvasPluginHost, opened = 0, drags = 0;
    const containerRef = createRef<HTMLDivElement>(), initial = state, ops: unknown[] = [];
    function Harness() {
        const effectiveConfig = useConfigStore((store) => store.config);
        const [nodes, setNodes] = useState(initial.nodes), [viewport, setViewport] = useState(initial.viewport), [, refresh] = useState(0);
        const nodesRef = useRef(nodes), connectionsRef = useRef(state.connections), viewportRef = useRef(viewport);
        nodesRef.current = state.nodes; connectionsRef.current = state.connections; viewportRef.current = viewport;
        render = () => { setNodes(state.nodes); refresh((n) => n + 1); };
        const { pluginHost } = usePluginHost({ effectiveConfig, isAiConfigReady: useConfigStore.getState().isAiConfigReady, openConfigDialog: () => opened++, theme: canvasThemes.light, nodesRef, connectionsRef, viewportRef, setNodes: (next) => { state = { ...state, nodes: typeof next === "function" ? next(state.nodes) : next }; setNodes(state.nodes); }, setDialogNodeId: noop, applyAgentOps: (next = []) => { ops.push(...next); state = applyCanvasAgentOps(state, next); render(); } });
        host = pluginHost;
        const current = state.nodes.find((item) => item.id === startNode.id);
        return <InfiniteCanvas containerRef={containerRef} viewport={viewport} tool="select" onViewportChange={(next) => { state.viewport = next; setViewport(next); }}>{current && <CanvasNode data={current} scale={viewport.k} isSelected={false} isRelated={false} isFocusRelated={false} isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false} pluginHost={host} onMouseDown={() => drags++} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop} onResizeStart={noop} onResize={noop} onResizeEnd={noop} onContentChange={noop} onTitleChange={noop} onContextMenu={noop} />}</InfiniteCanvas>;
    }
    const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
    await act(async () => { root.render(<Harness />); await tick(); });
    containerRef.current!.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: noop });
    return { el, host: () => host, state: () => state, opened: () => opened, drags: () => drags, ops, patch: async (patch: CanvasNodeMetadata) => act(async () => { state = applyCanvasAgentOps(state, [{ type: "update_node", id: startNode.id, metadata: patch }]); render(); }), remove: async () => act(async () => { state = applyCanvasAgentOps(state, [{ type: "delete_node", id: startNode.id }]); render(); }), close: async () => { await act(async () => root.unmount()); el.remove(); } };
}

async function helperTests() {
    await check("strict/fenced table JSON retained as editable strings without truncation", () => {
        assert.deepEqual(parseLlmTable(tableJson), { kind: "table", version: 1, columns: ["描述", "提示词"], rows: [["图片一", "翻译英文"], ["图片二", "保留构图"]], selectedRows: [], mergedGroups: [] });
        assert.deepEqual(parseLlmTable("```json\n" + tableJson + "\n```"), parseLlmTable(tableJson));
        const large = { kind: "table", version: 1, columns: Array.from({ length: 41 }, (_, i) => `列${i}`), rows: Array.from({ length: 201 }, () => Array.from({ length: 41 }, () => "x".repeat(20001))) };
        const parsed = parseLlmTable(JSON.stringify(large)); assert.equal(parsed.columns.length, 41); assert.equal(parsed.rows.length, 201); assert.equal(parsed.rows[0][0].length, 20001);
        for (const value of ["not json", "[]", "null", '{"kind":"table","version":"1","columns":["x"],"rows":[]}', '{"kind":"table","version":1,"columns":[" "],"rows":[]}', '{"kind":"table","version":1,"columns":["x"],"rows":[[1]]}', '{"kind":"table","version":1,"columns":["x"],"rows":[["a","b"]]}', 'explanation ' + tableJson]) assert.throws(() => parseLlmTable(value), undefined, value.slice(0, 100));
    });
    await check("connected nested groups collect images/text once in input order, unsupported media errors", () => {
        const source = llm(), group = node("group", "group"), sub = node("sub", "group", { groupId: group.id }), a = image("first", input, { groupId: sub.id }), b = image("second", input2, { groupId: group.id }), text = node("prompt", "text", { content: "翻译英文" });
        const nodes = [source, group, sub, a, b, text], edges = [edge(group.id, source.id), edge(a.id, source.id, "input-2"), edge(text.id, source.id), edge(text.id, source.id, "input-2")];
        const incoming = collectLlmInputs(source, nodes, edges); assert.deepEqual(incoming.references, [input, input2]); assert.equal(incoming.text, "翻译英文"); assert.deepEqual(incoming.imageNodeIds, [a.id, b.id]);
        for (const type of ["audio", "video"]) { const unsupported = node(type, type, { content: `https://example.invalid/${type}` }); assert.throws(() => collectLlmInputs(source, [...nodes, unsupported], [...edges, edge(type, source.id)]), /不支持/); }
    });
    await check("successful image batches ignore pending/error frames and preserve table references", () => {
        const source = llm(), batch = image("batch", input, { images: [{ id: "a", content: input, status: "success" }, { id: "b", content: input2, status: "success" }, { id: "error", content: "bad", status: "error" }, { id: "loading", content: "bad", status: "loading" }] });
        const nodes = [source, batch], connections = [edge(batch.id, source.id)], inputs = collectLlmInputs(source, nodes, connections);
        assert.deepEqual(inputs.references, [input, input2]); assert.deepEqual(inputs.imageNodeIds, [batch.id]);
        const output = buildLlmOutputOps(source, "list", tableJson, inputs, nodes, connections, "list-output");
        const snapshot = applyCanvasAgentOps({ projectId: "test", title: "test", nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, output.ops), table = snapshot.nodes.find((n) => n.id === output.outputId)!;
        assert.equal(table.type, TABLE_TYPE); assert.deepEqual(table.metadata!.table, parseLlmTable(tableJson)); assert.deepEqual(tableRows(table, snapshot.nodes, snapshot.connections).map((r) => r.media.map((m) => m.url)), [[input], [input2]]);
        assert.ok(snapshot.connections.some((c) => c.fromNodeId === source.id && c.toNodeId === table.id)); assert.ok(snapshot.connections.some((c) => c.fromNodeId === batch.id && c.toNodeId === table.id && c.toPort === "input-1"));
        assert.deepEqual(channelItems(table, "input-1", snapshot.nodes, snapshot.connections).map((i) => i.type), ["media", "media"]);
    });
    await check("group versus single-image roles stay separate and table pairing keeps original references", () => {
        const source = llm(), group = node("group", "group"), first = image("first", input, { groupId: group.id }), second = image("second", input2, { groupId: group.id }), style = image("style", "data:image/png;base64,BwgJ"), text = node("text", "text", { content: "输入1为待改商品，输入2为风格参考" });
        const nodes = [source, group, first, second, style, text], connections = [edge(group.id, source.id), edge(style.id, source.id), edge(text.id, source.id)], incoming = collectLlmInputs(source, nodes, connections);
        assert.equal(incoming.groups.length, 2); assert.deepEqual(incoming.groups.map((g) => g.references.length), [2, 1]); assert.deepEqual(incoming.groups.map((g) => g.sourceNodeId), [group.id, style.id]);
        const prompt = buildLlmPrompt(incoming, "把输入2风格应用到输入1"); assert.ok(prompt.includes("输入2（输入B）：单图")); assert.ok(prompt.includes("输入1-第2张")); assert.ok(prompt.includes("不要按扁平顺序猜测")); assert.ok(prompt.includes("不能仅凭图片数量判断角色"));
        const original = structuredClone({ nodes, connections }); const output = buildLlmOutputOps(source, "list", tableJson, incoming, nodes, connections, "role-output");
        const snapshot = applyCanvasAgentOps({ projectId: "test", title: "test", nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, output.ops), table = snapshot.nodes.find((n) => n.id === output.outputId)!;
        assert.deepEqual(table.metadata!.tableInputChannels, [{ id: "input-1", mode: "sequence", imagesOnly: true, mediaNodeIds: [first.id, second.id] }, { id: "input-2", mode: "shared", imagesOnly: true, mediaNodeIds: [style.id] }]);
        assert.deepEqual(tableRows(table, snapshot.nodes, snapshot.connections).map((r) => r.media.map((m) => m.url)), [[input, style.metadata!.content], [input2, style.metadata!.content]]);
        assert.deepEqual({ nodes, connections }, original); assert.ok(!snapshot.connections.some((c) => c.fromNodeId === text.id && c.toNodeId === table.id));
        const prior = node("prior", "text"); prior.position.y = 800; const next = buildLlmOutputOps(source, "text", "新结果", incoming, [...nodes, prior], [...connections, edge(source.id, prior.id)], "next-output"); const add = next.ops.find((op) => op.type === "add_node")!; assert.equal(add.position!.y, prior.position.y + prior.height + 42);
    });
    await check("overlapping group/direct sources pin unique image IDs and exclude source text from table inputs", () => {
        const source = llm(), group = node("mixed", "group"), first = image("first", input, { groupId: group.id }), second = image("second", input2, { groupId: group.id }), text = node("hint", "text", { groupId: group.id, content: "源分组说明不能覆盖生成列表" });
        const nodes = [source, group, first, second, text], connections = [edge(first.id, source.id), edge(group.id, source.id)]; const incoming = collectLlmInputs(source, nodes, connections);
        assert.deepEqual(incoming.references, [input, input2]); assert.deepEqual(incoming.groups.map((g) => g.mediaNodeIds), [[first.id], [second.id]]); assert.equal(incoming.text, text.metadata!.content);
        const out = buildLlmOutputOps(source, "list", tableJson, incoming, nodes, connections, "overlap-output"), snapshot = applyCanvasAgentOps({ projectId: "test", title: "test", nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, out.ops), table = snapshot.nodes.find((n) => n.id === out.outputId)!;
        assert.deepEqual(channelItems(table, "input-2", snapshot.nodes, snapshot.connections).map((item) => item.type === "media" ? item.nodeId : item.text), [second.id]);
        assert.deepEqual(tableRows(table, snapshot.nodes, snapshot.connections).map((r) => r.text), ["图片一\n翻译英文", "图片二\n保留构图"]); assert.deepEqual(tableRows(table, snapshot.nodes, snapshot.connections).map((r) => r.media.map((m) => m.url)), [[input, input2], [input, input2]]);
    });
    await check("LLM lists keep exact model row count while ordinary tables still expand to all images", () => {
        const source = llm(), group = node("four-images", "group"), images = Array.from({ length: 4 }, (_, i) => image(`image-${i}`, `data:image/png;base64,A${i}==`, { groupId: group.id })), style = image("style", input2);
        const nodes = [source, group, ...images, style], connections = [edge(group.id, source.id), edge(style.id, source.id)], incoming = collectLlmInputs(source, nodes, connections);
        for (const count of [0, 1, 2, 6]) {
            const rows = Array.from({ length: count }, (_, i) => [`分析 ${i + 1}`]); const output = buildLlmOutputOps(source, "list", JSON.stringify({ kind: "table", version: 1, columns: ["分析"], rows }), incoming, nodes, connections, `exact-${count}`);
            const snapshot = applyCanvasAgentOps({ projectId: "test", title: "test", nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, output.ops), table = snapshot.nodes.find((n) => n.id === output.outputId)!;
            assert.equal(table.metadata!.tableRowsFromData, true); assert.equal(channelItems(table, "input-1", snapshot.nodes, snapshot.connections).length, 4, "all original references retained");
            const actual = tableRows(table, snapshot.nodes, snapshot.connections); assert.equal(actual.length, count); assert.deepEqual(actual.map((r) => r.text), rows.map((r) => r[0]));
            actual.forEach((row, i) => assert.deepEqual(row.media.map((m) => m.url), [...(images[i] ? [images[i].metadata!.content] : []), style.metadata!.content]));
            const concurrent = node("concurrent", CONCURRENT_TYPE); assert.equal(generationRows(concurrent, [...snapshot.nodes, concurrent], [...snapshot.connections, edge(table.id, concurrent.id)]).length, count);
            const ordinary = { ...table, metadata: { ...table.metadata, tableRowsFromData: undefined } }; assert.equal(tableRows(ordinary, [...snapshot.nodes.filter((n) => n.id !== table.id), ordinary], snapshot.connections).length, Math.max(count, 4), "manual table behavior unchanged");
        }
    });
}

async function workflowTests() {
    await check("LLM platform/model switches preserve same-name channel identity and exact request credentials", async () => {
        const ui = await setup();
        try {
            assert.equal(label(ui.el, "LLM 平台").value, "text-a"); assert.equal(label(ui.el, "LLM 模型").value, "text-a::same-model"); assert.equal(llmNodeDefinition.hidePanel, true); assert.equal(llmNodeDefinition.hasSourceHandle, true);
            await value(label(ui.el, "LLM 平台"), "text-b"); assert.equal(label(ui.el, "LLM 模型").value, ""); await value(label(ui.el, "LLM 模型"), "text-b::same-model");
            await fire(button(ui.el, "开始分析"), mouse());
            assert.equal(requests.length, 1); assert.equal(requests[0].url, "https://text-b.invalid/v1/responses"); assert.equal(requests[0].headers.Authorization, "Bearer synthetic-text-b"); assert.equal(requests[0].body.model, "same-model");
            const result = ui.state().nodes.find((n) => n.id === ui.host().getNode("llm")!.metadata!.llmOutputNodeId)!;
            assert.equal(result.type, "text"); assert.equal(result.metadata!.content, "分析成功"); assert.equal(ui.host().getNode("llm")!.metadata!.status, "success"); assert.ok(ui.state().connections.some((c) => c.fromNodeId === "llm" && c.toNodeId === result.id));
        } finally { await ui.close(); }
    });
    await check("multimodal images/groups reach real host as Responses input_image alongside upstream text", async () => {
        const source = llm(), group = node("group", "group"), first = image("first", input, { groupId: group.id }), second = image("second", input2, { groupId: group.id }), text = node("text", "text", { content: "翻译英文" });
        const ui = await setup(source, [group, first, second, text], [edge(group.id, source.id), edge(text.id, source.id)]);
        try { await fire(button(ui.el, "开始分析"), mouse()); assert.equal(requests.length, 1); assert.equal(requests[0].headers.Authorization, "Bearer synthetic-text-a"); const content = requests[0].body.input.at(-1).content; assert.ok(content[0].text.startsWith("翻译英文\n\n请分析图片")); assert.ok(content[0].text.includes("图片组，共 2 张")); assert.deepEqual(content.slice(1), [{ type: "input_image", image_url: input }, { type: "input_image", image_url: input2 }]); }
        finally { await ui.close(); }
    });
    await check("list result creates editable table with original images, output flow and concurrent-ready rows", async () => {
        const source = llm(), group = node("group", "group"), first = image("first", input, { groupId: group.id }), second = image("second", input2, { groupId: group.id }), ui = await setup(source, [group, first, second], [edge(group.id, source.id)]);
        reply = async () => responseText("```json\n" + tableJson + "\n```");
        try {
            await value(label(ui.el, "LLM 输出模式"), "list"); await fire(button(ui.el, "开始分析"), mouse());
            assert.equal(requests.length, 1); assert.ok(requests[0].body.input.some((m: any) => m.role === "system" && JSON.stringify(m.content).includes("kind")));
            const table = ui.state().nodes.find((n) => n.id === ui.host().getNode(source.id)!.metadata!.llmOutputNodeId)!; assert.equal(table.type, TABLE_TYPE); assert.deepEqual(table.metadata!.table, parseLlmTable(tableJson));
            const rows = tableRows(table, ui.state().nodes, ui.state().connections); assert.deepEqual(rows.map((r) => r.media.map((m) => m.url)), [[input], [input2]]); assert.equal(rows[0].text, "图片一\n翻译英文"); assert.ok(!rows[0].text.includes("kind"));
            const concurrent = node("concurrent", CONCURRENT_TYPE), connections = [...ui.state().connections, edge(table.id, concurrent.id)]; assert.deepEqual(generationRows(concurrent, [...ui.state().nodes, concurrent], connections), rows);
            await act(async () => ui.host().applyOps([{ type: "update_node", id: table.id, metadata: { table: { ...table.metadata!.table!, rows: [["可编辑", "修改后"], ["第二", "保留"]] } } }])); assert.equal(tableRows(ui.host().getNode(table.id)!, ui.state().nodes, connections)[0].text, "可编辑\n修改后");
        } finally { await ui.close(); }
    });
    await check("selected saved text protocol is used, image key never substituted", async () => {
        const protocol = { format: "canvas-call/v1" as const, id: "llm-test-text", label: "LLM 测试文本", capability: "text" as const, script: 'const result = await http.post("/custom-text", { model, messages }); return result.text;' };
        useCallProtocolStore.setState({ protocols: [protocol] });
        const initial = config(); initial.channels = initial.channels.map((c) => c.id === "text-b" ? { ...c, protocolId: protocol.id } : c);
        const ui = await setup(node("llm", LLM_TYPE, { prompt: "自定义协议", model: "text-b::same-model", llmChannelId: "text-b" }), [], [], initial); let protocolRequests = 0;
        axios.defaults.adapter = async (request) => { protocolRequests++; assert.equal(request.url, "https://text-b.invalid/v1/custom-text"); assert.equal(request.headers.Authorization, "Bearer synthetic-text-b"); assert.equal(JSON.parse(request.data).model, "same-model"); return { data: { text: "协议文本输出" }, status: 200, statusText: "OK", headers: {}, config: request }; };
        try { await fire(button(ui.el, "开始分析"), mouse()); assert.equal(protocolRequests, 1); assert.equal(requests.length, 0); assert.equal(ui.host().getNode("llm")!.metadata!.content, "协议文本输出"); }
        finally { await ui.close(); useCallProtocolStore.setState({ protocols: [] }); }
    });
    await check("missing platform/model, empty text key, image-only selection all block without fallback", async () => {
        for (const metadata of [{ model: "missing::same-model", llmChannelId: "missing" }, { model: "text-a::missing", llmChannelId: "text-a" }, { model: "image::same-model", llmChannelId: "image" }, { model: "text-a::same-model", llmChannelId: "text-b" }]) {
            const ui = await setup(node("llm", LLM_TYPE, { ...metadata, prompt: "不应请求" }));
            try { await fire(button(ui.el, "开始分析"), mouse()); assert.equal(requests.length, 0); assert.ok(ui.el.querySelector('[role="alert"]')?.textContent?.includes("不会回退")); assert.equal(ui.host().getNode("llm")!.metadata!.status, "error"); }
            finally { await ui.close(); }
        }
        const initial = config(); initial.channels = initial.channels.map((c) => c.id === "text-a" ? { ...c, apiKey: "" } : c); const ui = await setup(llm(), [], [], initial);
        try { await fire(button(ui.el, "开始分析"), mouse()); assert.equal(requests.length, 0); assert.ok(ui.el.querySelector('[role="alert"]')?.textContent?.includes("独立 API Key")); }
        finally { await ui.close(); }
    });
    await check("malformed list, HTTP failure, unsupported media and empty inputs surface error, create no outputs", async () => {
        for (const scenario of ["malformed", "http", "unsupported", "empty"] as const) {
            const source = node("llm", LLM_TYPE, { prompt: scenario === "empty" ? "" : "分析", llmOutputMode: "list" }), unsupported = node("video", "video", { content: "https://video.invalid/a.mp4" });
            const ui = await setup(source, scenario === "unsupported" ? [unsupported] : [], scenario === "unsupported" ? [edge(unsupported.id, source.id)] : []);
            reply = scenario === "http" ? async () => new Response('{"error":{"message":"synthetic rejected"}}', { status: 403 }) : async () => responseText("not table json");
            try { await fire(button(ui.el, "开始分析"), mouse()); assert.equal(ui.state().nodes.length, scenario === "unsupported" ? 2 : 1); assert.equal(ui.state().connections.length, scenario === "unsupported" ? 1 : 0); assert.equal(ui.host().getNode("llm")!.metadata!.status, "error"); assert.ok(ui.el.querySelector('[role="alert"]')?.textContent); assert.equal(requests.length, scenario === "unsupported" || scenario === "empty" ? 0 : 1); }
            finally { await ui.close(); }
        }
    });
    await check("empty API responses fail text/list analysis without success placeholder or output node", async () => {
        for (const mode of ["text", "list"] as const) for (const empty of ["", " \n\t"]) {
            const ui = await setup(node("llm", LLM_TYPE, { prompt: "分析", llmOutputMode: mode })); reply = async () => responseText(empty);
            try {
                await fire(button(ui.el, "开始分析"), mouse()); assert.equal(requests.length, 1); assert.equal(ui.state().nodes.length, 1); assert.equal(ui.state().connections.length, 0); assert.equal(ui.host().getNode("llm")!.metadata!.status, "error"); assert.ok(ui.el.querySelector('[role="alert"]')?.textContent?.includes("没有返回内容")); assert.equal(ui.host().getNode("llm")!.metadata!.content, undefined);
            } finally { await ui.close(); }
        }
    });
    await check("in-flight duplicate sends locked; stop/delete/unmount abort and discard transport late result", async () => {
        for (const action of ["stop", "delete", "unmount"] as const) {
            const ui = await setup(); let finish!: (response: Response) => void; reply = () => new Promise((resolve) => { finish = resolve; });
            const start = button(ui.el, "开始分析");
            await act(async () => { start.dispatchEvent(mouse()); start.dispatchEvent(mouse()); await tick(); });
            assert.equal(requests.length, 1); for (const name of ["LLM 平台", "LLM 模型", "LLM 输出模式", "LLM 提示词"]) assert.equal(label(ui.el, name).disabled, true, name);
            if (action === "stop") await fire(button(ui.el, "停止"), mouse());
            else if (action === "delete") await ui.remove(); else await ui.close();
            assert.equal(requests[0].signal?.aborted, true, action);
            const before = ui.state().nodes.length;
            await act(async () => { finish(responseText("必须丢弃的晚到结果")); await tick(); });
            assert.equal(ui.state().nodes.length, before); assert.equal(ui.state().connections.length, 0); assert.ok(!ui.state().nodes.some((n) => n.type === "text"));
            if (action === "stop") { assert.equal(ui.host().getNode("llm")!.metadata!.status, "idle"); assert.ok(button(ui.el, "开始分析")); }
            if (action !== "unmount") await ui.close();
        }
    });
    await check("cancel/restart race ignores old late success and error without stopping new run", async () => {
        for (const outcome of ["resolve", "reject"] as const) {
            const ui = await setup(); let finish!: (response: Response) => void, fail!: (error: Error) => void;
            reply = () => new Promise((resolve, reject) => { finish = resolve; fail = reject; });
            try {
                await fire(button(ui.el, "开始分析"), mouse()); assert.equal(requests.length, 1); await fire(button(ui.el, "停止"), mouse()); assert.ok(button(ui.el, "开始分析"));
                reply = async () => responseText("新一轮有效输出"); await fire(button(ui.el, "开始分析"), mouse()); assert.equal(requests.length, 2); assert.equal(ui.host().getNode("llm")!.metadata!.content, "新一轮有效输出");
                await act(async () => { if (outcome === "resolve") finish(responseText("旧结果必须丢弃")); else fail(new Error("旧错误必须丢弃")); await tick(); });
                assert.equal(ui.host().getNode("llm")!.metadata!.content, "新一轮有效输出"); assert.equal(ui.host().getNode("llm")!.metadata!.status, "success"); assert.equal(ui.state().nodes.filter((n) => n.type === "text").length, 1); assert.equal(ui.el.querySelector('[role="alert"]'), null);
            } finally { await ui.close(); }
        }
    });
    await check("focused LLM buttons/selects suppress Space repeat/up, controls pan/zoom without movement/send", async () => {
        const ui = await setup(); const position = { ...ui.host().getNode("llm")!.position };
        try {
            const controls = [label(ui.el, "LLM 平台"), label(ui.el, "LLM 模型"), label(ui.el, "LLM 输出模式"), button(ui.el, "开始分析")];
            for (const control of controls) {
                control.focus(); assert.equal(document.activeElement, control);
                const a = await fire(control, space("keydown")), repeat = await fire(control, space("keydown", true)), up = await fire(control, space("keyup")); assert.ok(a.defaultPrevented && repeat.defaultPrevented && up.defaultPrevented);
                assert.equal(requests.length, 0);
                const start = { ...ui.state().viewport }; await fire(control, space("keydown")); await fire(control, pointer("pointerdown", { clientX: 100, clientY: 100 })); await fire(window, pointer("pointermove", { clientX: 150, clientY: 130 })); await act(async () => { await tick(25); }); await fire(window, pointer("pointerup")); await fire(control, mouse()); await fire(control, space("keyup"));
                assert.equal(ui.state().viewport.x, start.x + 50); assert.equal(ui.state().viewport.y, start.y + 30); assert.equal(ui.drags(), 0); assert.equal(requests.length, 0);
                const scale = ui.state().viewport.k, wheel = await fire(control, new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 150, clientY: 130 })); assert.ok(wheel.defaultPrevented); assert.ok(ui.state().viewport.k > scale); assert.deepEqual(ui.host().getNode("llm")!.position, position);
            }
            const prompt = label(ui.el, "LLM 提示词") as unknown as HTMLTextAreaElement; prompt.focus(); const typedSpace = await fire(prompt, space("keydown")); assert.equal(typedSpace.defaultPrevented, false); await value(prompt, "分析 要求"); assert.equal(ui.host().getNode("llm")!.metadata!.prompt, "分析 要求");
        } finally { await ui.close(); }
    });
}

async function main() {
    await useCallProtocolStore.persist.rehydrate();
    await helperTests(); await workflowTests();
    globalThis.fetch = original.fetch; axios.defaults.adapter = original.adapter;
    fs.mkdirSync(".checks", { recursive: true }); const passed = results.filter((r) => r.passed).length;
    fs.writeFileSync(".checks/llm-tests-result.txt", `${passed}/${results.length} passed\n` + results.map((r) => `${r.passed ? "PASS" : "FAIL"} ${r.name}${r.detail ? "\n" + r.detail : ""}`).join("\n") + "\n");
    console.log(`LLM offline acceptance: ${passed}/${results.length} passed`); if (passed !== results.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
