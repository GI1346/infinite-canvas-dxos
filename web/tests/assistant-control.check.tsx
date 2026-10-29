import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ModelPicker } from "../src/components/model-picker";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-generation-helpers";
import { assistantImageParameters, explicitAssistantImageRequirements } from "../src/lib/canvas/assistant-image-parameters";
import { assistantGraphSummary, executeAssistantTool, assistantSystemPrompt, type AssistantAction } from "../src/services/api/canvas-assistant";
import { relayImageInput } from "../src/services/api/relay-tasks";
import { relayChatScript } from "../src/services/api/relay-chat";
import { useCanvasAssistantStore, type CanvasAssistantContext } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, encodeChannelModel, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { useThemeStore } from "../src/stores/use-theme-store";
import type { CanvasNodeData } from "../src/types/canvas";

globalThis.CustomEvent = window.CustomEvent;
registerBuiltinNodes();
const imageId = encodeChannelModel("draw", "gpt-image-2.5-sunburst"), otherId = encodeChannelModel("other", "gpt-image-2.5-sunburst"), chatId = encodeChannelModel("chat", "chat");
const longName = "a-very-long-image-model-name-".repeat(10);
const config: AiConfig = { ...defaultConfig, proxyEnabled: false, size: "2048x2048", imageResolution: "2k", models: [imageId, otherId, chatId], model: imageId, imageModel: imageId, textModel: chatId, channels: [
    { id: "draw", name: "65535", baseUrl: "https://image.test", apiKey: "stub-image-key", apiFormat: "openai", models: [{ name: "gpt-image-2.5-sunburst", capability: "image" }, { name: longName, capability: "image" }] },
    { id: "other", name: "comfly", baseUrl: "https://other.test", apiKey: "stub-other-key", apiFormat: "openai", models: [{ name: "gpt-image-2.5-sunburst", capability: "image" }] },
    { id: "chat", name: "独立对话", baseUrl: "https://chat.test", apiKey: "stub-chat-key", apiFormat: "openai", models: [{ name: "chat", capability: "text", script: relayChatScript }] },
] };
const state = () => useCanvasAssistantStore.getState(), current = () => state().sessions.find((session) => session.id === state().currentId)!;
const tick = () => new Promise((resolve) => setTimeout(resolve, 25));
const makeNode = (id: string, type = "image"): CanvasNodeData => ({ id, type, title: id, width: 200, height: 300, position: { x: 10, y: 20 }, metadata: { model: imageId, prompt: "测试", size: "2048x2048" } });
function fixture(projectId: string) {
    let snapshot: CanvasAgentSnapshot = { projectId, title: "检查", nodes: [makeNode("a"), makeNode("b")], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const history: CanvasAgentSnapshot[] = [], requests: AiConfig[] = [];
    const context: CanvasAssistantContext = { snapshot, getSnapshot: () => snapshot, applyOps: (ops) => { history.push(snapshot); snapshot = applyCanvasAgentOps(snapshot, ops); return snapshot; }, undoOps: () => { const old = history.pop(); if (old) snapshot = old; return old || null; }, runNode: async (id) => {
        const source = snapshot.nodes.find((node) => node.id === id)!, request = buildGenerationConfig(config, source, "image"); requests.push(request);
        const output = { ...source, id: "actual-output", metadata: { ...source.metadata, status: "success" as const, content: "blob:stub", naturalWidth: 1360, naturalHeight: 2048 } };
        snapshot = { ...snapshot, nodes: [...snapshot.nodes, output] }; return output;
    } };
    return { context, requests };
}
const signal = new AbortController().signal;
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
let responses: Array<AssistantAction | ((body: any) => AssistantAction)> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url, options) => {
    assert(String(url).startsWith("https://chat.test"), "No live network or drawing key used for chat");
    assert(String((options?.headers as any)?.Authorization).includes("stub-chat-key"));
    const body = JSON.parse(String(options?.body)), response = responses.shift(); assert(response, "Unexpected request");
    const action = typeof response === "function" ? response(body) : response;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(action) } }] }), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
