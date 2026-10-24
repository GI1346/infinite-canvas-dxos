import assert from "node:assert/strict";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import type { ViewportTransform } from "../src/types/canvas";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); }
const pointer = (type: string, init = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 4, button: 0, clientX: 100, clientY: 100, ...init });
async function space(type: string, target: EventTarget, init = {}) { const event = new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true, cancelable: true, ...init }); await fire(target, event); return event; }

async function main() {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), ref = createRef<HTMLDivElement>();
    let viewport: ViewportTransform = { x: 12, y: 24, k: 1 }, nodeDrags = 0, selections = 0, actions = 0, keyEvents = 0;
    function Controls({ scope }: { scope: string }) {
        return <div data-canvas-overlay data-canvas-no-zoom data-scope={scope}>
            <button onClick={() => actions++}>确认生成</button><button onClick={() => actions++}>取消生成</button>
            <select aria-label={`${scope}模型`} onChange={() => actions++}><option>A</option><option>B</option></select>
            <input type="checkbox" onChange={() => actions++} /><input type="radio" onChange={() => actions++} />
            <div tabIndex={0} role="switch" onKeyDown={() => keyEvents++}>开关</div>
            <textarea aria-label={`${scope}文本`} /><input type="text" /><input type="number" /><div contentEditable suppressContentEditableWarning>可输入文本</div>
        </div>;
    }
    function Harness() {
        const [v, setV] = useState(viewport);
        return <><InfiniteCanvas containerRef={ref} viewport={v} tool="select" onCanvasMouseDown={() => selections++} onViewportChange={(next) => { viewport = next; setV(next); }}>
            <div data-node-id="text" onMouseDown={() => nodeDrags++}><button data-node-action onClick={() => actions++}>节点操作</button><textarea data-node-text /><div data-node-empty>节点空白</div></div>
        </InfiniteCanvas><Controls scope="agent" />{createPortal(<Controls scope="portal" />, document.body)}</>;
    }
    await act(async () => { root.render(<Harness />); await tick(); });
    try {
        const targets = [...document.querySelectorAll<HTMLElement>("[data-scope] button,[data-scope] select,[data-scope] input[type=checkbox],[data-scope] input[type=radio],[data-scope] [role=switch],[data-node-action]")];
        for (const target of targets) {
            const start = { ...viewport }; let received = 0;
            const count = () => received++; target.addEventListener("keydown", count); target.addEventListener("keyup", count); target.focus();
            assert.equal((await space("keydown", target)).defaultPrevented, true, target.outerHTML);
            for (let i = 0; i < 3; i++) assert.equal((await space("keydown", target, { repeat: true })).defaultPrevented, true);
            assert.notEqual(document.activeElement, target, "focused actions must be blurred before browser keyup activation");
            const node = host.querySelector("[data-node-empty]")!;
            await fire(node, pointer("pointerdown")); await fire(node, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            await fire(window, pointer("pointermove", { clientX: 140, clientY: 125 })); await fire(window, pointer("pointerup"));
            await fire(node, new MouseEvent("click", { bubbles: true, cancelable: true }));
            assert.equal((await space("keyup", target)).defaultPrevented, true);
            assert.equal(received, 0); assert.equal(viewport.x, start.x + 40); assert.equal(viewport.y, start.y + 25);
            assert.equal(actions, 0); assert.equal(nodeDrags, 0); assert.equal(selections, 0); assert.equal(keyEvents, 0);
            target.removeEventListener("keydown", count); target.removeEventListener("keyup", count);
        }
        console.log(`PASS focused native controls: ${targets.length} Agent/portal/node buttons, model selectors, checkbox/radio/switch; keydown + repeat + keyup suppressed; pan never activates an action or drags a node.`);
        const textFields = [...document.querySelectorAll<HTMLElement>("textarea,input[type=text],input[type=number],[contenteditable]")];
        for (const target of textFields) {
            target.focus(); assert.equal((await space("keydown", target)).defaultPrevented, false); assert.equal((await space("keyup", target)).defaultPrevented, false);
            assert.equal(document.activeElement, target, "ordinary text entry preserves focus"); assert.equal(ref.current!.style.cursor, "");
        }
        console.log(`PASS normal Space typing remains untouched in ${textFields.length} node/Agent/portal text fields.`);
        const input = host.querySelector<HTMLTextAreaElement>("[data-node-text]")!, node = host.querySelector("[data-node-empty]")!, start = { ...viewport };
        input.focus(); assert.equal((await space("keydown", input)).defaultPrevented, false);
        await fire(node, pointer("pointerdown")); await fire(node, new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        await fire(window, pointer("pointermove", { clientX: 160, clientY: 130 })); await fire(window, pointer("pointerup"));
        assert.equal((await space("keyup", document.body)).defaultPrevented, true);
        assert.equal(viewport.x, start.x + 60); assert.equal(viewport.y, start.y + 30); assert.equal(nodeDrags, 0); assert.notEqual(document.activeElement, input);
        input.focus(); await space("keydown", input); await fire(window, new Event("blur"));
        await fire(node, pointer("pointerdown")); await fire(node, new MouseEvent("mousedown", { bubbles: true, cancelable: true })); await fire(window, pointer("pointerup"));
        assert.equal(nodeDrags, 1, "window blur clears both physical typing Space and active pan state");
        for (const init of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
            assert.equal((await space("keydown", document.body, init)).defaultPrevented, false); await space("keyup", document.body);
        }
        console.log("PASS text-edit-to-pan handover, window blur cleanup, and IME/modifier isolation.");
    } finally { await act(async () => root.unmount()); host.remove(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });