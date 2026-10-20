import assert from "node:assert/strict";
import fs from "node:fs";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import type { ViewportTransform } from "../src/types/canvas";

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const pointer = (type: string, init = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 2, clientX: 200, clientY: 150, ...init });
const fire = async (target: EventTarget, event: Event) => act(async () => { target.dispatchEvent(event); await tick(); });

async function main() {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host), ref = createRef<HTMLDivElement>();
    let viewport: ViewportTransform = { x: 0, y: 0, k: 1 }, setExternal = (_: ViewportTransform) => {}, frame: number | null = null, frames = 0;
    function Harness() {
        const [view, setView] = useState(viewport);
        setExternal = (next) => { viewport = next; setView(next); };
        return <InfiniteCanvas containerRef={ref} tool="select" viewport={view} onViewportChange={(next) => {
            if (frame) cancelAnimationFrame(frame);
            frame = null; setExternal(next);
        }}><div data-node-id="audit">node</div></InfiniteCanvas>;
    }
    try {
        await act(async () => { root.render(<Harness />); await tick(); });
        const animate = () => { frames++; setExternal({ x: frames * 10, y: frames * 5, k: 1 }); frame = requestAnimationFrame(animate); };
        await act(async () => { frame = requestAnimationFrame(animate); await tick(); });
        await fire(document, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code: "Space" }));
        await fire(ref.current!, pointer("pointerdown"));
        const count = frames;
        await fire(window, pointer("pointermove", { clientX: 215, clientY: 160 }));
        assert.equal(frames, count, "manual pan must cancel an in-flight focus animation immediately, even before 256-world-unit commit");
        const expected = { x: viewport.x, y: viewport.y };
        await fire(window, pointer("pointerup"));
        assert.equal(frame, null);
        assert.equal(viewport.x, expected.x + 15);
        assert.equal(viewport.y, expected.y + 10);
        console.log("PASS navigation focus animation interrupted by a small manual pan, with exact release coordinates.");
    } finally {
        if (frame) cancelAnimationFrame(frame);
        await act(async () => root.unmount()); host.remove();
    }
    for (const k of [0.05, 0.1, 1, 5]) {
        const host = document.createElement("div"); document.body.append(host);
        const root = createRoot(host), ref = createRef<HTMLDivElement>();
        let actual = { x: 31, y: -47, k }, commits = 0;
        function Harness() {
            const [view, setView] = useState(actual);
            return <InfiniteCanvas containerRef={ref} tool="pan" viewport={view} onViewportChange={(next) => { commits++; actual = next; setView(next); }}><div>pan test</div></InfiniteCanvas>;
        }
        const transform = () => ref.current!.querySelector<HTMLElement>("[data-canvas-world]")!.style.transform;
        await act(async () => { root.render(<Harness />); await tick(); });
        await fire(ref.current!, pointer("pointerdown"));
        const started = commits;
        assert.equal(started, 1, "pointerdown commits exactly once to interrupt navigation");
        await fire(window, pointer("pointermove", { clientX: 200 + 255 * k, clientY: 150 - 100 * k }));
        assert.equal(commits, started, "below the world-unit boundary, pan is compositor-only");
        assert.equal(transform(), `translate3d(${31 + 255 * k}px, ${-47 - 100 * k}px, 0) scale(${k})`);
        await fire(window, pointer("pointermove", { clientX: 200 + 257 * k, clientY: 150 - 100 * k }));
        assert.equal(commits, started + 1, "crossing the world-unit boundary refreshes culling");
        await act(async () => {
            window.dispatchEvent(pointer("pointermove", { clientX: 200 + 260 * k, clientY: 150 - 105 * k }));
            window.dispatchEvent(pointer("pointerup"));
            await tick();
        });
        assert.equal(actual.x, 31 + 260 * k);
        assert.equal(actual.y, -47 - 105 * k);
        assert.equal(transform(), `translate3d(${actual.x}px, ${actual.y}px, 0) scale(${k})`);
        await act(async () => root.unmount()); host.remove();
        console.log(`PASS pan scale ${k}: navigation interrupt, compositor-only sub-threshold movement, cull refresh threshold, pending-frame flush on release.`);
    }
    // Execute the actual project viewBounds body, rather than a separately reimplemented formula.
    const source = fs.readFileSync("src/pages/canvas/project.tsx", "utf8");
    const start = source.indexOf("const viewBounds = useMemo(() => {") + "const viewBounds = useMemo(() => {".length;
    const end = source.indexOf("// Quantized overscan", start);
    assert(start > 50 && end > start);
    const boundsFor = new Function("size", "viewport", "cullLeft", "cullTop", source.slice(start, end));
    let cases = 0;
    for (const k of [0.05, 0.1, 1, 5]) for (const x of [-2500, -513, -1, 0, 255, 511, 512, 1850]) for (const y of [-800, 0, 750]) {
        const viewport = { x, y, k }, size = { width: 1440, height: 900 };
        const bounds = boundsFor(size, viewport, Math.floor(-x / k / 512) * 512, Math.floor(-y / k / 512) * 512);
        for (const dx of [-255.9, 0, 255.9]) for (const dy of [-255.9, 0, 255.9]) {
            const left = -(x + dx * k) / k, top = -(y + dy * k) / k;
            assert(bounds.left <= left && bounds.top <= top && bounds.right >= left + size.width / k && bounds.bottom >= top + size.height / k, "overscan must cover all uncommitted pan directions, even at minimum zoom");
            cases++;
        }
    }
    console.log(`PASS project culling: ${cases} bounds/direction cases across scales 0.05/0.1/1/5, no uncovered viewport before next pan commit.`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
