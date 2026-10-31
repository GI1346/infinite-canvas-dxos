import assert from "node:assert/strict";
import { assistantContextMessages, normalizeAssistantContextWindow } from "../src/lib/canvas/assistant-context-window";
import { assistantGraphIndex, executeAssistantTool } from "../src/services/api/canvas-assistant";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { useCanvasAssistantStore, type CanvasAssistantContext } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, encodeChannelModel, useConfigStore } from "../src/stores/use-config-store";
import { relayChatScript } from "../src/services/api/relay-chat";
import type { AiTextMessage } from "../src/services/api/image";

const meta = "\n本次引用节点ID：[]\n本次指定生成模型ID：[]\n本次提示词源节点ID：[]";
const graph = { projectId: "readback-0227", selectedNodeIds: [], nodes: [{ id: "old", prompt: "OLD_FULL_PROMPT" }], connections: [] };
const oldUser = { role: "user" as const, content: "用户原文\n第二行" + meta + "\n当前画布：" + JSON.stringify(graph) };
const action = (tool: string): AiTextMessage => ({ role: "assistant", content: JSON.stringify({ tool, args: {} }) });
const tool = (name: string, value: unknown): AiTextMessage => ({ role: "user", content: "工具 " + name + " 返回：" + JSON.stringify(value) });
const history: AiTextMessage[] = [oldUser, action("read_canvas"), tool("read_canvas", graph), action("apply_workflow"), tool("apply_workflow", { resolvedNodes: [{ id: "created", key: "a" }], canvas: graph }), action("read_assets"), tool("read_assets", { nodes: [{ id: "old", text: "OLD_INSPECTED_BODY" }] })];
const now: AiTextMessage = { role: "user", content: "本次正文\n不要删掉换行" + meta };
const before = JSON.stringify(history);
const request = assistantContextMessages([...history, now], history.length, 200);
assert.equal(JSON.stringify(history), before, "normalization never mutates stored transcript");
assert(!JSON.stringify(request).includes("OLD_FULL_PROMPT"));
assert(!JSON.stringify(request).includes("OLD_INSPECTED_BODY"));
assert.equal(request[0].content, "用户原文\n第二行" + meta);
assert(JSON.stringify(request).includes("created"), "real created node IDs survive");
assert.equal(request.at(-1)?.content, now.content, "current user is verbatim");
const literal = tool("read_assets", { nodes: [{ text: "literal user JSON is not generated tool context" }] });
assert.deepEqual(assistantContextMessages([literal], 1, 3), [literal]);
const customLiteral = { role: "user" as const, content: "我的内容\n当前画布：" + JSON.stringify(graph) };
assert.deepEqual(assistantContextMessages([customLiteral], 1, 3), [customLiteral], "do not strip a user's own graph example");
const currentTool = tool("read_assets", { nodes: [{ id: "current", text: "CURRENT_EXACT_BODY" }] });
assert(JSON.stringify(assistantContextMessages([now, action("read_assets"), currentTool], 0, 3)).includes("CURRENT_EXACT_BODY"), "do not strip current tool text");
const multimodal: AiTextMessage = { role: "user", content: [{ type: "text", text: "当前图" }, { type: "image_url", image_url: { url: "data:image/png;base64,stub-current" } }] };
assert.deepEqual(assistantContextMessages([multimodal], 0, 3), [multimodal]);
const longHistory: AiTextMessage[] = Array.from({ length: 240 }, (_, i) => ({ role: "user", content: String(i) }));
assert.equal(assistantContextMessages([...longHistory, now], 240, 200).length, 201);
assert.equal(assistantContextMessages([...longHistory, now], 240, 3).length, 4);
assert.equal(assistantContextMessages([...longHistory, now], 240, 3)[0].content, "237");
assert.equal(normalizeAssistantContextWindow(999), 20);
const pastPlan: AiTextMessage = { role: "assistant", content: JSON.stringify({ tool: "apply_workflow", args: { nodes: [{ key: "plan", type: "text", prompt: "PAST_PLAN_BODY" }], connections: [] } }) };
assert(!JSON.stringify(assistantContextMessages([pastPlan, now], 1, 3)).includes("PAST_PLAN_BODY"));
assert(JSON.stringify(assistantContextMessages([pastPlan, now], 0, 3)).includes("PAST_PLAN_BODY"), "current plan must remain executable");
const pastFinal: AiTextMessage = { role: "assistant", content: JSON.stringify({ tool: "final", args: { message: "真实对话回复完整保留" } }) };
assert.deepEqual(assistantContextMessages([pastFinal, now], 1, 3), [pastFinal, now]);
const savedVisual = tool("read_assets", { nodes: [{ id: "visual", text: "OLD_VISUAL_TEXT" }] });
savedVisual.content = String(savedVisual.content) + "\n节点图片 visual";
assert(!JSON.stringify(assistantContextMessages([action("read_assets"), savedVisual, now], 2, 3)).includes("OLD_VISUAL_TEXT"));
assert(JSON.stringify(assistantContextMessages([action("read_assets"), savedVisual, now], 2, 3)).includes("节点图片 visual"));

