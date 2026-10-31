import assert from "node:assert/strict";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { harnessBusyProjects } from "../src/lib/canvas/harness-canvas-busy";
import { executeHarnessCanvasTool, openDeepSeekHarness, type HarnessCanvasRequest } from "../src/services/api/deepseek-harness";
import { useCanvasAssistantStore, type CanvasAssistantContext } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, encodeChannelModel, useConfigStore } from "../src/stores/use-config-store";

async function main() {
    registerBuiltinNodes();
    const model = encodeChannelModel("fixture", "fixture-image");
    useConfigStore.setState({ config: { ...defaultConfig, imageModel: model, models: [model], channels: [{ id: "fixture", name: "fixture", baseUrl: "https://offline.test", apiKey: "fixture-secret-not-returned", apiFormat: "openai", models: [{ name: "fixture-image", capability: "image" }] }] } });
    let snapshot: CanvasAgentSnapshot = { projectId: "harness-test", title: "fixture", nodes: [{ id: "text-source", type: "text", title: "提示词", position: { x: 0, y: 0 }, width: 320, height: 200, metadata: { content: "EXACT_PRODUCT_PROMPT", prompt: "EXACT_PRODUCT_PROMPT" } }], connections: [], selectedNodeIds: [], viewport: { x: -100, y: -100, k: 0.5 } };
    let runs = 0;
    const context: CanvasAssistantContext = { snapshot, getSnapshot: () => snapshot, getCreationCenter: () => ({ x: 800, y: 600 }), applyOps: (ops) => snapshot = applyCanvasAgentOps(snapshot, ops), runNode: async (id, mode, _prompt, signal) => {
        assert(!signal?.aborted); assert.equal(mode, "image"); runs++;
        const node = snapshot.nodes.find((item) => item.id === id)!;
        assert.equal(node.metadata?.size, "1360x2048", "real pixels must be set before the first call");
        const output = { ...node, id: "actual-output", metadata: { ...node.metadata, status: "success" as const, naturalWidth: 1360, naturalHeight: 2048, content: "data:image/png;base64,fixture" } };
        snapshot = { ...snapshot, nodes: [...snapshot.nodes, output] };
        return output;
    } };
    useCanvasAssistantStore.setState({ context, sessions: [] });
    const call = (tool: string, args: Record<string, unknown> = {}, signal = new AbortController().signal) => executeHarnessCanvasTool({ id: "request", projectId: "harness-test", tool, args }, signal);
    const index = await call("read_canvas");
    assert(!JSON.stringify(index).includes("EXACT_PRODUCT_PROMPT")); assert(!JSON.stringify(index).includes("fixture-secret"));
    assert(JSON.stringify(index).includes(model)); assert(JSON.stringify(index).includes("selectedNodeIds"));
    assert(JSON.stringify(await call("read_canvas", { nodeIds: ["text-source"] })).includes("EXACT_PRODUCT_PROMPT"));
    const created = await call("apply_workflow", { nodes: [{ key: "image", type: "image", model }], connections: [], sourceNodeIds: ["text-source"] });
    const imageId = (created.value as { resolvedNodes: Array<{ id: string }> }).resolvedNodes[0].id;
    assert(snapshot.connections.some((edge) => edge.fromNodeId === "text-source" && edge.toNodeId === imageId));
    const image = snapshot.nodes.find((node) => node.id === imageId)!;
    assert(Math.abs(image.position.x + image.width / 2 - 800) < 1);
    const result = await call("run_nodes", { nodeIds: [imageId], requirements: "生成图片，2K，2:3" });
    const outcomes = (result.value as { outcomes: Array<{ id: string; sourceNodeId: string; width: number }> }).outcomes;
    assert.equal(runs, 1); assert.equal(outcomes[0].id, "actual-output"); assert.equal(outcomes[0].sourceNodeId, imageId); assert.equal(outcomes[0].width, 1360);
    assert.equal(harnessBusyProjects.size, 0);
    await assert.rejects(call("run_nodes", { nodeIds: [imageId], parameters: [] }), /parameters/);
    await assert.rejects(call("unknown"), /无效/);
    await assert.rejects(executeHarnessCanvasTool({ id: "wrong", projectId: "other", tool: "edit_canvas", args: { action: "delete", nodeIds: [imageId] } }, new AbortController().signal), /画布已切换/);
    const canceled = new AbortController(); canceled.abort(); await assert.rejects(call("read_canvas", {}, canceled.signal), /任务已停止/);
    harnessBusyProjects.add("harness-test"); await assert.rejects(call("edit_canvas", { action: "delete", nodeIds: [imageId] }), /正在执行/); harnessBusyProjects.clear();
    const requests: string[] = [];
    window.blinkflowHarness = { open: async ({ projectId }) => { requests.push(projectId); return { url: "http://127.0.0.1:1234" }; }, onTool: (_handler: (request: HarnessCanvasRequest) => void) => () => {}, respond: () => {} };
    await openDeepSeekHarness(); assert.deepEqual(requests, ["harness-test"]);
    assert(snapshot.nodes.some((node) => node.id === imageId), "rejected requests cannot delete nodes");
    console.log("PASS Harness compact/focused reads, real channel IDs, text links, centered creation, first-call size, real output ID, isolation and cancellation; no network used.");
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
