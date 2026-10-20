import assert from "node:assert/strict";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { CanvasNodeCropDialog } from "../src/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog } from "../src/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog } from "../src/components/canvas/canvas-node-split-dialog";
import type { ViewportTransform } from "../src/types/canvas";

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(1); }); }
const pointer = (type: string, options = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, button: 0, buttons: 1, ...options });
const click = (el: EventTarget) => fire(el, new MouseEvent("click", { bubbles: true, cancelable: true }));
const space = async (type: string, target: EventTarget, repeat = false) => { const e = new KeyboardEvent(type, { code: "Space", key: " ", repeat, bubbles: true, cancelable: true }); await fire(target, e); return e; };
const button = (scope: ParentNode, text: string) => { const el = [...scope.querySelectorAll("button")].find((b) => b.textContent?.replace(/\s/g, "") === text.replace(/\s/g, "")); assert.ok(el, text); return el; };
const labeled = (scope: ParentNode, name: string) => { const el = scope.querySelector(`[aria-label="${name}"]`); assert.ok(el, name); return el as HTMLButtonElement; };

async function check(kind: "crop" | "mask" | "split") {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), ref = createRef<HTMLDivElement>();
    let viewport: ViewportTransform = { x: 25, y: 35, k: 1 }, confirmed = 0, closed = 0;
    function Harness() {
        const [v, setV] = useState(viewport), Dialog = kind === "crop" ? CanvasNodeCropDialog : kind === "mask" ? CanvasNodeMaskEditDialog : CanvasNodeSplitDialog;
        return <ConfigProvider virtual={false}><InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => { viewport = next; setV(next); }}><div data-node-id="background"><button>背景节点</button></div></InfiniteCanvas><Dialog dataUrl="data:image/png;base64,AA==" open onClose={() => closed++} onConfirm={() => confirmed++} /></ConfigProvider>;
    }
    await act(async () => { root.render(<Harness />); await tick(60); });
    try {
        const modal = document.querySelector(".ant-modal")! as HTMLElement; assert.ok(modal);
        let control: HTMLButtonElement, target: HTMLElement, scroll: HTMLElement, before: string, snapshot: () => string;
        if (kind === "crop") {
            const width = modal.querySelector('[aria-label="裁剪扩图输出宽度"]') as HTMLInputElement; assert.equal(width.value, "1200");
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; nativeSetter.call(width, "1500"); await fire(width, new Event("input", { bubbles: true })); await fire(width, new Event("change", { bubbles: true }));
            control = button(modal, "恢复原图选区"); target = modal.querySelector('[data-crop-handle="se"]')!; scroll = modal.querySelector("[data-crop-viewport]")!;
            snapshot = () => modal.querySelector("[data-crop-frame]")!.getAttribute("style") || ""; before = snapshot(); assert.ok(before.includes("width"));
        } else if (kind === "mask") {
            target = modal.querySelector("canvas.cursor-none")! as HTMLElement; assert.ok(target); scroll = [...modal.querySelectorAll<HTMLDivElement>("div")].find((element) => element.classList.contains("min-h-[360px]") && element.contains(target))!;
            await fire(target, pointer("pointerdown", { clientX: 100, clientY: 100 })); await fire(target, pointer("pointerup", { buttons: 0 }));
            assert.equal(labeled(modal, "撤回局部涂抹").disabled, false); control = button(modal, "重置");
            snapshot = () => String(labeled(modal, "撤回局部涂抹").disabled) + ":" + (target as any).getContext("2d").marks; before = snapshot();
        } else {
            control = button(modal, "横向线"); await click(control); assert.equal(modal.querySelectorAll('[data-grid-line^="horizontal"]').length, 2);
            target = modal.querySelector('[data-grid-line="horizontal:0"]')!; scroll = modal.querySelector("[data-grid-viewport]")!;
            snapshot = () => [...modal.querySelectorAll("[data-grid-line]")].map((el) => el.getAttribute("style")).join("|"); before = snapshot();
        }
        assert.ok(scroll); control.focus(); let keyboardEvents = 0, clickEvents = 0; const count = () => keyboardEvents++; const countClick = () => clickEvents++;
        control.addEventListener("keydown", count); control.addEventListener("keyup", count); control.addEventListener("click", countClick);
        assert.equal((await space("keydown", control)).defaultPrevented, true);
        for (let i = 0; i < 5; i++) assert.equal((await space("keydown", control, true)).defaultPrevented, true);
        scroll.scrollLeft = 130; scroll.scrollTop = 100;
        await fire(target, pointer("pointerdown", { clientX: 100, clientY: 100 })); await fire(target, pointer("pointermove", { clientX: 145, clientY: 130 })); await fire(target, pointer("pointerup", { buttons: 0 }));
        assert.equal(scroll.scrollLeft, 85); assert.equal(scroll.scrollTop, 70); assert.equal((await space("keyup", control)).defaultPrevented, true);
        assert.equal(snapshot(), before); assert.equal(keyboardEvents, 0); assert.equal(clickEvents, 0); assert.equal(confirmed, 0); assert.equal(closed, 0); assert.equal(ref.current!.style.cursor, ""); assert.deepEqual(viewport, { x: 25, y: 35, k: 1 });
        if (kind === "mask") {
            const textarea = modal.querySelector("textarea")!; textarea.focus(); assert.equal((await space("keydown", textarea)).defaultPrevented, false); assert.equal((await space("keydown", textarea, true)).defaultPrevented, false); assert.equal((await space("keyup", textarea)).defaultPrevented, false);
        }
        control.focus(); await space("keydown", control); await fire(window, new Event("blur")); assert.equal(ref.current!.style.cursor, "");
        console.log(`PASS real ${kind} modal: focused action + repeated Space + pointer pan does not edit, fire action, or move background`);
    } finally { await act(async () => root.unmount()); host.remove(); await tick(5); }
}
(async () => { for (const kind of ["crop", "mask", "split"] as const) await check(kind); console.log("PASS real editor Space isolation: 3/3 modals; jsdom image loading/2D canvas mocked, real React/Ant Design handlers"); })().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
