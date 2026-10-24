import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import localforage from "localforage";
import { CanvasAssistantDock } from "../src/components/agent/canvas-assistant-dock";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { assistantRunMode, executeAssistantTool, requestAssistantAction } from "../src/services/api/canvas-assistant";
import { relayChatScript } from "../src/services/api/relay-chat";
import { useCanvasAssistantStore, type CanvasAssistantContext, type CanvasAssistantSession } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, encodeChannelModel, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { useThemeStore } from "../src/stores/use-theme-store";
import { canvasThemes } from "../src/lib/canvas-theme";
import { loadAssistantSkills, useCanvasAssistantSkillStore } from "../src/stores/use-canvas-assistant-skill-store";
import type { CanvasNodeData } from "../src/types/canvas";

HTMLElement.prototype.scrollIntoView = function () {};
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
const state = () => useCanvasAssistantStore.getState();
const current = () => state().sessions.find((session) => session.id === state().currentId)!;
const textId = encodeChannelModel("text", "same-model"), imageId = encodeChannelModel("image", "same-model"), otherImageId = encodeChannelModel("other", "same-model");
const config: AiConfig = { ...defaultConfig, proxyEnabled: false, channels: [
    { id: "text", name: "对话", baseUrl: "https://text.test", apiKey: "stub-text-key", apiFormat: "openai", models: [{ name: "same-model", capability: "text", script: relayChatScript }] },
    { id: "image", name: "绘画", baseUrl: "https://image.test", apiKey: "stub-image-key", apiFormat: "openai", models: [{ name: "same-model", capability: "image" }] },
    { id: "other", name: "另一绘画", baseUrl: "https://other.test", apiKey: "stub-other-key", apiFormat: "openai", models: [{ name: "same-model", capability: "image" }] },
], models: [textId, imageId, otherImageId], textModel: textId, imageModel: imageId, videoModel: "" };
const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
const originalFetch = globalThis.fetch;
let responses: Array<string | ((body: any) => string)> = [];
let deferred: ((value: Response) => void) | null = null;
let deferNext = false;
globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body || "{}"));
    calls.push({ url: String(url), headers: options?.headers as Record<string, string>, body });
    if (deferNext) { deferNext = false; return new Promise<Response>((resolve) => { deferred = resolve; }); }
    const response = responses.shift();
    assert.notEqual(response, undefined, "Unexpected network request (all requests are stubbed)");
    const content = typeof response === "function" ? response(body) : response;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
function final(message = "完成") { return JSON.stringify({ tool: "final", args: { message } }); }
function node(id: string, type = "text", groupId?: string): CanvasNodeData { return { id, type, title: id, position: { x: 10, y: 20 }, width: 200, height: 150, metadata: { ...(type === "text" ? { content: id } : {}), ...(groupId ? { groupId } : {}) } }; }
function context(projectId: string, nodes: CanvasNodeData[] = []) {
    let snapshot: CanvasAgentSnapshot = { projectId, title: projectId, nodes, connections: [], selectedNodeIds: nodes.map((item) => item.id), viewport: { x: 0, y: 0, k: 1 } };
    const record = { applied: 0, runs: [] as string[] };
    const value: CanvasAssistantContext = { snapshot, getSnapshot: () => snapshot, applyOps: (ops) => { record.applied += 1; snapshot = applyCanvasAgentOps(snapshot, ops); value.snapshot = snapshot; return snapshot; }, runNode: async (id) => { record.runs.push(id); const item = snapshot.nodes.find((entry) => entry.id === id); if (item) item.metadata = { ...item.metadata, status: "success", content: "blob:stub" }; return item; } };
    return { value, record };
}
async function activate(value: CanvasAssistantContext) { await act(async () => { state().setContext(value); await tick(); }); assert.equal(state().loading, false); }
const fire = async (target: EventTarget, event: Event) => act(async () => { target.dispatchEvent(event); await tick(); });
const click = async (target: EventTarget) => { await fire(target, new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })); await fire(target, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); await fire(target, new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 })); await fire(target, new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 })); await fire(target, new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })); };
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);

