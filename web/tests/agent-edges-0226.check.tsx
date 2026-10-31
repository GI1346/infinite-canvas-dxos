import assert from "node:assert/strict";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { assistantPromptSourceIds, assistantWorkflowWithSources, executeAssistantTool, requestAssistantAction, type AssistantAction } from "../src/services/api/canvas-assistant";
import { relayChatScript } from "../src/services/api/relay-chat";
import { useCanvasAssistantStore, type CanvasAssistantContext } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, encodeChannelModel, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";

registerBuiltinNodes();
const chat = encodeChannelModel("chat", "chat"), image = encodeChannelModel("image", "image");
const config: AiConfig = { ...defaultConfig, proxyEnabled: false, models: [chat, image], textModel: chat, imageModel: image, channels: [
    { id: "chat", name: "对话", baseUrl: "https://chat.test", apiKey: "stub-chat", apiFormat: "openai", models: [{ name: "chat", capability: "text", script: relayChatScript }] },
    { id: "image", name: "生图", baseUrl: "https://image.test", apiKey: "stub-image", apiFormat: "openai", models: [{ name: "image", capability: "image" }] },
] };
const textNode = (id: string, content = "本次小猫提示词"): CanvasNodeData => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { content } });
function fixture(projectId: string, nodes: CanvasNodeData[] = []) {
    let graph: CanvasAgentSnapshot = { projectId, title: projectId, nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const prompts: string[] = [];
    const context: CanvasAssistantContext = { snapshot: graph, getSnapshot: () => graph, applyOps: (ops) => graph = applyCanvasAgentOps(graph, ops), runNode: async (id, _mode, prompt) => {
        prompts.push(buildNodeGenerationContext(id, graph.nodes, graph.connections, prompt || "").prompt);
        const output = graph.nodes.find((node) => node.id === id)!;
        graph = applyCanvasAgentOps(graph, [{ type: "update_node", id, metadata: { content: "blob:stub-result", status: "success", naturalWidth: 1360, naturalHeight: 2048 } }]);
        return { ...output, metadata: { ...output.metadata, content: "blob:stub-result", status: "success", naturalWidth: 1360, naturalHeight: 2048 } };
    } };
    return { context, prompts };
}
const signal = new AbortController().signal, state = () => useCanvasAssistantStore.getState(), current = () => state().sessions.find((session) => session.id === state().currentId)!;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
let responses: Array<unknown | ((body: any) => unknown)> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url, options) => {
    assert.equal(String(url), "https://chat.test/v1/chat/completions", "No paid generation or live server is used");
    const response = responses.shift(); assert.notEqual(response, undefined, "Unexpected mocked chat request");
    const action = typeof response === "function" ? response(JSON.parse(String(options?.body))) : response;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
const final = { tool: "final", args: { message: "完成" } };

async function main() {
    useConfigStore.setState({ config });
    const f = fixture("source-helpers", [textNode("source"), textNode("other")]);
    assert.deepEqual(assistantPromptSourceIds(f.context.getSnapshot(), ["source"], "生成图片"), ["source"]);
    assert.deepEqual(assistantPromptSourceIds(f.context.getSnapshot(), [], "生成图片，2k，2:3", ["source"]), ["source"]);
    assert.deepEqual(assistantPromptSourceIds(f.context.getSnapshot(), [], "根据刚才的提示词生成图片，2K", ["source"]), ["source"]);
    assert.deepEqual(assistantPromptSourceIds(f.context.getSnapshot(), [], "生成一张小狗图片", ["source"]), [], "A new subject must not silently inherit old cat text");
    assert.deepEqual(assistantPromptSourceIds(f.context.getSnapshot(), [], "生成图片", ["source", "other"]), [], "Ambiguous previous text is not guessed");
    assert.deepEqual(assistantPromptSourceIds(f.context.getSnapshot(), [], "生成图片", ["deleted"]), []);
    const action: AssistantAction = { tool: "apply_workflow", args: { nodes: [{ key: "out", type: "image", prompt: "2:3竖版" }], connections: [] } };
    const normalized = assistantWorkflowWithSources(action, f.context.getSnapshot(), ["source"]);
    assert.deepEqual(normalized.args.connections, [{ from: "source", to: "out" }]);
    assert.deepEqual(action.args.connections, [], "Do not mutate model response or source graph");
    const explicit: AssistantAction = { ...action, args: { ...action.args, connections: [{ from: "other", to: "out" }] } };
    assert.equal(assistantWorkflowWithSources(explicit, f.context.getSnapshot(), ["source"]), explicit, "Deliberate explicit text input remains authoritative");
    await executeAssistantTool(normalized, f.context, config, [image], signal);
    const output = f.context.getSnapshot().nodes.at(-1)!;
    assert(f.context.getSnapshot().connections.some((edge) => edge.fromNodeId === "source" && edge.toNodeId === output.id));
    assert(buildNodeGenerationContext(output.id, f.context.getSnapshot().nodes, f.context.getSnapshot().connections, "2:3竖版").prompt.includes("本次小猫提示词"));

    responses = [{ tool: "run_nodes", args: JSON.stringify({ nodeIds: [output.id] }) }];
    assert.deepEqual((await requestAssistantAction(config, chat, [], signal)).args, { nodeIds: [output.id] });
    responses = [{ tool: "read_canvas" }]; assert.deepEqual((await requestAssistantAction(config, chat, [], signal)).args, {});
    responses = [{ tool: "run_nodes", args: "[]" }]; await assert.rejects(requestAssistantAction(config, chat, [], signal), /args 必须是对象/);
    responses = [{ tool: "run_nodes", args: "not-json" }]; await assert.rejects(requestAssistantAction(config, chat, [], signal), /不是有效的 JSON 对象/);

    for (const mode of ["manual", "auto"] as const) {
        await state().clearHistory(); const g = fixture(`source-session-${mode}`, [textNode("unrelated", "不相干的历史产品")]);
        state().setContext(g.context); await tick(); state().setGenerationMode(mode);
        state().setDraft("写一个小猫提示词");
        responses = [{ tool: "apply_workflow", args: { nodes: [{ key: "cat", type: "text", prompt: "SESSION_CAT_PROMPT", title: "小猫提示词" }], connections: [] } }, final];
        await state().send(); const sourceId = current().recentPromptNodeIds?.[0]; assert(sourceId);
        g.context.applyOps([{ type: "select_nodes", ids: [] }]);
        state().setDraft("生成图片，2k，2:3");
        responses = [(body) => {
            assert(JSON.stringify(body.messages).includes(`本次提示词源节点ID：`));
            return { tool: "apply_workflow", args: { nodes: [{ key: "catImage", type: "image" }], connections: [] } };
        }, (body) => {
            const value = JSON.parse(body.messages.at(-1).content.split("返回：")[1]);
            const id = value.resolvedNodes[0].id;
            assert(g.context.getSnapshot().connections.some((edge) => edge.fromNodeId === sourceId && edge.toNodeId === id));
            assert(!g.context.getSnapshot().connections.some((edge) => edge.fromNodeId === "unrelated"));
            return { tool: "run_nodes", args: { nodeIds: [id] } };
        }];
        if (mode === "auto") responses.push(final);
        await state().send();
        if (mode === "manual") { assert(current().pending); assert.equal(g.prompts.length, 0); responses = [final]; await state().confirm(true); }
        assert.equal(g.prompts.length, 1); assert(g.prompts[0].includes("SESSION_CAT_PROMPT"));
        assert.equal(current().messages.at(-1)?.text, "完成");
        const newImage = g.context.getSnapshot().nodes.at(-1)!;
        assert.equal(newImage.metadata?.size, "1360x2048", "Explicit dimensions are applied before first generation");
    }
}
main().then(async () => { await state().clearHistory(); state().setContext(null); globalThis.fetch = originalFetch; console.log("PASS Agent text sources, dependency edges, actual input, strict args parsing and both approval modes"); process.exit(0); }).catch((error) => { console.error(error); globalThis.fetch = originalFetch; process.exit(1); });