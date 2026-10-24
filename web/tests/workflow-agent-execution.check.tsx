import assert from "node:assert/strict";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { isWorkflowNodeRunning, runWorkflowNode, stopWorkflowNode, type CanvasWorkflowHost } from "../src/lib/canvas/canvas-workflow-runner";
import { defaultConfig, encodeChannelModel, type AiConfig } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";
import type { CanvasPluginAi } from "../src/types/canvas-plugin";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const text = encodeChannelModel("text", "same"), image = encodeChannelModel("image", "same"), other = encodeChannelModel("other", "same");
const config: AiConfig = { ...defaultConfig, channels: [{ id: "text", name: "Text", baseUrl: "https://text.test", apiKey: "stub-text", apiFormat: "openai", models: [{ name: "same", capability: "text" }] }, { id: "image", name: "Image", baseUrl: "https://image.test", apiKey: "stub-image", apiFormat: "openai", models: [{ name: "same", capability: "image" }] }, { id: "other", name: "Other", baseUrl: "https://other.test", apiKey: "stub-other", apiFormat: "openai", models: [{ name: "same", capability: "text" }] }], models: [text, image, other], textModel: text, imageModel: image };
const item = (id: string, type: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 240, metadata });
function hostOf(nodes: CanvasNodeData[], edges: Array<{ fromNodeId: string; toNodeId: string; toPort?: string }> = []) {
    let snapshot: CanvasAgentSnapshot = { projectId: "workflow-check", title: "check", nodes, connections: edges.map((edge, index) => ({ id: String(index), ...edge })), selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    let live = true, configNow = config, runText: CanvasPluginAi["generateText"] = async () => ({ text: "OK" });
    const calls: Array<{ kind: string; prompt: string; model?: string; references?: string[]; system?: string }> = [];
    const ai: CanvasPluginAi = { generateText: async (prompt, options) => { calls.push({ kind: "text", prompt, ...options }); return runText(prompt, options); }, generateImage: async (prompt, options) => { calls.push({ kind: "image", prompt, ...options }); throw new Error("image fake failure"); }, generateVideo: async () => { throw new Error("video must not run"); }, listModels: (kind) => configNow.channels.flatMap((channel) => channel.models.filter((model) => !kind || model.capability === kind).map((model) => ({ value: encodeChannelModel(channel.id, model.name), label: model.name }))), defaultModel: (kind) => kind === "image" ? image : text };
    const host: CanvasWorkflowHost = { getNode: (id) => snapshot.nodes.find((node) => node.id === id), getNodes: () => snapshot.nodes, getConnections: () => snapshot.connections, applyOps: (ops) => { snapshot = applyCanvasAgentOps(snapshot, ops); }, ai, getConfig: () => configNow, isActive: () => live };
    return { host, calls, graph: () => snapshot, setActive: (value: boolean) => { live = value; }, setConfig: (value: AiConfig) => { configNow = value; }, setText: (value: typeof runText) => { runText = value; } };
}
async function main() {
    registerBuiltinNodes();
    // Block all accidental real networking; these checks use only injected fake AI methods.
    globalThis.fetch = async () => { throw new Error("Network forbidden in workflow test"); };
    const llm = hostOf([item("input", "text", { content: "输入正文" }), item("llm", "dxos:llm", { model: other, llmChannelId: "other", prompt: "分析它" })], [{ fromNodeId: "input", toNodeId: "llm" }]);
    let resolveText!: (result: { text: string }) => void; llm.setText(() => new Promise((resolve) => { resolveText = resolve; }));
    let settled = false; const promise = runWorkflowNode("llm", llm.host).finally(() => { settled = true; }); await tick(); assert(!settled); assert(isWorkflowNodeRunning("llm")); assert.equal(llm.graph().nodes.length, 2); assert.equal(llm.calls[0].model, other); assert(llm.calls[0].prompt.includes("输入正文")); assert(llm.calls[0].prompt.includes("分析它"));
    await assert.rejects(() => runWorkflowNode("llm", llm.host), /正在运行/); resolveText({ text: "真实等待到的分析" }); const output = await promise; assert.equal(output?.type, "text"); assert.equal(output?.metadata?.content, "真实等待到的分析"); assert.equal(llm.host.getNode("llm")?.metadata?.status, "success"); assert(llm.graph().connections.some((edge) => edge.fromNodeId === "llm" && edge.toNodeId === output?.id)); assert(!isWorkflowNodeRunning("llm"));
    console.log("PASS LLM awaits actual result, forwards encoded independent channel and input prompt, prevents duplicate run and writes connected output.");

    const list = hostOf([item("llm-list", "dxos:llm", { model: text, llmOutputMode: "list", prompt: "列表" })]); list.setText(async () => ({ text: JSON.stringify({ kind: "table", version: 1, columns: ["描述"], rows: [["第一行"], ["第二行"]] }) })); const table = await runWorkflowNode("llm-list", list.host); assert.equal(table?.type, "dxos:table"); assert.equal(table?.metadata?.table?.rows.length, 2); assert(list.calls[0].system?.includes("kind"));
    const bad = hostOf([item("bad", "dxos:llm", { model: text, llmChannelId: "other", prompt: "失败" })]); await assert.rejects(() => runWorkflowNode("bad", bad.host), /当前平台/); assert.equal(bad.calls.length, 0); assert.equal(bad.host.getNode("bad")?.metadata?.status, "error");
    const nokey = hostOf([item("nokey", "dxos:llm", { model: text, prompt: "失败" })]); nokey.setConfig({ ...config, channels: config.channels.map((channel) => channel.id === "text" ? { ...channel, apiKey: "" } : channel) }); await assert.rejects(() => runWorkflowNode("nokey", nokey.host), /独立 API Key/); assert.equal(nokey.calls.length, 0); assert.equal(nokey.host.getNode("nokey")?.metadata?.status, "error");
    const invalid = hostOf([item("invalid", "dxos:llm", { model: text, llmOutputMode: "list", prompt: "错误列表" })]); invalid.setText(async () => ({ text: "不是JSON" })); await assert.rejects(() => runWorkflowNode("invalid", invalid.host), /合法/); assert.equal(invalid.graph().nodes.length, 1); assert.equal(invalid.host.getNode("invalid")?.metadata?.status, "error");
    console.log("PASS LLM list creates editable table; channel mismatch/missing key fail before AI; invalid model JSON produces visible error without output.");

    const aborted = hostOf([item("abort", "dxos:llm", { model: text, prompt: "取消" })]); let resolveAbort!: (value: { text: string }) => void; aborted.setText(() => new Promise((resolve) => { resolveAbort = resolve; })); const abortPromise = runWorkflowNode("abort", aborted.host); await tick(); stopWorkflowNode("abort"); resolveAbort({ text: "不应写入" }); await assert.rejects(() => abortPromise, /已停止/); assert.equal(aborted.graph().nodes.length, 1); assert.equal(aborted.host.getNode("abort")?.metadata?.status, "idle");
    const switched = hostOf([item("switch", "dxos:llm", { model: text, prompt: "切换" })]); let resolveSwitch!: (value: { text: string }) => void; switched.setText(() => new Promise((resolve) => { resolveSwitch = resolve; })); const switchPromise = runWorkflowNode("switch", switched.host); await tick(); switched.setActive(false); resolveSwitch({ text: "不应写入" }); await assert.rejects(() => switchPromise, /画布已切换/); assert.equal(switched.graph().nodes.length, 1);
    console.log("PASS stop and project-liveness reject late LLM results without creating output.");

    const data = { kind: "table" as const, version: 1 as const, columns: ["提示词"], rows: [["行1"], ["行2"]], selectedRows: [], mergedGroups: [] };
    const batch = hostOf([item("table", "dxos:table", { table: data, tableRowsFromData: true }), item("batch", "dxos:concurrent", { generationMode: "text", model: other, prompt: "附加", tableBatchConcurrency: 2 })], [{ fromNodeId: "table", toNodeId: "batch" }]); let running = 0, peak = 0; batch.setText(async (prompt) => { running++; peak = Math.max(peak, running); await tick(); running--; return { text: prompt + " -> 完成" }; }); const batchOutput = await runWorkflowNode("batch", batch.host); assert.equal(batchOutput?.type, "text"); assert.equal(peak, 2); assert.equal(batch.calls.length, 2); assert(batch.calls.every((call) => call.model === other && call.prompt.includes("附加"))); assert(batch.host.getNode("batch")?.metadata?.tableBatchRun?.tasks.every((task) => task.status === "success")); assert.equal(batch.host.getNode("batch")?.metadata?.status, "success"); assert(!isWorkflowNodeRunning("batch"));
    const failed = hostOf([item("table", "dxos:table", { table: data, tableRowsFromData: true }), item("failed", "dxos:concurrent", { generationMode: "text", model: text })], [{ fromNodeId: "table", toNodeId: "failed" }]); failed.setText(async (prompt) => { if (prompt.includes("行2")) throw new Error("stub provider error"); return { text: "OK" }; }); await assert.rejects(() => runWorkflowNode("failed", failed.host), /stub provider error/); assert.deepEqual(failed.host.getNode("failed")?.metadata?.tableBatchRun?.tasks.map((task) => task.status), ["success", "error"]); const firstOutput = failed.host.getNode("failed")?.metadata?.tableBatchRun?.tasks[0].outputIds[0]; const originalCalls = failed.calls.length; failed.setText(async () => ({ text: "retry OK" })); await runWorkflowNode("failed", failed.host, { retry: true }); assert.equal(failed.calls.length, originalCalls + 1); assert(failed.host.getNode(firstOutput!)?.metadata?.content === "OK"); assert.deepEqual(failed.host.getNode("failed")?.metadata?.tableBatchRun?.tasks.map((task) => task.rowNumber), [2]);
    console.log("PASS concurrent runner uses actual row pool, waits all results, persists row errors and retries only unfinished rows.");
    const imageFailure = hostOf([item("table", "dxos:table", { table: { ...data, rows: [["图像测试"]] }, tableRowsFromData: true }), item("img", "dxos:concurrent", { model: image, imageResolution: "4k", imageAspectRatio: "auto", size: "auto" })], [{ fromNodeId: "table", toNodeId: "img" }]); await assert.rejects(() => runWorkflowNode("img", imageFailure.host), /image fake failure/); assert.equal(imageFailure.calls[0].kind, "image"); assert.equal(imageFailure.calls[0].model, image);
    await assert.rejects(() => runWorkflowNode("table", batch.host), /没有专用运行器/);
    console.log("PASS image batch forwards to injected image AI only; table is rejected, never ordinary image generation.");
    const stopped = hostOf([item("table", "dxos:table", { table: data, tableRowsFromData: true }), item("stop-batch", "dxos:concurrent", { generationMode: "text", model: text, tableBatchConcurrency: 1 })], [{ fromNodeId: "table", toNodeId: "stop-batch" }]); let resolveBatch!: (value: { text: string }) => void; stopped.setText(() => new Promise((resolve) => { resolveBatch = resolve; })); const stoppedPromise = runWorkflowNode("stop-batch", stopped.host); await tick(); stopWorkflowNode("stop-batch"); resolveBatch({ text: "迟到输出" }); await assert.rejects(() => stoppedPromise, /已停止/); assert.equal(stopped.calls.length, 1); assert(stopped.host.getNode("stop-batch")?.metadata?.tableBatchRun?.tasks.every((task) => task.status === "stopped")); assert(!stopped.graph().nodes.some((node) => node.metadata?.content === "迟到输出")); assert(!isWorkflowNodeRunning("stop-batch"));
    const changed = hostOf([item("input", "text", { content: "原输入" }), item("changed", "dxos:llm", { model: text, prompt: "分析" })], [{ fromNodeId: "input", toNodeId: "changed" }]); let resolveChanged!: (value: { text: string }) => void; changed.setText(() => new Promise((resolve) => { resolveChanged = resolve; })); const changedPromise = runWorkflowNode("changed", changed.host); await tick(); changed.host.applyOps([{ type: "update_node", id: "input", metadata: { content: "新输入" } }]); resolveChanged({ text: "过期分析" }); await assert.rejects(() => changedPromise, /输入或模型设置发生变化/); assert.equal(changed.graph().nodes.length, 2);
    const deleted = hostOf([item("table", "dxos:table", { table: { ...data, rows: [["单行"]] }, tableRowsFromData: true }), item("deleted", "dxos:concurrent", { generationMode: "text", model: text })], [{ fromNodeId: "table", toNodeId: "deleted" }]); let resolveDeleted!: (value: { text: string }) => void; deleted.setText(() => new Promise((resolve) => { resolveDeleted = resolve; })); const deletedPromise = runWorkflowNode("deleted", deleted.host); await tick(); const outputId = deleted.host.getNode("deleted")?.metadata?.tableBatchRun?.tasks[0].outputIds[0]!; deleted.host.applyOps([{ type: "delete_node", id: outputId }]); resolveDeleted({ text: "不可重建" }); await assert.rejects(() => deletedPromise, /结果节点已删除/); assert(!deleted.host.getNode(outputId));
    console.log("PASS batch stop blocks queued work and late writes; changed LLM input rejects stale result; deleted batch outputs never recreate.");

    // Old transports deliberately ignore AbortSignal. Their results and finally blocks
    // must not overwrite a restarted run or release the restarted run's lock.
    for (const type of ["dxos:llm", "dxos:concurrent"] as const) for (const outcome of ["resolve", "reject"] as const) {
        const id = `restart-${type}-${outcome}`;
        const again = hostOf([item("table", "dxos:table", { table: { ...data, rows: [["单行"]] }, tableRowsFromData: true }), item(id, type, { generationMode: "text", model: text, prompt: "重启" })], type === "dxos:concurrent" ? [{ fromNodeId: "table", toNodeId: id }] : []);
        let oldResolve!: (result: { text: string }) => void, oldReject!: (error: Error) => void, newResolve!: (result: { text: string }) => void;
        again.setText(() => new Promise((resolve, reject) => { oldResolve = resolve; oldReject = reject; }));
        const oldRun = runWorkflowNode(id, again.host).then(() => null, (error: unknown) => error);
        await tick(); stopWorkflowNode(id);
        assert(!isWorkflowNodeRunning(id)); assert.equal(again.host.getNode(id)?.metadata?.status, "idle");
        if (type === "dxos:concurrent") assert(again.host.getNode(id)?.metadata?.tableBatchRun?.tasks.every((task) => task.status === "stopped"));
        again.setText(() => new Promise((resolve) => { newResolve = resolve; }));
        const newRun = runWorkflowNode(id, again.host); await tick();
        assert.equal(again.calls.length, 2); assert(isWorkflowNodeRunning(id));
        const newBatchId = again.host.getNode(id)?.metadata?.tableBatchRun?.id;
        if (outcome === "resolve") oldResolve({ text: "旧结果不得写入" }); else oldReject(new Error("旧错误不得写入"));
        assert((await oldRun) instanceof Error); await tick();
        assert(isWorkflowNodeRunning(id)); assert.equal(again.host.getNode(id)?.metadata?.status, "loading");
        assert.equal(again.host.getNode(id)?.metadata?.tableBatchRun?.id, newBatchId);
        assert(!again.graph().nodes.some((node) => node.metadata?.content === "旧结果不得写入"));
        await assert.rejects(() => runWorkflowNode(id, again.host), /正在运行/);
        newResolve({ text: "新一轮有效结果" }); await newRun;
        assert.equal(again.host.getNode(id)?.metadata?.status, "success"); assert(!isWorkflowNodeRunning(id));
        assert.equal(again.graph().nodes.filter((node) => node.type === "text" && node.metadata?.content === "新一轮有效结果").length, 1);
        assert(!again.host.getNode(id)?.metadata?.errorDetails);
    }
    console.log("PASS preflight metadata and LLM/concurrent immediate restart isolate old ignored-abort success/error and preserve replacement locks.");
}
main().then(() => { console.log("ALL WORKFLOW AGENT EXECUTION CHECKS PASSED"); process.exit(0); }).catch((error) => { console.error(error); process.exit(1); });