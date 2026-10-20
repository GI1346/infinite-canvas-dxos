import assert from "node:assert/strict";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { CanvasTextSettingsPopover } from "../src/components/canvas/canvas-text-settings-popover";
import { CanvasResourceMentionTextarea } from "../src/components/canvas/canvas-resource-mention-textarea";
import { CanvasPromptChipInput } from "../src/components/canvas/canvas-prompt-chip-input";
import { defaultConfig, type ReasoningEffort } from "../src/stores/use-config-store";
import type { CanvasResourceReference } from "../src/lib/canvas/canvas-resource-references";
import type { ViewportTransform } from "../src/types/canvas";

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); }
const pointer = (type: string, extra = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 31, button: 0, clientX: 240, clientY: 180, ...extra });
async function mouseClick(target: EventTarget, extra = {}) {
    const down = pointer("pointerdown", extra); await fire(target, down);
    await fire(target, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...extra }));
    await fire(target, pointer("pointerup", extra));
    await fire(target, new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, ...extra }));
    await fire(target, new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...extra }));
    return down;
}
const ref: CanvasResourceReference = { id: "ref-text", nodeId: "text-1", kind: "text", label: "文本1", title: "文本节点", text: "一直小猫的海报", active: true };
const initialViewport: ViewportTransform = { x: 17, y: 29, k: 0.8 };
const noPan = async () => { await fire(window, pointer("pointermove", { clientX: 400, clientY: 300 })); await tick(30); await fire(window, pointer("pointerup")); };
const space = (type: string) => fire(window, new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true }));
const key = (target: EventTarget, value: string) => fire(target, new KeyboardEvent("keydown", { key: value, code: value, bubbles: true, cancelable: true }));
async function enterMention(editor: HTMLElement, kind: "chip" | "textarea", value = "@") {
    editor.focus();
    if (kind === "chip") {
        editor.textContent = value;
        const selection = window.getSelection()!, range = document.createRange(); range.setStart(editor.firstChild!, value.length); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    } else {
        if ((editor as HTMLTextAreaElement).value === value) {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "");
            await fire(editor, new Event("input", { bubbles: true }));
        }
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value);
        (editor as HTMLTextAreaElement).setSelectionRange(value.length, value.length);
    }
    await fire(editor, new Event("input", { bubbles: true }));
    const menu = document.querySelector('[data-canvas-resource-mention-menu="true"]'); assert.ok(menu, `${kind} @ opens suggestions`);
    return menu;
}

async function checkTextSettings() {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host), canvasRef = createRef<HTMLDivElement>();
    let viewport = { ...initialViewport }, config = { ...defaultConfig }, count = 1, selections = 0, cuts = 0;
    function Harness() {
        const [current, setCurrent] = useState(config), [v, setViewport] = useState(viewport), [currentCount, setCount] = useState(count);
        return <InfiniteCanvas containerRef={canvasRef} viewport={v} tool="select" onCanvasMouseDown={() => selections++} onConnectionCutStart={() => { cuts++; return true; }} onViewportChange={(next) => { viewport = next; setViewport(next); }}><div data-node-id="text-owner"><CanvasTextSettingsPopover config={current} count={currentCount} onCountChange={(next) => { count = next; setCount(next); }} onConfigChange={(key, value) => setCurrent((before) => config = { ...before, [key]: value })} /></div></InfiniteCanvas>;
    }
    await act(async () => { root.render(<Harness />); await tick(); });
    try {
        await mouseClick(host.querySelector("button")!);
        const panel = document.body.querySelector("[data-canvas-overlay]")!;
        assert.ok(panel); assert.equal(canvasRef.current!.contains(panel), false, "text settings must be a body Portal");
        assert.ok(panel.hasAttribute("data-canvas-no-zoom"));
        const options = [...panel.querySelectorAll("button")]; assert.equal(options.length, 5);
        for (const [index, value] of (["auto", "low", "medium", "high", "xhigh"] as ReasoningEffort[]).entries()) {
            const event = await mouseClick(options[index]); assert.equal(event.defaultPrevented, false);
            assert.equal(config.reasoningEffort, value, `mouse selection must persist ${value}`);
            assert.equal(selections, 0, "text settings must not start background selection");
            assert.equal((canvasRef.current as any).__capturedPointerId, undefined, "text settings must not capture the canvas pointer");
        }
        await mouseClick(options[1], { ctrlKey: true }); assert.equal(config.reasoningEffort, "low"); assert.equal(cuts, 0);
        await space("keydown"); await mouseClick(options[3]); await noPan(); await space("keyup");
        assert.equal(config.reasoningEffort, "high"); assert.deepEqual(viewport, initialViewport); assert.equal(selections, 0);
        const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }); await fire(options[3], wheel);
        assert.equal(wheel.defaultPrevented, false); assert.deepEqual(viewport, initialViewport);
        const input = panel.querySelector("input")!; await mouseClick(input);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "3"); await fire(input, new Event("input", { bubbles: true })); await key(input, "Enter");
        assert.equal(count, 3, "generation count stays editable inside the settings Portal");
        await fire(document.body, pointer("pointerdown")); assert.equal(document.body.querySelector("[data-canvas-overlay]"), null, "outside pointer closes text settings");
        await mouseClick(host.querySelector("button")!);
        const reopened = document.body.querySelector("[data-canvas-overlay]")!; assert.ok(reopened);
        assert.equal(config.reasoningEffort, "high"); assert.equal((reopened.querySelector("input") as HTMLInputElement).value, "3");
        await mouseClick(reopened.querySelectorAll("button")[4]); assert.equal(config.reasoningEffort, "xhigh"); assert.equal(selections, 0);
        // Reproduce the pre-fix DOM shape without changing production sources: Portal capture must detect this exact defect.
        reopened.removeAttribute("data-canvas-overlay"); reopened.removeAttribute("data-canvas-no-zoom");
        const legacyDown = pointer("pointerdown"); await fire(reopened.querySelector("button")!, legacyDown);
        assert.equal(legacyDown.defaultPrevented, true); assert.equal(selections, 1); assert.equal((canvasRef.current as any).__capturedPointerId, 31);
        await fire(window, pointer("pointerup"));
        console.log("PASS text settings: five mouse options, editable count, outside close/reopen persistence, wheel isolation, and pre-fix capture reproduction");
    } finally { await act(async () => root.unmount()); host.remove(); }
}

