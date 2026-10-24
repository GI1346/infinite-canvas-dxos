import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CanvasAssistantGenerationMode } from "../src/components/agent/canvas-assistant-generation-mode";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { assistantSystemPrompt } from "../src/services/api/canvas-assistant";
import { relayChatScript } from "../src/services/api/relay-chat";
import { readCanvasAssistantGenerationMode, useCanvasAssistantStore, type CanvasAssistantContext } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, encodeChannelModel, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import type { CanvasNodeData } from "../src/types/canvas";

const state = () => useCanvasAssistantStore.getState();
const current = () => state().sessions.find((item) => item.id === state().currentId)!;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const textId = encodeChannelModel("text", "chat");
const imageId = encodeChannelModel("image", "draw");
const config: AiConfig = { ...defaultConfig, proxyEnabled: false, channels: [
    { id: "text", name: "对话", baseUrl: "https://text.test", apiKey: "stub-text-key", apiFormat: "openai", models: [{ name: "chat", capability: "text", script: relayChatScript }] },
    { id: "image", name: "绘画", baseUrl: "https://image.test", apiKey: "stub-image-key", apiFormat: "openai", models: [{ name: "draw", capability: "image" }] },
], models: [textId, imageId], textModel: textId, imageModel: imageId, videoModel: "" };
let responses: string[] = [], calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_url, options) => {
    calls += 1;
    const body = JSON.parse(String(options?.body || "{}"));
    assert.equal(body.model, "chat");
    const content = responses.shift();
    assert.notEqual(content, undefined, "Unexpected request; never uses real credentials/network");
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
const run = (ids: string[]) => JSON.stringify({ tool: "run_nodes", args: { nodeIds: ids } });
const final = (message: string) => JSON.stringify({ tool: "final", args: { message } });
function node(id: string, type = "image"): CanvasNodeData { return { id, type, title: id, position: { x: 0, y: 0 }, width: 150, height: 150, metadata: { model: imageId, prompt: "测试" } }; }
function context(projectId: string, nodes: CanvasNodeData[], onRun?: (id: string, signal?: AbortSignal) => Promise<void>) {
    const snapshot = { projectId, title: projectId, nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const runs: string[] = [];
    const value: CanvasAssistantContext = { snapshot, getSnapshot: () => snapshot, applyOps: () => snapshot, runNode: async (id, _mode, _prompt, signal) => {
        runs.push(id); await onRun?.(id, signal);
        const output = nodes.find((item) => item.id === id);
        if (output) output.metadata = { ...output.metadata, status: "success", content: "blob:stub" };
        return output;
    } };
    return { value, runs };
}
async function activate(value: CanvasAssistantContext) { state().setContext(value); await tick(); assert.equal(state().loading, false); }
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);

async function main() {
    registerBuiltinNodes(); useConfigStore.setState({ config }); await state().clearHistory();
    state().setGenerationMode("manual"); assert.equal(readCanvasAssistantGenerationMode(), "manual");
    assert(assistantSystemPrompt(config, []).includes("界面会先让用户确认"));
    assert(assistantSystemPrompt(config, [], "auto").includes("直接执行并等候真实结果，不必再次询问审批"));
    const manual = context("mode-manual", [node("manual")]); await activate(manual.value);
    state().setDraft("先询问"); responses = [run(["manual"])]; await state().send();
    assert(current().pending); assert.equal(manual.runs.length, 0);
    responses = [final("手动取消")]; await state().confirm(false); assert.equal(manual.runs.length, 0);
    assert.equal(current().messages.at(-1)?.text, "手动取消");
    console.log("PASS manual mode remains explicit and cancellation does not generate.");

    await act(async () => root.render(<CanvasAssistantGenerationMode />));
    const select = host.querySelector<HTMLSelectElement>("[data-assistant-generation-mode]")!;
    assert(select); assert.deepEqual([...select.options].map((item) => item.value), ["manual", "auto"]);
    await act(async () => { select.value = "auto"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(state().generationMode, "auto"); assert.equal(readCanvasAssistantGenerationMode(), "auto");
    await act(async () => root.render(null));
    let release: () => void = () => {};
    const outputReady = new Promise<void>((resolve) => { release = resolve; });
    const auto = context("mode-auto", [node("auto-1"), node("auto-2")], async (id) => { if (id === "auto-1") await outputReady; });
    await activate(auto.value); state().setDraft("直接生成两个节点"); responses = [run(["auto-1", "auto-2"]), final("自动完成")];
    const startCalls = calls, sending = state().send(); await tick();
    assert.equal(current().pending, undefined); assert(current().running); assert.deepEqual(auto.runs, ["auto-1"]);
    assert.equal(calls, startCalls + 1, "Must await real generation before asking LLM to summarize");
    release(); await sending; assert.deepEqual(auto.runs, ["auto-1", "auto-2"]);
    assert.equal(current().messages.at(-1)?.text, "自动完成");
    assert(current().messages.some((item) => item.role === "tool" && item.text.startsWith("生成结果")));
    console.log("PASS auto mode is selectable, saved, bypasses confirmation and awaits actual outputs.");

    const invalid = context("mode-invalid", [node("valid"), node("unsupported", "dxos:table")]); await activate(invalid.value);
    state().setDraft("校验全部目标"); responses = [run(["valid", "unsupported"]), final("验证失败已返回")]; await state().send();
    assert.deepEqual(invalid.runs, []); assert(current().messages.some((item) => item.text.includes("尚不支持直接运行节点类型")));
    console.log("PASS auto mode validates the whole target batch before starting any generation.");

    state().setGenerationMode("manual"); const pending = context("mode-pending", [node("pending")]); await activate(pending.value);
    state().setDraft("等待确认后切换模式"); responses = [run(["pending"])]; await state().send(); assert(current().pending);
    state().setGenerationMode("auto"); state().setGenerationMode("auto"); await tick(); await tick();
    assert.deepEqual(pending.runs, []); assert(current().pending);
    responses = [final("手动确认当前任务后已完成")]; await state().confirm(true);
    assert.deepEqual(pending.runs, ["pending"]); assert(!current().pending); assert.equal(current().messages.at(-1)?.text, "手动确认当前任务后已完成");
    console.log("PASS changing mode keeps the current pending batch unapproved; explicit confirm runs it exactly once.");

    let releaseStop: () => void = () => {}; const stopReady = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stopping = context("mode-stop", [node("stop-1"), node("stop-2")], async () => stopReady); await activate(stopping.value);
    state().setDraft("可停止"); responses = [run(["stop-1", "stop-2"])]; const stopSending = state().send(); await tick(); assert(current().running);
    state().stop(); releaseStop(); await stopSending; assert.deepEqual(stopping.runs, ["stop-1"]); assert(!current().running); assert(!current().messages.some((item) => item.role === "tool"));
    console.log("PASS stop prevents the rest of an automatically approved batch and ignores late result messages.");

    let releaseSwitch: () => void = () => {}; const switchReady = new Promise<void>((resolve) => { releaseSwitch = resolve; });
    const switching = context("mode-switch", [node("switch-1"), node("switch-2")], async () => switchReady); await activate(switching.value);
    state().setDraft("切换画布"); responses = [run(["switch-1", "switch-2"])]; const switchSending = state().send(); await tick();
    const next = context("mode-next", [node("next")]); await activate(next.value); releaseSwitch(); await switchSending;
    assert.deepEqual(switching.runs, ["switch-1"]); assert.equal(current().messages.length, 0); assert.equal(state().generationMode, "auto");
    await state().clearHistory(); assert.equal(state().generationMode, "auto"); assert.equal(readCanvasAssistantGenerationMode(), "auto");
    state().setGenerationMode("manual");
    console.log("PASS project switch stops old batch, keeps the new canvas untouched, and remembers mode across sessions/history clear.");
}
main().then(async () => { await act(async () => root.unmount()); globalThis.fetch = originalFetch; console.log("ALL ASSISTANT AUTO MODE CHECKS PASSED"); process.exit(0); }).catch(async (error) => { console.error(error); await act(async () => root.unmount()); globalThis.fetch = originalFetch; process.exit(1); });