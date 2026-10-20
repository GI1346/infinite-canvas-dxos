import assert from "node:assert/strict";
import fs from "node:fs";
import { expandDragNodeIds, cloneDragSelection } from "../src/lib/canvas/canvas-drag-copy";
import { tableRows } from "../src/lib/canvas/dxos-table";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";
import { useCallProtocolStore } from "../src/stores/use-call-protocol-store";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasNodeImage, CanvasConnection } from "../src/types/canvas";

const results: { name: string; passed: boolean; detail?: string }[] = [];
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error("Pure drag copying must not make network requests"); };
await Promise.all([useConfigStore.persist.rehydrate(), useCallProtocolStore.persist.rehydrate()]);
useConfigStore.setState({ config: { ...defaultConfig, channels: defaultConfig.channels.map((channel, i) => ({ ...channel, apiKey: `synthetic-independent-${i}`, protocolId: `synthetic-${i}` })) } });
useCallProtocolStore.setState({ protocols: [{ format: "canvas-call/v1", id: "synthetic-copy", label: "not executed", capability: "image", script: 'throw new Error("never execute on copy")' }] });
const configSnapshot = JSON.stringify(useConfigStore.getState().config), protocolSnapshot = JSON.stringify(useCallProtocolStore.getState().protocols);
const node = (id: string, type = "image", metadata?: CanvasNodeMetadata): CanvasNodeData => ({ id, type, title: `原名称-${id}`, position: { x: id.length * 10, y: id.length * 20 }, width: 320, height: 240, ...(metadata ? { metadata } : {}) });
const group = (id: string, groupId?: string) => node(id, "group", groupId ? { groupId } : undefined);
const edge = (id: string, fromNodeId: string, toNodeId: string, toPort?: string): CanvasConnection => ({ id, fromNodeId, toNodeId, ...(toPort ? { toPort } : {}) });
const image = (id: string, status: CanvasNodeImage["status"] = "success"): CanvasNodeImage => ({ id, status, content: `blob:${id}`, storageKey: `image:${id}`, naturalWidth: 1024, naturalHeight: 512, mimeType: "image/png", bytes: 99 });
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
async function check(name: string, work: () => unknown | Promise<unknown>) {
    try { await work(); assert.equal(requests, 0); assert.equal(JSON.stringify(useConfigStore.getState().config), configSnapshot); assert.equal(JSON.stringify(useCallProtocolStore.getState().protocols), protocolSnapshot); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, detail: String(error) }); console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}