async function checkMention(kind: "chip" | "textarea", pan: boolean) {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host), canvasRef = createRef<HTMLDivElement>();
    let viewport = { ...initialViewport }, value = "", changes = 0, selections = 0, cuts = 0;
    function Harness() {
        const [current, setCurrent] = useState(""), [v, setViewport] = useState(viewport);
        const Component = kind === "chip" ? CanvasPromptChipInput : CanvasResourceMentionTextarea;
        return <InfiniteCanvas containerRef={canvasRef} viewport={v} tool="select" onCanvasMouseDown={() => selections++} onConnectionCutStart={() => { cuts++; return true; }} onViewportChange={(next) => { viewport = next; setViewport(next); }}><div data-node-id="image-owner"><Component value={current} references={[ref]} onChange={(next) => { value = next; changes++; setCurrent(next); }} /></div></InfiniteCanvas>;
    }
    await act(async () => { root.render(<Harness />); await tick(); });
    try {
        const editor = host.querySelector<HTMLElement>(kind === "chip" ? '[role="textbox"]' : "textarea")!;
        const menu = await enterMention(editor, kind);
        assert.equal(canvasRef.current!.contains(menu), false, "mention menu must be a body Portal");
        assert.ok(menu.hasAttribute("data-canvas-overlay")); assert.ok(menu.hasAttribute("data-canvas-no-zoom"));
        const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }); await fire(menu, wheel); await fire(menu, new Event("scroll"));
        assert.equal(wheel.defaultPrevented, false); assert.deepEqual(viewport, initialViewport);
        const beforeChanges = changes;
        if (pan) await space("keydown");
        await mouseClick(menu.querySelector("button")!, { ctrlKey: !pan }); await noPan(); if (pan) await space("keyup");
        assert.equal(value, "文本1 ", `${kind} @ mouse selection inserts exactly one reference`);
        assert.equal(changes, beforeChanges + 1); assert.equal(document.querySelector('[data-canvas-resource-mention-menu="true"]'), null);
        assert.equal(selections, 0); assert.equal(cuts, 0); assert.equal((canvasRef.current as any).__capturedPointerId, undefined); assert.deepEqual(viewport, initialViewport);
        if (kind === "chip") assert.equal(editor.querySelectorAll('[data-ref-label="文本1"]').length, 1);
        const reopened = await enterMention(editor, kind, "前缀 @"); await mouseClick(reopened.querySelector("button")!);
        assert.equal(value, "前缀 文本1 ", "second mouse selection uses the new Portal instance and preserves preceding text");
        if (kind === "chip") assert.equal(editor.querySelectorAll('[data-ref-label="文本1"]').length, 1);
        await enterMention(editor, kind); await key(editor, "Escape"); assert.equal(document.querySelector('[data-canvas-resource-mention-menu="true"]'), null);
        await enterMention(editor, kind); await key(editor, "ArrowDown"); await key(editor, "ArrowUp"); await key(editor, "Enter");
        assert.equal(value, "文本1 ", "keyboard selection still works after mouse selection/reopening");
        assert.equal(document.querySelector('[data-canvas-resource-mention-menu="true"]'), null);
        assert.equal(selections, 0); assert.equal(cuts, 0); assert.deepEqual(viewport, initialViewport);
        const legacy = await enterMention(editor, kind); legacy.removeAttribute("data-canvas-overlay"); legacy.removeAttribute("data-canvas-no-zoom");
        const legacyDown = pointer("pointerdown"); await fire(legacy.querySelector("button")!, legacyDown);
        assert.equal(legacyDown.defaultPrevented, true); assert.equal(selections, 1); assert.equal((canvasRef.current as any).__capturedPointerId, 31);
        await fire(window, pointer("pointerup"));
        console.log(`PASS ${kind} @ mention: ${pan ? "Space" : "Ctrl"} mouse sequence, scroll, reopen, Escape/arrow/Enter, single insertion, and pre-fix capture reproduction`);
    } finally { await act(async () => root.unmount()); host.remove(); }
}

Object.defineProperty(globalThis, "DOMRect", { value: window.DOMRect, configurable: true });
window.Range.prototype.getBoundingClientRect = () => new DOMRect(220, 170, 1, 20);
window.HTMLElement.prototype.scrollIntoView = () => {};
(async () => { await checkTextSettings(); for (const kind of ["chip", "textarea"] as const) for (const pan of [false, true]) await checkMention(kind, pan); console.log("PASS text/mention portal regression acceptance: 5/5 cases"); })().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