async function main() {
    useConfigStore.setState({ config }); await state().clearHistory();
    const f = fixture("edits"), tool = (action: AssistantAction) => executeAssistantTool(action, f.context, config, [], signal);
    await tool({ tool: "apply_workflow", args: { nodes: [{ key: "first", type: "image", parameters: { imageAspectRatio: "9:16", imageResolution: "4K" } }], connections: [] } });
    const first = f.context.getSnapshot().nodes.at(-1)!;
    const payload = relayImageInput(buildGenerationConfig(config, first, "image"), "test", []);
    assert.equal(payload.input.size, "2160x3840"); assert.equal(payload.input.resolution, "4k");
    await tool({ tool: "update_nodes", args: { nodeIds: [first.id], parameters: { imageAspectRatio: "2:3", imageResolution: "2k" } } });
    assert.equal(f.context.getSnapshot().nodes.at(-1)?.metadata?.size, "1360x2048");
    assert.equal((assistantGraphSummary(f.context.getSnapshot()).nodes.at(-1) as any).parameters.size, "1360x2048");
    const beforeInvalid = JSON.stringify(f.context.getSnapshot());
    await assert.rejects(tool({ tool: "update_nodes", args: { nodeIds: [first.id], parameters: { imageAspectRatio: "9:16", size: "2048x2048" } } }), /冲突/);
    assert.equal(JSON.stringify(f.context.getSnapshot()), beforeInvalid);
    assert.equal(assistantImageParameters({ imageResolution: "4k" }, { size: "1360x2048" }, config).size, "2336x3520");
    assert.equal(assistantImageParameters({ imageResolution: "4k" }, { size: "2048x2048", imageAspectRatio: "2:3" }, config).size, "2880x2880", "Manual UI size changes take precedence over old ratio metadata");
    assert.deepEqual(explicitAssistantImageRequirements("一只小狗，无文字，比例2:3，2K。"), { imageAspectRatio: "2:3", imageResolution: "2k" });
    assert.deepEqual(explicitAssistantImageRequirements("5张1:1主图，9张9:16详情"), {});
    assert.deepEqual(explicitAssistantImageRequirements("不要1:1，不用2k，使用9:16、4k"), { imageAspectRatio: "9:16", imageResolution: "4k" });
    console.log("PASS first tool ratio/resolution -> actual async request size; conflicts atomic; mixed layouts not overridden.");

    const edit = (args: Record<string, unknown>) => tool({ tool: "edit_canvas", args });
    await edit({ action: "update", nodes: [{ id: "a", title: "重命名", x: 60, width: 240, model: otherId, prompt: "改过的提示词" }] });
    let a = f.context.getSnapshot().nodes.find((node) => node.id === "a")!;
    assert.equal(a.title, "重命名"); assert.equal(a.position.x, 60); assert.equal(a.width / a.height, 200 / 300); assert.equal(a.metadata?.model, otherId);
    await tool({ tool: "apply_workflow", args: { nodes: [], connections: [{ from: "a", to: "b" }] } });
    await edit({ action: "copy", nodeIds: ["a", "b"], dx: 100, dy: 200 });
    const selected = f.context.getSnapshot().selectedNodeIds; assert.equal(selected.length, 2);
    assert(f.context.getSnapshot().connections.some((edge) => selected.includes(edge.fromNodeId) && selected.includes(edge.toNodeId)));
    await edit({ action: "group", nodeIds: selected });
    const groupId = f.context.getSnapshot().selectedNodeIds[0], oldX = f.context.getSnapshot().nodes.find((node) => node.id === selected[0])!.position.x;
    const groupX = f.context.getSnapshot().nodes.find((node) => node.id === groupId)!.position.x;
    await edit({ action: "update", nodes: [{ id: groupId, x: groupX + 300 }] });
    assert.equal(f.context.getSnapshot().nodes.find((node) => node.id === selected[0])!.position.x, oldX + 300);
    await edit({ action: "ungroup", nodeIds: [groupId] });
    assert(!f.context.getSnapshot().nodes.some((node) => node.id === groupId));
    await edit({ action: "grid", nodeIds: selected, columns: 2, gap: 32 });
    const copies = f.context.getSnapshot().nodes.filter((node) => selected.includes(node.id)); assert.equal(copies[0].position.y, copies[1].position.y);
    await edit({ action: "viewport", x: 140, y: 260, zoom: 1.5 });
    assert.equal(f.context.getSnapshot().viewport.k, 1.5);
    await edit({ action: "undo" }); assert.equal(f.context.getSnapshot().viewport.k, 1);
    const edgeId = f.context.getSnapshot().connections[0].id;
    await edit({ action: "disconnect", connectionIds: [edgeId] }); assert(!f.context.getSnapshot().connections.some((edge) => edge.id === edgeId));
    const graphBefore = JSON.stringify(f.context.getSnapshot());
    await assert.rejects(edit({ action: "update", nodes: [{ id: "a", title: "不应落地" }, { id: "missing", title: "错误" }] }));
    assert.equal(JSON.stringify(f.context.getSnapshot()), graphBefore);
    await assert.rejects(edit({ action: "update", nodes: [{ id: "a", model: chatId }] }), /模型/);
    await edit({ action: "group", nodeIds: selected }); const deleteGroup = f.context.getSnapshot().selectedNodeIds[0];
    await edit({ action: "delete", nodeIds: [deleteGroup] });
    assert(!f.context.getSnapshot().nodes.some((node) => selected.includes(node.id) || node.id === deleteGroup));
    await edit({ action: "undo" }); assert(f.context.getSnapshot().nodes.some((node) => node.id === deleteGroup));
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(executeAssistantTool({ tool: "edit_canvas", args: { action: "delete", nodeIds: ["a"] } }, f.context, config, [], aborted.signal), { name: "AbortError" });
    console.log("PASS Agent edits, model isolation, copy with edges, group move/ungroup, grid, select/delete/disconnect/viewport/undo; bad batch writes nothing.");

    for (const mode of ["auto", "manual"] as const) {
        const g = fixture(`first-run-${mode}`); state().setContext(g.context); await tick(); state().setGenerationMode(mode); state().setDraft("一只小狗，无文字，2:3，2k。");
        responses = [{ tool: "run_nodes", args: { nodeIds: ["a"] } }];
        const final = (body: any): AssistantAction => {
            const feedback = body.messages.at(-1).content;
            assert(feedback.includes('"id":"actual-output"')); assert(feedback.includes('"width":1360')); assert(feedback.includes('"height":2048'));
            return { tool: "final", args: { message: "收到真实结果" } };
        };
        if (mode === "auto") responses.push(final);
        await state().send();
        if (mode === "manual") { assert(current().pending); assert.equal(g.requests.length, 0); responses = [final]; await state().confirm(true); }
        assert.equal(g.requests.length, 1); assert.equal(g.requests[0].size, "1360x2048"); assert.equal(g.requests[0].imageResolution, "2k");
        assert.equal(current().messages.at(-1)?.text, "收到真实结果");
    }
    assert(assistantSystemPrompt(config, [], "manual").includes("edit_canvas"));
    console.log("PASS both approval modes; explicit user requirements applied before the FIRST and only request; feedback reads real output ID/pixels, not old input.");

    let chosen = "";
    const pointer = async (element: Element) => act(async () => { for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) element.dispatchEvent(type.startsWith("pointer") ? new PointerEvent(type, { bubbles: true, button: 0, pointerType: "mouse" }) : new MouseEvent(type, { bubbles: true, button: 0 })); await tick(); });
    for (const theme of ["light", "dark"] as const) {
        await act(async () => { useThemeStore.setState({ theme }); });
        await act(async () => root.render(<ModelPicker groupByChannel config={config} capability="image" value={imageId} onChange={(value) => { chosen = value; }} />));
        await pointer(host.querySelector("button")!);
        assert.deepEqual([...document.querySelectorAll("[data-model-channel]")].map((item) => item.textContent), ["65535", "comfly"]);
        assert.equal(document.querySelectorAll("[data-model-id]").length, 0, "First level must contain only channels");
        const channel = document.querySelector<HTMLElement>('[data-model-channel="draw"]')!;
        assert(channel.style.background); await pointer(channel);
        const popup = document.querySelector('[data-channel-model-options="draw"]')!; assert(popup); assert(popup.hasAttribute("data-canvas-overlay")); assert(popup.hasAttribute("data-canvas-no-zoom"));
        const selectedModel = popup.querySelector<HTMLElement>('[data-selected="true"]')!; assert(selectedModel.style.background); assert(selectedModel.querySelector("svg"));
        const long = popup.querySelector<HTMLElement>(`[data-model-id="${encodeChannelModel("draw", longName)}"]`)!;
        assert.equal(long.textContent, longName); assert(long.title.includes(longName)); assert(long.querySelector("span")?.className.includes("break-all"));
        await pointer(long); assert.equal(chosen, encodeChannelModel("draw", longName));
    }
    await act(async () => root.unmount()); console.log("PASS two-level model picker: live channels, selected highlighting, full long names, dark/light, mouse click and overlay markers.");
    await state().clearHistory();
}
main().then(() => { globalThis.fetch = originalFetch; console.log("ALL ASSISTANT CONTROL CHECKS PASSED"); process.exit(0); }).catch((error) => { console.error(error); globalThis.fetch = originalFetch; process.exit(1); });
