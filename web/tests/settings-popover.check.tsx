import assert from "node:assert/strict";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { CanvasImageSettingsPopover } from "../src/components/canvas/canvas-image-settings-popover";
import { CanvasVideoSettingsPopover } from "../src/components/canvas/canvas-video-settings-popover";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";
import type { ViewportTransform } from "../src/types/canvas";

const pointer = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 140, clientY: 160 });
const click = () => new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); }); }
const button = (panel: Element, text: string) => { const found = [...panel.querySelectorAll("button")].find((element) => element.textContent === text); assert.ok(found, text); return found; };

async function check(kind: "image" | "video") {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host), canvasRef = createRef<HTMLDivElement>();
    let config = { ...defaultConfig, size: "1024x1024" }, viewport: ViewportTransform = { x: 10, y: 20, k: 1 }, selections = 0;
    function Harness() {
        const [currentConfig, setConfig] = useState(config), [v, setViewport] = useState(viewport);
        const update = (key: keyof AiConfig, value: string) => setConfig((current) => config = { ...current, [key]: value });
        const Component = kind === "image" ? CanvasImageSettingsPopover : CanvasVideoSettingsPopover;
        return <InfiniteCanvas containerRef={canvasRef} viewport={v} tool="select" onCanvasMouseDown={() => selections++} onViewportChange={(next) => { viewport = next; setViewport(next); }}><div data-node-id="settings-owner"><Component config={currentConfig} onConfigChange={update} /></div></InfiniteCanvas>;
    }
    await act(async () => root.render(<Harness />));
    await fire(host.querySelector("button")!, click());
    const panel = document.body.querySelector(".canvas-image-settings-popover")!;
    assert.ok(panel); assert.equal(canvasRef.current!.contains(panel), false, "settings must actually render in a body portal");
    assert.ok(panel.hasAttribute("data-canvas-overlay")); assert.ok(panel.hasAttribute("data-canvas-no-zoom"));
    const before = { ...viewport }, first = button(panel, kind === "image" ? "低" : "1080p");
    const down = pointer("pointerdown"); await fire(first, down);
    assert.equal(down.defaultPrevented, false); assert.equal(selections, 0, "React portal capture must not start a canvas selection");
    await fire(first, new MouseEvent("mousedown", { bubbles: true, cancelable: true })); await fire(first, click());
    assert.equal(kind === "image" ? config.quality : config.vquality, kind === "image" ? "low" : "1080");
    await fire(button(panel, "16:9"), click()); assert.ok(config.size !== "1024x1024", "aspect ratio changes persist");
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }); await fire(panel, wheel);
    assert.equal(wheel.defaultPrevented, false); assert.deepEqual(viewport, before);
    await fire(window, new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
    await fire(first, pointer("pointerdown"));
    await fire(window, new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    await fire(window, new PointerEvent("pointerup", { bubbles: true }));
    await fire(window, new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
    assert.deepEqual(viewport, before, "space drag inside settings must not pan canvas"); assert.equal(selections, 0);
    await act(async () => root.unmount()); host.remove();
    console.log(`PASS ${kind} settings portal remains editable without canvas selection, pan, or zoom`);
}

async function main() { await check("image"); await check("video"); }
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
