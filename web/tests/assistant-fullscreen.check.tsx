import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { CanvasAssistantDock } from "../src/components/agent/canvas-assistant-dock";
import { useCanvasAssistantStore as store, type CanvasAssistantContext, type CanvasAssistantSession } from "../src/stores/use-canvas-assistant-store";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";
import { useThemeStore } from "../src/stores/use-theme-store";
import { canvasThemes } from "../src/lib/canvas-theme";

HTMLElement.prototype.scrollIntoView = function () {};
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const state = () => store.getState(), current = () => state().sessions.find((item) => item.id === state().currentId)!;
const label = (name: string) => { const el = document.querySelector<HTMLElement>(`[aria-label="${name}"]`); assert(el, name); return el; };
const field = () => label("Agent 全屏输入文字") as HTMLTextAreaElement;
const modal = () => document.querySelector<HTMLElement>("[data-assistant-editor]");
const fire = async (el: EventTarget, event: Event) => act(async () => { el.dispatchEvent(event); await tick(); });
async function click(el: HTMLElement) { for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) await fire(el, type.startsWith("pointer") ? new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }) : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })); }
async function input(el: HTMLTextAreaElement, value: string) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value); await fire(el, new Event("input", { bubbles: true })); }
const mutate = async (patch: Partial<CanvasAssistantSession>) => act(async () => { store.setState({ sessions: state().sessions.map((item) => item.id === state().currentId ? { ...item, ...patch } : item) }); await tick(); });
function context(id: string): CanvasAssistantContext { const snapshot = { projectId: id, title: id, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }; return { snapshot, getSnapshot: () => snapshot, applyOps: () => snapshot, runNode: async () => { throw Error("Generation is forbidden in editor checks"); } }; }
const originalFetch = globalThis.fetch; let network = 0;
globalThis.fetch = (async () => { network++; throw Error("Network is forbidden in editor checks"); }) as typeof fetch;

async function main() {
    useConfigStore.setState({ config: { ...defaultConfig, channels: [], models: [], textModel: "", imageModel: "", videoModel: "" } });
    await act(async () => { state().setContext(context("fullscreen-fixture")); state().setOpen(true); await tick(); root.render(<ConfigProvider theme={{ token: { motion: false } }}><CanvasAssistantDock /></ConfigProvider>); await tick(); });
    const original = "产品设计草稿\n" + "保留真实产品结构，风格参考不改变产品。\n".repeat(500);
    await input(label("Agent 消息") as HTMLTextAreaElement, original);
    await click(label("全屏编辑 Agent 输入"));
    assert(modal()?.hasAttribute("data-canvas-overlay")); assert(modal()?.hasAttribute("data-canvas-no-zoom"));
    assert.equal(field().value, original); assert.equal(field().readOnly, false);
    const dialog = field().closest<HTMLElement>(".ant-modal")!;
    assert.equal(dialog.style.width, "100vw"); assert.equal(dialog.style.height, "100dvh");
    const edited = original.replace("产品设计草稿", "修改后的完整草稿") + "末尾新内容\n第二行 ";
    await input(field(), edited); assert.equal(current().draft, edited); assert.equal((label("Agent 消息") as HTMLTextAreaElement).value, edited);
    for (const key of ["Enter", " "]) { const event = new KeyboardEvent("keydown", { key, code: key === "Enter" ? "Enter" : "Space", bubbles: true, cancelable: true }); await fire(field(), event); assert.equal(event.defaultPrevented, false); }
    assert.equal(network, 0); assert.equal(current().messages.length, 0); assert.equal(current().draft, edited);
    console.log("PASS full-viewport editable textarea, 500-line draft, live two-way store synchronization; Enter/Space never submit.");

    let escaped = 0; const counter = () => escaped++;
    for (const type of ["pointerdown", "wheel", "keydown"]) document.addEventListener(type, counter);
    await fire(field(), new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    await fire(field(), new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
    await fire(field(), new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    assert.equal(escaped, 0);
    for (const type of ["pointerdown", "wheel", "keydown"]) document.removeEventListener(type, counter);
    await click([...modal()!.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent === "完成编辑")!);
    assert.equal(modal(), null); assert.equal(current().draft, edited);
    await click(label("全屏编辑 Agent 输入")); assert.equal(field().value, edited);
    await fire(field(), new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(modal(), null); assert.equal(current().draft, edited);
    await click(label("全屏编辑 Agent 输入")); await click(modal()!.querySelector<HTMLButtonElement>(".ant-modal-close")!);
    assert.equal(modal(), null); assert.equal(current().draft, edited);
    console.log("PASS pointer/wheel/keyboard isolation; Done/close/Escape retain edits and reopening preserves full text.");

    await mutate({ running: true }); await click(label("全屏编辑 Agent 输入"));
    assert.equal(field().readOnly, true); assert.equal(field().disabled, false); assert.equal(field().value, edited);
    await fire(field(), new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await mutate({ running: false, pending: { tool: "run_nodes", args: { nodeIds: [] } } }); await click(label("全屏编辑 Agent 输入"));
    assert.equal(field().readOnly, true); assert.equal(field().disabled, false);
    await fire(field(), new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await mutate({ pending: undefined });
    console.log("PASS running and pending sessions allow fullscreen selection/copy but remain read-only.");

    await click(label("全屏编辑 Agent 输入"));
    await act(async () => { useThemeStore.setState({ theme: "dark" }); await tick(); });
    const color = document.createElement("span"); color.style.color = canvasThemes.dark.node.text; assert.equal(field().style.color, color.style.color);
    await act(async () => { useThemeStore.setState({ theme: "light" }); await tick(); });
    color.style.color = canvasThemes.light.node.text; assert.equal(field().style.color, color.style.color);
    const firstId = state().currentId;
    await act(async () => { state().createSession(); await tick(); }); assert.equal(modal(), null); assert.equal(current().draft, "");
    await act(async () => { state().selectSession(firstId); await tick(); }); assert.equal(current().draft, edited);
    await click(label("全屏编辑 Agent 输入")); await act(async () => { state().setOpen(false); await tick(); }); assert.equal(modal(), null);
    await act(async () => { state().setOpen(true); await tick(); }); assert.equal(modal(), null);
    await click(label("全屏编辑 Agent 输入")); await act(async () => { state().setContext(context("fullscreen-second-project")); await tick(); }); assert.equal(modal(), null);
    assert.equal(network, 0);
    console.log("PASS both themes; session/project/collapse close editor without leaking drafts; zero network or generation requests.");
}
main().then(async () => { await act(async () => root.unmount()); host.remove(); globalThis.fetch = originalFetch; console.log("ALL ASSISTANT FULLSCREEN CHECKS PASSED"); process.exit(0); }).catch(async (error) => { console.error(error); try { await act(async () => root.unmount()); } catch {} globalThis.fetch = originalFetch; process.exit(1); });