async function main() {
    registerBuiltinNodes();
    let snapshot: CanvasAgentSnapshot = { projectId: "readback-0227", title: "test", nodes: [
        { id: "target", type: "text", title: "目标", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "TARGET_EXACT_BODY", prompt: "TARGET_EXACT_BODY" } },
        { id: "unrelated", type: "text", title: "其他节点", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "UNRELATED_FULL_BODY", prompt: "UNRELATED_FULL_BODY" } },
    ], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const context: CanvasAssistantContext = { snapshot, getSnapshot: () => snapshot, applyOps: (ops) => snapshot = applyCanvasAgentOps(snapshot, ops), runNode: async () => { throw Error("no paid generation in this test"); } };
    const config = { ...defaultConfig }, signal = new AbortController().signal;
    assert(!JSON.stringify(assistantGraphIndex(snapshot)).includes("EXACT_BODY"));
    const index = await executeAssistantTool({ tool: "read_canvas", args: {} }, context, config, [], signal);
    assert(!JSON.stringify(index.value).includes("UNRELATED_FULL_BODY"));
    const detail = await executeAssistantTool({ tool: "read_canvas", args: { nodeIds: ["target"] } }, context, config, [], signal);
    assert(JSON.stringify(detail.value).includes("TARGET_EXACT_BODY")); assert(!JSON.stringify(detail.value).includes("UNRELATED_FULL_BODY"));
    const created = await executeAssistantTool({ tool: "apply_workflow", args: { nodes: [{ key: "new", type: "text", prompt: "NEW_BODY" }], connections: [] } }, context, config, [], signal);
    assert.equal((created.value as any).nodes.length, 1); assert.equal((created.value as any).canvas, undefined);
    assert(!JSON.stringify(created.value).includes("UNRELATED_FULL_BODY"));
    assert.equal((created.value as any).nodes[0].parameters !== undefined, true);
    const updated = await executeAssistantTool({ tool: "update_nodes", args: { nodeIds: ["target"], parameters: { quality: "high" } } }, context, config, [], signal);
    assert.equal((updated.value as any).nodes.length, 1); assert.equal((updated.value as any).nodes[0].parameters.quality, "high");
    assert(!JSON.stringify(updated.value).includes("EXACT_BODY"));

    const state = () => useCanvasAssistantStore.getState(), current = () => state().sessions.find((session) => session.id === state().currentId)!;
    const model = encodeChannelModel("stub", "chat");
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: false, textModel: model, models: [model], channels: [{ id: "stub", name: "stub-only", baseUrl: "https://stub-only.test", apiKey: "stub-not-a-real-key", apiFormat: "openai", models: [{ name: "chat", capability: "text", script: relayChatScript }] }] } });
    const originalFetch = globalThis.fetch, calls: any[] = [];
    globalThis.fetch = (async (_url, options) => {
        const body = JSON.parse(String(options?.body)); calls.push(body);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool: "final", args: { message: "done" } }) } }] }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
        await state().clearHistory(); state().setContext(context); await new Promise((resolve) => setTimeout(resolve, 25));
        state().setContextWindow(200); state().setDraft("原样正文\n第二行"); await state().send();
        assert.equal(calls.length, 1); assert(calls[0].messages[0].content.includes("当前画布结构索引"));
        assert(!JSON.stringify(calls[0].messages).includes("UNRELATED_FULL_BODY"));
        assert(!current().transcript.some((message) => JSON.stringify(message).includes("当前画布：")));
        const messagesBefore = current().messages.length;
        state().setDraft("下一轮"); await state().send();
        assert.equal(current().messages.length, messagesBefore + 2, "complete local conversation retained");
        assert.equal((JSON.stringify(calls[1].messages).match(/当前画布结构索引/g) || []).length, 1);
        assert.equal(current().contextWindow, 200);
    } finally { globalThis.fetch = originalFetch; }
    console.log("PASS request-only history cleanup, 3/200 windows, exact current text/images, targeted node reads, delta tools, single live index and full stored history");
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