await check("recursive expansion includes all nested group descendants exactly once and ignores missing IDs", () => {
    const nodes = [group("outer"), group("inner", "outer"), group("deep", "inner"), node("image", "image", { groupId: "deep" }), node("text", "text", { groupId: "outer" }), node("llm", "dxos:llm", { groupId: "inner" }), node("unselected")];
    const selected = new Set(["outer", "inner", "image", "missing"]), original = [...selected];
    assert.deepEqual(expandDragNodeIds(selected, nodes), new Set(["outer", "inner", "deep", "image", "text", "llm"])); assert.deepEqual([...selected], original);
});
await check("group cycles terminate without duplicating nodes or traversing non-group children", () => {
    const nodes = [group("a", "b"), group("b", "a"), node("img", "image", { groupId: "a" }), node("invalid-child", "text", { groupId: "img" })];
    assert.deepEqual(expandDragNodeIds(new Set(["a", "b"]), nodes), new Set(["a", "b", "img"]));
});
await check("copies stay at original position, retain names/sizes and get independent fresh IDs per gesture", () => {
    const nodes = freeze([node("a"), node("b", "text", { content: "保留文字" })]), first = cloneDragSelection(nodes, [], new Set(["a", "b"])), second = cloneDragSelection(nodes, [], new Set(["a", "b"]));
    const used = new Set(nodes.map((item) => item.id)); for (const output of [first, second]) for (const [i, item] of output.nodes.entries()) { assert.equal(used.has(item.id), false); used.add(item.id); assert.deepEqual(item.position, nodes[i].position); assert.notEqual(item.position, nodes[i].position); assert.equal(item.title, nodes[i].title); assert.equal(item.width, nodes[i].width); assert.equal(item.height, nodes[i].height); }
    assert.equal(first.selectedIds.size, 2); assert.deepEqual(first.selectedIds, new Set(first.nodes.map((item) => item.id))); assert.deepEqual(first.connections, []);
});
await check("group copying remaps internal parents, detaches external root and preserves original selection semantics", () => {
    const nodes = freeze([group("external"), group("outer", "external"), group("inner", "outer"), node("image", "image", { groupId: "inner" }), node("text", "text", { groupId: "outer" })]);
    const result = cloneDragSelection(nodes, [], new Set(["outer", "image", "missing"])), [outer, inner, image, text] = result.nodes;
    assert.equal(outer.metadata?.groupId, undefined); assert.equal(inner.metadata?.groupId, outer.id); assert.equal(image.metadata?.groupId, inner.id); assert.equal(text.metadata?.groupId, outer.id); assert.deepEqual(result.selectedIds, new Set([outer.id, image.id]));
    const solo = cloneDragSelection(nodes, [], new Set(["image"])); assert.equal(solo.nodes.length, 1); assert.equal(solo.nodes[0].metadata?.groupId, undefined);
});
await check("internal and all external incoming/outgoing edges copy with fresh IDs and ports while originals stay unchanged", () => {
    const nodes = freeze([node("outside"), node("a"), node("table", "dxos:table"), node("llm", "dxos:llm")]);
    const connections = freeze([edge("in", "outside", "a"), edge("internal", "a", "table", "input-3"), edge("parallel", "a", "table", "input-1"), edge("flow", "llm", "table", "llm-output"), edge("out", "table", "outside"), edge("loop", "a", "a"), edge("unrelated", "outside", "llm")]);
    const snapshot = JSON.stringify({ nodes, connections }), result = cloneDragSelection(nodes, connections, new Set(["a", "table"])), [a, table] = result.nodes;
    assert.equal(result.connections.length, 6); assert.deepEqual(result.connections.map(({ fromNodeId, toNodeId, toPort }) => ({ fromNodeId, toNodeId, ...(toPort ? { toPort } : {}) })), [edge("", "outside", a.id), edge("", a.id, table.id, "input-3"), edge("", a.id, table.id, "input-1"), edge("", "llm", table.id, "llm-output"), edge("", table.id, "outside"), edge("", a.id, a.id)].map(({ id, ...rest }) => rest));
    const originalIds = new Set([...nodes.map((item) => item.id), ...connections.map((item) => item.id)]); for (const connection of result.connections) { assert.equal(originalIds.has(connection.id), false); originalIds.add(connection.id); }
    assert.equal(JSON.stringify({ nodes, connections }), snapshot);
});
await check("a single copied image retains its input and downstream table port without copying unrelated graph nodes", () => {
    const nodes = freeze([node("input", "text"), node("image"), node("table", "dxos:table"), node("else")]);
    const connections = freeze([edge("prompt", "input", "image"), edge("image-out", "image", "table", "input-2"), edge("other", "else", "table", "input-1")]);
    const result = cloneDragSelection(nodes, connections, new Set(["image"])), copied = result.nodes[0];
    assert.equal(result.nodes.length, 1); assert.equal(result.connections.length, 2); assert.deepEqual(result.connections.map(({ fromNodeId, toNodeId, toPort }) => ({ fromNodeId, toNodeId, ...(toPort ? { toPort } : {}) })), [{ fromNodeId: "input", toNodeId: copied.id }, { fromNodeId: copied.id, toNodeId: "table", toPort: "input-2" }]);
});
await check("metadata is deeply cloned without sharing tables, pins, media arrays or nested result references", () => {
    const original = node("table", "dxos:table", { table: { kind: "table", version: 1, columns: ["prompt"], rows: [["保留"]], selectedRows: [0], mergedGroups: [[0, 1]] }, tableInputChannels: [{ id: "input-1", mode: "sequence", imagesOnly: true, mediaNodeIds: ["outside"] }], images: [image("success")], texts: [{ id: "text1", status: "success", content: "保存" }], references: ["image:source"], tableBatchSelectedRows: [1], count: 3 });
    const copied = cloneDragSelection([original], [], new Set([original.id])).nodes[0];
    copied.metadata!.table!.rows[0][0] = "changed"; copied.metadata!.table!.mergedGroups[0].push(7); copied.metadata!.tableInputChannels![0].mediaNodeIds!.push("new"); copied.metadata!.images![0].content = "changed"; copied.metadata!.texts![0].content = "changed"; copied.metadata!.references!.push("changed"); copied.metadata!.tableBatchSelectedRows!.push(2);
    assert.equal(original.metadata!.table!.rows[0][0], "保留"); assert.deepEqual(original.metadata!.table!.mergedGroups, [[0, 1]]); assert.deepEqual(original.metadata!.tableInputChannels![0].mediaNodeIds, ["outside"]); assert.equal(original.metadata!.images![0].content, "blob:success"); assert.equal(original.metadata!.texts![0].content, "保存"); assert.deepEqual(original.metadata!.references, ["image:source"]); assert.deepEqual(original.metadata!.tableBatchSelectedRows, [1]);
});
await check("LLM output and image pins map exact copied IDs and batch prefixes without touching external references", () => {
    const nodes = freeze([node("source", "image", { images: [image("batch-one")] }), node("source:long", "image", { images: [image("batch-two")] }), node("llm", "dxos:llm", { llmOutputNodeId: "table" }), node("table", "dxos:table", { tableInputChannels: [{ id: "input-1", mode: "sequence", imagesOnly: true, mediaNodeIds: ["source", "source:batch-one", "source:long:batch-two", "source-other:batch-one", "external:batch"] }] })]);
    const result = cloneDragSelection(nodes, [], new Set(nodes.map((item) => item.id))), [source, longer, llm, table] = result.nodes;
    assert.equal(llm.metadata!.llmOutputNodeId, table.id); assert.deepEqual(table.metadata!.tableInputChannels![0].mediaNodeIds, [source.id, `${source.id}:batch-one`, `${longer.id}:batch-two`, "source-other:batch-one", "external:batch"]); assert.equal(source.metadata!.images![0].id, "batch-one");
    const external = cloneDragSelection([node("llm", "dxos:llm", { llmOutputNodeId: "outside" })], [], new Set(["llm"])); assert.equal(external.nodes[0].metadata!.llmOutputNodeId, "outside");
});
await check("copied table image pins still resolve through copied sources and retain sequence/shared semantics", () => {
    const a = node("a", "image", { images: [image("one"), image("two")] }), b = node("b", "image", { content: "blob:shared" }), table = node("table", "dxos:table", { table: { kind: "table", version: 1, columns: ["prompt"], rows: [["first"], ["second"]], selectedRows: [], mergedGroups: [] }, tableRowsFromData: true, tableInputChannels: [{ id: "input-1", mode: "sequence", imagesOnly: true, mediaNodeIds: ["a:one", "a:two"] }, { id: "input-2", mode: "shared", imagesOnly: true, mediaNodeIds: ["b"] }] });
    const result = cloneDragSelection([a, b, table], [edge("a-in", "a", "table", "input-1"), edge("b-in", "b", "table", "input-2")], new Set(["a", "b", "table"])), [newA, newB, newTable] = result.nodes, rows = tableRows(newTable, result.nodes, result.connections);
    assert.equal(rows.length, 2); assert.deepEqual(rows.map((row) => row.media.map((media) => media.nodeId)), [[`${newA.id}:one`, newB.id], [`${newA.id}:two`, newB.id]]); assert.deepEqual(rows.map((row) => row.text), ["first", "second"]);
});
await check("active execution is not inherited: idle copies cannot resume video/batch work or loading item states", () => {
    const nodes = freeze([node("video", "video", { status: "loading", errorDetails: "old", videoTaskId: "synthetic-task", videoTaskProvider: "openai", model: "image::model", prompt: "preserved" }), node("concurrent", "dxos:concurrent", { status: "loading", tableBatchRun: { id: "synthetic-batch", state: "running", tasks: [{ rowNumber: 1, status: "running", outputIds: ["video"] }] }, tableBatchConcurrency: 4, tableBatchSelectedRows: [1], tableBatchStartRow: 2, tableBatchManualSelection: true }), node("output", "image", { status: "loading", images: [image("pending", "loading"), image("done"), image("error", "error")], texts: [{ id: "pending-text", status: "loading", content: "" }, { id: "success-text", status: "success", content: "保留" }], primaryImageId: "done", primaryTextId: "success-text" })]);
    const result = cloneDragSelection(nodes, [], new Set(nodes.map((item) => item.id))), [video, concurrent, output] = result.nodes;
    assert.equal(video.metadata!.status, "idle"); assert.equal(video.metadata!.errorDetails, undefined); assert.equal(video.metadata!.videoTaskId, undefined); assert.equal(video.metadata!.videoTaskProvider, undefined); assert.equal(video.metadata!.model, "image::model"); assert.equal(video.metadata!.prompt, "preserved");
    assert.equal(concurrent.metadata!.tableBatchRun, undefined); assert.equal(concurrent.metadata!.tableBatchConcurrency, 4); assert.equal(concurrent.metadata!.tableBatchManualSelection, true); assert.deepEqual(concurrent.metadata!.tableBatchSelectedRows, [1]);
    assert.equal(output.metadata!.status, "idle"); assert.equal(output.metadata!.images![0].status, "error"); assert.ok(output.metadata!.images![0].errorDetails); assert.equal(output.metadata!.images![1].status, "success"); assert.equal(output.metadata!.images![2].status, "error"); assert.equal(output.metadata!.texts![0].status, "error"); assert.equal(output.metadata!.texts![1].status, "success"); assert.equal(output.metadata!.primaryImageId, "done"); assert.equal(output.metadata!.primaryTextId, "success-text");
});
await check("finished task permissions are removed while successful content, storage and model configuration remain", () => {
    const original = freeze(node("success", "video", { status: "success", content: "blob:finished", storageKey: "video:keep", mimeType: "video/mp4", videoTaskId: "already-completed", videoTaskProvider: "gemini", tableBatchRun: { id: "done", state: "completed", tasks: [{ rowNumber: 1, status: "success", outputIds: ["success"] }] }, quality: "high", size: "2048x1024", llmChannelId: "text", llmOutputMode: "list" }));
    const copy = cloneDragSelection([original], [], new Set([original.id])).nodes[0];
    assert.equal(copy.metadata!.status, "success"); assert.equal(copy.metadata!.content, "blob:finished"); assert.equal(copy.metadata!.storageKey, "video:keep"); assert.equal(copy.metadata!.videoTaskId, undefined); assert.equal(copy.metadata!.tableBatchRun, undefined); assert.equal(copy.metadata!.quality, "high"); assert.equal(copy.metadata!.size, "2048x1024"); assert.equal(copy.metadata!.llmChannelId, "text"); assert.equal(copy.metadata!.llmOutputMode, "list");
});
await check("missing and empty selections are pure no-op without touching source array identities", () => {
    const nodes = freeze([node("a")]), connections = freeze([edge("self", "a", "a")]);
    for (const selected of [new Set<string>(), new Set(["missing"])]) { const result = cloneDragSelection(nodes, connections, selected); assert.deepEqual(result.nodes, []); assert.deepEqual(result.connections, []); assert.deepEqual(result.selectedIds, new Set()); }
});

globalThis.fetch = originalFetch;
fs.mkdirSync(".checks", { recursive: true }); fs.writeFileSync(".checks/drag-copy-results.json", JSON.stringify(results, null, 2));
console.log(`${results.filter((result) => result.passed).length}/${results.length} drag copying helper checks passed`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