async function main() {
    registerBuiltinNodes(); useConfigStore.setState({ config });
    await state().clearHistory();
    const action = await requestAssistantAction(config, textId, [{ role: "user", content: "test" }], new AbortController().signal).catch((error) => error);
    assert(action instanceof Error, "No stub response must not access real network");
    calls.length = 0;
    responses = [final("路由正确")];
    assert.equal((await requestAssistantAction(config, textId, [{ role: "user", content: "test" }], new AbortController().signal)).tool, "final");
    assert.equal(calls[0].url, "https://text.test/v1/chat/completions"); assert.equal(calls[0].headers.Authorization, "Bearer stub-text-key");
    assert.equal(calls[0].body.model, "same-model");
    await assert.rejects(() => requestAssistantAction(config, imageId, [], new AbortController().signal), /对话模型/);
    const noKey = { ...config, channels: config.channels.map((channel) => channel.id === "text" ? { ...channel, apiKey: "" } : channel) }; await assert.rejects(() => requestAssistantAction(noKey, textId, [], new AbortController().signal), /API Key/);
    assert.equal(calls.length, 1);
    console.log("PASS text routing uses independent text channel/key; identical image model name never leaks image key.");

    const a = context("assistant-a", [node("input"), node("table", "dxos:table")]), signal = new AbortController().signal;
    await assert.rejects(() => executeAssistantTool({ tool: "apply_workflow", args: { nodes: [{ key: "new", type: "image", model: imageId, prompt: "生成" }], connections: [{ from: "missing", to: "new" }] } }, a.value, config, [imageId], signal), /连线/);
    assert.equal(a.record.applied, 0); assert.equal(a.value.getSnapshot().nodes.length, 2);
    await assert.rejects(() => executeAssistantTool({ tool: "apply_workflow", args: { nodes: [{ key: "fusion", type: "blinkflow:fusion", mode: "image" }], connections: [] } }, a.value, config, [], signal), /不是 API 生成节点/);
    await assert.rejects(() => executeAssistantTool({ tool: "apply_workflow", args: { nodes: [{ key: "fusion", type: "blinkflow:fusion" }], connections: [{ from: "input", to: "fusion", toPort: "bad" }] } }, a.value, config, [], signal), /补丁端口必须是 patch/);
    assert.throws(() => assistantRunMode(node("table", "dxos:table")), /尚不支持直接运行/); assert.equal(assistantRunMode(node("fusion", "blinkflow:fusion")), "image");
    await assert.rejects(() => executeAssistantTool({ tool: "apply_workflow", args: { nodes: [{ key: "new", type: "not:registered" }], connections: [] } }, a.value, config, [], signal), /未注册/);
    await assert.rejects(() => executeAssistantTool({ tool: "apply_workflow", args: { nodes: [], connections: [{ from: "input", to: "table", toPort: "input-999" }] } }, a.value, config, [], signal), /端口不存在/);
    const created = await executeAssistantTool({ tool: "apply_workflow", args: { nodes: [{ key: "new", type: "image", model: otherImageId, prompt: "创建提示词", parameters: { generateAudio: true, watermark: false, imageResolution: "2k" } }], connections: [{ from: "input", to: "new" }] } }, a.value, config, [otherImageId], signal);
    assert.equal(a.record.applied, 1);
    const resolved = (created.value as any).resolvedNodes[0].id, generated = a.value.getSnapshot().nodes.find((item) => item.id === resolved)!;
    assert.equal(generated.metadata?.model, otherImageId); assert.equal(generated.metadata?.generateAudio, "true"); assert.equal(generated.metadata?.watermark, "false"); assert.equal(generated.metadata?.prompt, "创建提示词");
    assert(a.value.getSnapshot().connections.some((edge) => edge.fromNodeId === "input" && edge.toNodeId === resolved));
    console.log("PASS workflow validates before one atomic apply; channel encoding, prompt, boolean normalization, real ID and connections survive readback.");

    const groups = context("nested-groups", [node("g1", "group"), node("g2", "group", "g1"), node("nested", "text", "g2")]);
    const nestedRead = await executeAssistantTool({ tool: "read_assets", args: { nodeIds: ["g1"] } }, groups.value, config, [], signal); assert.deepEqual((nestedRead.value as any).nodes.map((item: any) => item.id), ["g1", "g2", "nested"]);
    await activate(a.value);
    state().addReferences(["input", "input"]); assert.deepEqual(current().references, ["input"]);
    state().toggleModel(otherImageId); state().setDraft("用选中的模型生成");
    responses = [(body) => { const text = JSON.stringify(body.messages); assert(text.includes(otherImageId)); assert(text.includes("input")); return JSON.stringify({ tool: "run_nodes", args: { nodeIds: [resolved] } }); }];
    await state().send(); assert(current().pending); assert.equal(a.record.runs.length, 0);
    responses = [final("已取消")]; await state().confirm(false); assert.equal(a.record.runs.length, 0); assert(a.value.getSnapshot().nodes.some((item) => item.id === resolved)); assert.equal(current().messages.at(-1)?.text, "已取消");
    state().setDraft("运行新节点"); responses = [JSON.stringify({ tool: "run_nodes", args: { nodeIds: [resolved] } })]; await state().send();
    assert(current().pending); await tick(); await tick();
    const db = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_assistant" });
    const saved = await db.getItem<{ sessions: CanvasAssistantSession[] }>("assistant-a"); assert(saved?.sessions.some((session) => session.pending?.tool === "run_nodes" && !session.running));
    assert(!JSON.stringify(saved).includes("stub-text-key")); assert(!JSON.stringify(saved).includes("stub-image-key"));
    responses = [final("生成已完成")]; await state().confirm(true); assert.deepEqual(a.record.runs, [resolved]); assert.equal(current().messages.at(-1)?.text, "生成已完成");
    const imageInput = node("visual", "image"); imageInput.metadata = { content: "data:image/png;base64,STUB_IMAGE_BYTES", status: "success" }; const visual = context("assistant-visual", [imageInput]); await activate(visual.value); state().addReferences(["visual"]); state().setDraft("看图"); responses = [(body) => { assert(JSON.stringify(body.messages).includes("STUB_IMAGE_BYTES")); return final("图片已读"); }]; await state().send(); await tick(); await tick(); const visualSaved = await db.getItem("assistant-visual"); assert(!JSON.stringify(visualSaved).includes("STUB_IMAGE_BYTES"));
    const pendingRestore: CanvasAssistantSession = { id: "refresh-session", projectId: "assistant-refresh", title: "待确认恢复", model: textId, messages: [{ id: "msg", role: "user", text: "恢复" }], transcript: [{ role: "user", content: "恢复" }], references: [], models: [imageId], draft: "", running: true, status: "等待确认生成", pending: { tool: "run_nodes", args: { nodeIds: ["restored-node"] } }, updatedAt: Date.now() };
    await db.setItem("assistant-refresh", { sessions: [pendingRestore], currentId: pendingRestore.id }); const restored = context("assistant-refresh", [node("restored-node", "image")]); await activate(restored.value); assert.equal(current().running, false); assert.equal(current().pending?.tool, "run_nodes"); responses = [final("恢复后取消")]; await state().confirm(false); assert.equal(restored.record.runs.length, 0); await activate(a.value);
    console.log("PASS references/models reach requests; image bytes stay out of storage; approval/cancel and database rehydration retain pending without auto-run; confirmed run awaits result.");

    state().setDraft("迟到回复"); deferNext = true; const sending = state().send(); await tick(); assert(current().running); const count = current().messages.length; state().stop();
    const resolveStopped = deferred as unknown as (value: Response) => void; resolveStopped(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool: "apply_workflow", args: { nodes: [{ key: "late", type: "text", prompt: "不应落地" }], connections: [] } }) } }] }), { headers: { "content-type": "application/json" } }));
    await sending; assert.equal(a.value.getSnapshot().nodes.some((item) => item.metadata?.content === "不应落地"), false); assert.equal(current().messages.length, count);
    state().setDraft("切项目迟到回复"); deferNext = true; const switching = state().send(); await tick(); const b = context("assistant-b", [node("b")]); await activate(b.value);
    const resolveSwitched = deferred as unknown as (value: Response) => void; resolveSwitched(new Response(JSON.stringify({ choices: [{ message: { content: final("迟到结果") } }] }), { headers: { "content-type": "application/json" } })); await switching;
    assert.equal(current().messages.length, 0); await activate(a.value); assert.equal(current().running, false); assert(!current().messages.some((message) => message.text === "迟到结果"));
    console.log("PASS stop and project switch reject stale responses without writes or late messages.");

    const runsBeforeUnsupported = a.record.runs.length; state().setDraft("不支持节点校验"); responses = [JSON.stringify({ tool: "run_nodes", args: { nodeIds: [resolved, "table"] } })]; await state().send(); assert(current().pending); responses = [(body) => { assert(JSON.stringify(body.messages).includes("尚不支持直接运行节点类型")); return final("已阻止不支持的调用"); }]; await state().confirm(true); assert.equal(a.record.runs.length, runsBeforeUnsupported);
    const clearing = context("assistant-clear-loading", [node("loading")]); state().setContext(clearing.value); await state().clearHistory(); await tick(); assert.equal(state().loading, false); assert(current()); assert.equal(current().messages.length, 0); await activate(a.value);
    // Recreate a valid output after testing the all-history reset.
    const fresh = context("assistant-skills", [node("skill-input"), node("skill-output", "image")]); await activate(fresh.value);
    await loadAssistantSkills();
    const skills = useCanvasAssistantSkillStore.getState(), skillDraft = { name: "冻结验收", description: "测试", content: "SKILL_FROZEN_ORIGINAL", inputMode: "any" as const, tags: [] };
    const skill = await skills.saveSkill(skillDraft); state().setSkill(skill.id); state().setDraft("使用技能执行");
    responses = [(body) => { const system = JSON.stringify(body.messages[0]); assert(system.includes("SKILL_FROZEN_ORIGINAL")); assert(!system.includes("SKILL_EDITED_LATER")); return JSON.stringify({ tool: "read_canvas", args: {} }); }, (body) => { assert(JSON.stringify(body.messages[0]).includes("SKILL_FROZEN_ORIGINAL")); return JSON.stringify({ tool: "run_nodes", args: { nodeIds: ["skill-output"] } }); }];
    await state().send(); assert(current().pending); assert(current().turnSkillPrompt?.includes("SKILL_FROZEN_ORIGINAL")); state().setSkill("builtin:storyboard"); assert.equal(current().skillId, skill.id);
    await skills.saveSkill({ ...skillDraft, content: "SKILL_EDITED_LATER" }, skill.id); responses = [(body) => { const system = JSON.stringify(body.messages[0]); assert(system.includes("SKILL_FROZEN_ORIGINAL")); assert(!system.includes("SKILL_EDITED_LATER")); return final("技能回合完成"); }]; await state().confirm(false);
    state().setDraft("下一轮使用更新技能"); responses = [(body) => { assert(JSON.stringify(body.messages[0]).includes("SKILL_EDITED_LATER")); return final("新技能已生效"); }]; await state().send();
    console.log("PASS selected Skill reaches actual system requests, stays frozen through tools and confirmation, and refreshes only on next turn.");
    state().addReferences(["skill-input"]); state().setOpen(false);
    let bubbled = 0; const countBubble = () => { bubbled += 1; }; document.addEventListener("pointerdown", countBubble); document.addEventListener("wheel", countBubble);
    await act(async () => root.render(<CanvasAssistantDock />));
    const orb = host.querySelector<HTMLButtonElement>("[data-assistant-orb]")!; assert(orb); await click(orb); assert(state().open); assert.equal(bubbled, 0);
    const panel = host.querySelector<HTMLElement>("[data-assistant-panel]")!; assert.equal(panel.hasAttribute("data-canvas-overlay"), true); assert.equal(panel.hasAttribute("data-canvas-no-zoom"), true);
    assert(host.textContent?.includes("Skill"));
    await click(host.querySelector('[data-assistant-models]')!); assert(host.textContent?.includes("暂无视频模型")); assert(host.textContent?.includes("same-model（绘画）")); assert(host.textContent?.includes("same-model（另一绘画）"));
    const addConfig = { ...config, channels: [...config.channels, { id: "video", name: "视频", baseUrl: "https://video.test", apiKey: "stub-video-key", apiFormat: "openai" as const, models: [{ name: "video-live", capability: "video" as const }] }] };
    await act(async () => useConfigStore.setState({ config: addConfig })); assert(host.textContent?.includes("video-live（视频）"));
    const liveModel = [...host.querySelectorAll("[data-assistant-menu] button")].find((button) => button.textContent?.includes("video-live（视频）"))!; await click(liveModel); assert(current().models.some((id) => id === encodeChannelModel("video", "video-live")));
    await click(host.querySelector('[data-assistant-models]')!); await act(async () => useConfigStore.setState({ config })); assert(!host.querySelector("[data-assistant-menu]")?.textContent?.includes("video-live"));
    await click(host.querySelector('[aria-label="关闭模型菜单"]')!);
    const remove = host.querySelector('[aria-label="移除引用 skill-input"]')!; await click(remove); assert(!current().references.includes("skill-input"));
    await fire(panel, new WheelEvent("wheel", { bubbles: true, deltaY: 100 })); assert.equal(bubbled, 0);
    const handle = host.querySelector('[data-assistant-drag-handle]')!, beforeLeft = panel.style.left;
    await fire(handle, new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 700, clientY: 100 })); await fire(window, new PointerEvent("pointermove", { bubbles: true, clientX: 600, clientY: 130 })); await fire(window, new PointerEvent("pointerup", { bubbles: true, button: 0 })); assert.notEqual(panel.style.left, beforeLeft);
    const beforeHeight = panel.style.height; await fire(host.querySelector('[aria-label="调整 Agent 浮窗高度"]')!, new PointerEvent("pointerdown", { bubbles: true, button: 0, clientY: 300 })); await fire(window, new PointerEvent("pointermove", { bubbles: true, clientY: 220 })); await fire(window, new PointerEvent("pointerup", { bubbles: true })); assert.notEqual(panel.style.height, beforeHeight);
    await act(async () => useThemeStore.setState({ theme: "dark" })); const expectedColor = document.createElement("span"); expectedColor.style.color = canvasThemes.dark.node.text; assert.equal(panel.style.color, expectedColor.style.color);
    document.removeEventListener("pointerdown", countBubble); document.removeEventListener("wheel", countBubble);
    console.log("PASS live menus update/remove channels, models and chips click with full pointer sequence; panel stops canvas events; drag/resize and dark theme work.");
}
main().then(async () => { await act(async () => { state().setContext(null); root.unmount(); }); host.remove(); globalThis.fetch = originalFetch; console.log("ALL CANVAS ASSISTANT CHECKS PASSED"); process.exit(0); }).catch(async (error) => { console.error(error); globalThis.fetch = originalFetch; await act(async () => root.unmount()); process.exit(1); });