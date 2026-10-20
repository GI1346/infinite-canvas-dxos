import assert from "node:assert/strict";
import fs from "node:fs";
import React, { act, createRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { InfiniteCanvas } from "../src/components/canvas/infinite-canvas";
import { useConnectionCutter, ConnectionCutEffects } from "../src/components/canvas/use-connection-cutter";
import { connectionCurve, curvePath, intersectConnectionSweep, splitCurve, type ConnectionCurve } from "../src/lib/canvas/canvas-connection-geometry";
import { connectionCutHistory } from "../src/lib/canvas/canvas-connection-cut-history";
import { useCanvasStore, flushCanvasStorage } from "../src/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData, Position, ViewportTransform } from "../src/types/canvas";

// Real hook, capture layer, geometry, history helper and local persistence; no live project or network.
const results: { name: string; passed: boolean; detail?: string }[] = [];
const noop = () => {};
const wait = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name: string, work: () => unknown | Promise<unknown>) {
    try { await work(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, detail: String(error) }); console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
const node = (id: string, x: number, y: number, type = "image"): CanvasNodeData => ({ id, type, title: id, position: { x, y }, width: 100, height: 100 });
const nodes = [0, 100, 200].flatMap((y, i) => [node(`from${i}`, 0, y), node(`to${i}`, 400, y)]);
const connections: CanvasConnection[] = [0, 1, 2].map((i) => ({ id: `edge${i}`, fromNodeId: `from${i}`, toNodeId: `to${i}`, ...(i === 2 ? { toPort: "input-3" } : {}) }));
const pointer = (type: string, options = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, pointerId: 1, ...options });
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await wait(); }); return event; }

async function mount(viewport: ViewportTransform = { x: 10, y: 20, k: 1 }) {
    const ref = createRef<HTMLDivElement>(), commits: Set<string>[] = [];
    let cutter!: ReturnType<typeof useConnectionCutter>, currentViewport = viewport, drags = 0, selections = 0;
    function Harness() {
        const [v, setV] = useState(viewport);
        cutter = useConnectionCutter({ containerRef: ref, nodes, connections, viewport: v, onCommit: (ids) => commits.push(new Set(ids)) });
        return <InfiniteCanvas containerRef={ref} viewport={v} tool="select" onViewportChange={(next) => { currentViewport = next; setV(next); }} onCanvasMouseDown={() => selections++} onConnectionCutStart={cutter.start} isCuttingConnections={cutter.cutting}>
            <svg><ConnectionCutEffects trail={cutter.trail} severed={cutter.severed} scale={v.k} /></svg>
            <div data-node-id="body" onMouseDown={() => drags++}><div data-blank>node whitespace</div><input /><textarea /><select><option>A</option></select><button>action</button><a href="#">link</a><div contentEditable suppressContentEditableWarning>editor</div><div data-node-handle /><div data-node-toolbar>toolbar</div></div>
            <div data-canvas-overlay>overlay</div>
        </InfiniteCanvas>;
    }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => root.render(<Harness />));
    ref.current!.getBoundingClientRect = () => ({ left: 5, top: 7, x: 5, y: 7, right: 1005, bottom: 807, width: 1000, height: 800, toJSON: noop });
    // JSDOM has no native pointer capture: model its state, not gesture termination.
    const captures = new Set<number>();
    ref.current!.setPointerCapture = (id) => { captures.add(id); };
    ref.current!.hasPointerCapture = (id) => captures.has(id);
    ref.current!.releasePointerCapture = (id) => { captures.delete(id); };
    const screen = (x: number, y: number) => ({ clientX: 5 + currentViewport.x + x * currentViewport.k, clientY: 7 + currentViewport.y + y * currentViewport.k });
    return { host, ref, commits, screen, cutter: () => cutter, viewport: () => currentViewport, drags: () => drags, selections: () => selections, loseCapture: async () => { captures.clear(); await fire(ref.current!, pointer("lostpointercapture")); }, start: (x = 250, y = 0, target: EventTarget = ref.current!) => fire(target, pointer("pointerdown", { ctrlKey: true, ...screen(x, y) })), move: (x: number, y: number, more = {}) => fire(window, pointer("pointermove", { ...screen(x, y), ...more })), end: (x = 250, y = 300, more = {}) => fire(window, pointer("pointerup", { buttons: 0, ...screen(x, y), ...more })), close: async () => { await act(async () => root.unmount()); host.remove(); } };
}

await check("geometry detects sparse swept crossings at all supported zooms and rejects screen-space misses", () => {
    const curve = connectionCurve(connections[0], nodes[0], nodes[1]);
    for (const scale of [.05, .25, 1, 2, 5]) {
        assert.notEqual(intersectConnectionSweep(curve, { x: 250, y: -500 }, { x: 250, y: 500 }, scale), null);
        assert.notEqual(intersectConnectionSweep(curve, { x: 200, y: 50 + 2.8 / scale }, { x: 300, y: 50 + 2.8 / scale }, scale), null);
        assert.equal(intersectConnectionSweep(curve, { x: 200, y: 50 + 3.2 / scale }, { x: 300, y: 50 + 3.2 / scale }, scale), null);
        assert.notEqual(intersectConnectionSweep(curve, { x: 250, y: 50 }, { x: 250, y: 50 }, scale), null);
    }
    const equal: ConnectionCurve = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, { x: 300, y: 0 }];
    for (const x of [0, 30, 75, 150, 270, 300]) assert.ok(Math.abs(intersectConnectionSweep(equal, { x, y: -100 }, { x, y: 100 }, 1)! - x / 300) < 1e-8, `cut animation position x=${x}`);
    for (const scale of [.05, .25, 1, 2, 5]) for (const x of [101, 130, 175, 230, 320, 399]) {
        const t = intersectConnectionSweep(curve, { x, y: -100 }, { x, y: 200 }, scale)!;
        const point = splitCurve(curve, t)[0][3];
        assert.ok(Math.abs(point.x - x) * scale < .5, `nonuniform cubic animation offset ${Math.abs(point.x - x) * scale}px at zoom ${scale}`);
    }
});
await check("curved/backward connections use their rendered cubic geometry and retain table N-port anchor", () => {
    const from = node("reverse-from", 500, 100), to = node("reverse-to", 40, 350, "dxos:table");
    to.metadata = { tableInputChannels: Array.from({ length: 5 }, (_, i) => ({ id: `input-${i + 1}`, name: `输入 ${i + 1}`, mode: "sequence" as const })) };
    const connection = { id: "backward", fromNodeId: from.id, toNodeId: to.id, toPort: "input-5" };
    const curve = connectionCurve(connection, from, to);
    assert.deepEqual(curve[3], { x: 40, y: 512 });
    const [left, right] = splitCurve(curve, .4), middle = left[3];
    assert.deepEqual(middle, right[0]); assert.ok(curvePath(curve).endsWith("40 512"));
    for (const scale of [.05, 1, 5]) assert.notEqual(intersectConnectionSweep(curve, { x: middle.x - 200, y: middle.y - 200 }, { x: middle.x + 200, y: middle.y + 200 }, scale), null);
});
await check("Ctrl-left node whitespace cuts three lines in one sparse move without node dragging or marquee", async () => {
    const ui = await mount();
    try {
        const blank = ui.host.querySelector("[data-blank]")!;
        const event = await ui.start(250, 0, blank); assert.equal(event.defaultPrevented, true); assert.equal(ui.cutter().cutting, true);
        await fire(blank, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
        await ui.move(250, 300); assert.deepEqual([...ui.cutter().pendingIds].sort(), ["edge0", "edge1", "edge2"]); assert.equal(ui.commits.length, 0);
        assert.equal(ui.host.querySelectorAll("[data-severed-connection]").length, 6); assert.ok(ui.host.querySelector("[data-cut-trail]"));
        await ui.end(); assert.equal(ui.commits.length, 1); assert.deepEqual([...ui.commits[0]].sort(), ["edge0", "edge1", "edge2"]); assert.equal(ui.cutter().cutting, false); assert.equal(ui.cutter().pendingIds.size, 0);
        await ui.end(); assert.equal(ui.commits.length, 1); assert.equal(ui.drags(), 0); assert.equal(ui.selections(), 0); assert.deepEqual(ui.viewport(), { x: 10, y: 20, k: 1 });
    } finally { await ui.close(); }
});
await check("Ctrl-left editors, controls, toolbar, handles and overlays never initiate cutting", async () => {
    const ui = await mount();
    try {
        for (const target of ui.host.querySelectorAll("input,textarea,select,button,a,[contenteditable],[data-node-handle],[data-node-toolbar],[data-canvas-overlay]")) {
            await ui.start(250, 0, target); assert.equal(ui.cutter().cutting, false, target.outerHTML); await ui.move(250, 300); await ui.end();
        }
        assert.equal(ui.commits.length, 0);
    } finally { await ui.close(); }
});
await check("screen/world mapping sweeps all lines at min/max zoom and pointerup includes final segment", async () => {
    for (const k of [.05, 1, 5]) {
        const ui = await mount({ x: -800, y: 340, k });
        try { await ui.start(); await ui.end(); assert.equal(ui.commits.length, 1); assert.deepEqual([...ui.commits[0]].sort(), ["edge0", "edge1", "edge2"]); } finally { await ui.close(); }
    }
});
await check("coalesced pointer samples preserve curved sweep and ignore other pointers", async () => {
    const ui = await mount();
    try {
        await ui.start(50, 0); await ui.move(250, 300, { pointerId: 2 }); await ui.end(250, 300, { pointerId: 2 }); assert.equal(ui.cutter().cutting, true); assert.equal(ui.cutter().pendingIds.size, 0);
        const move = pointer("pointermove", ui.screen(50, 0)); Object.defineProperty(move, "getCoalescedEvents", { value: () => [pointer("pointermove", ui.screen(250, 0)), pointer("pointermove", ui.screen(250, 300))] });
        await fire(window, move); assert.deepEqual([...ui.cutter().pendingIds].sort(), ["edge0", "edge1", "edge2"]); await ui.end(50, 0); assert.equal(ui.commits.length, 1);
    } finally { await ui.close(); }
});
await check("pointercancel and window blur finish once; no later hover can cut more connections", async () => {
    for (const end of ["pointercancel", "blur"]) {
        const ui = await mount();
        try { await ui.start(); await ui.move(250, 100); await fire(window, end === "blur" ? new Event("blur") : pointer(end)); assert.equal(ui.cutter().cutting, false); assert.equal(ui.commits.length, 1); assert.deepEqual([...ui.commits[0]], ["edge0"]); await ui.move(250, 300, { buttons: 0 }); await ui.end(); assert.equal(ui.commits.length, 1); } finally { await ui.close(); }
    }
});
await check("lost pointer capture terminates active sweep instead of retaining a cutting hover", async () => {
    const ui = await mount();
    try { await ui.start(); await ui.move(250, 100); await ui.loseCapture(); assert.equal(ui.cutter().cutting, false); assert.equal(ui.commits.length, 1); assert.deepEqual([...ui.commits[0]], ["edge0"]); await ui.move(250, 300, { buttons: 0 }); await ui.end(); assert.equal(ui.commits.length, 1); } finally { await ui.close(); }
});
await check("Ctrl click without motion on the rendered line does not cut it", async () => {
    const ui = await mount();
    try { await ui.start(250, 50); await ui.move(250, 50); await ui.end(250, 50); assert.equal(ui.commits.length, 0); assert.equal(ui.cutter().pendingIds.size, 0); assert.equal(ui.cutter().cutting, false); }
    finally { await ui.close(); }
});
await check("mouseup-only finalizes its actual final segment once and release/click cannot repeat cut", async () => {
    const ui = await mount();
    try {
        await ui.start(); await fire(window, new MouseEvent("mouseup", { button: 0, bubbles: true, cancelable: true, ...ui.screen(250, 300) }));
        assert.equal(ui.cutter().cutting, false); assert.equal(ui.commits.length, 1); assert.deepEqual([...ui.commits[0]].sort(), ["edge0", "edge1", "edge2"]);
        await ui.end(); const click = await fire(ui.ref.current!, new MouseEvent("click", { button: 0, bubbles: true, cancelable: true })); assert.equal(click.defaultPrevented, true); assert.equal(ui.commits.length, 1);
    } finally { await ui.close(); }
});
await check("wheel during cutting cannot change world mapping; zoom resumes after finishing", async () => {
    const ui = await mount();
    try {
        await ui.start(); const before = { ...ui.viewport() };
        const wheel = () => new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true, ...ui.screen(250, 100) });
        const stopped = await fire(ui.host.querySelector("[data-blank]")!, wheel()); assert.equal(stopped.defaultPrevented, true); assert.deepEqual(ui.viewport(), before);
        await ui.end(); await fire(ui.host.querySelector("[data-blank]")!, wheel()); assert.ok(ui.viewport().k > before.k);
    } finally { await ui.close(); }
});
await check("unmount drops unfinished sweep and unregisters listeners without committing later hover", async () => {
    const ui = await mount(); await ui.start(); await ui.move(250, 100); await ui.close();
    await fire(window, pointer("pointermove", { ...ui.screen(250, 300) })); await fire(window, pointer("pointerup", { ...ui.screen(250, 300), buttons: 0 }));
    assert.equal(ui.commits.length, 0);
});
await check("Ctrl-Z finalizes pending cut synchronously before project undo sees its history", async () => {
    const ui = await mount();
    let countAtUndo = -1; const undo = () => { countAtUndo = ui.commits.length; };
    window.addEventListener("keydown", undo);
    try { await ui.start(); await ui.move(250, 300); await fire(window, new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true })); assert.equal(countAtUndo, 1); assert.equal(ui.cutter().cutting, false); await ui.end(); assert.equal(ui.commits.length, 1); }
    finally { window.removeEventListener("keydown", undo); await ui.close(); }
});
await check("one cut is one undo entry; pending previous change and all port metadata survive undo/redo", () => {
    const table = node("table", 500, 100, "dxos:table"); table.metadata = { tableInputChannels: [{ id: "input-1", name: "图片", mode: "sequence" }, { id: "input-3", name: "提示词", mode: "shared" }] };
    const original = { nodes: [table], connections: [...connections, { id: "keep", fromNodeId: "llm", toNodeId: "table", toPort: "llm-output" }], chatSessions: [], activeChatId: null };
    const changed = { ...original, nodes: [{ ...table, title: "已重命名" }] };
    const cut = connectionCutHistory(changed, original, [], new Set(["edge0", "edge1", "edge2"]))!;
    assert.deepEqual(cut.past, [original, changed]); assert.equal(cut.current.connections.length, 1); assert.equal(cut.current.connections[0], original.connections[3]); assert.deepEqual(cut.future, []);
    const undo = cut.past.pop()!; assert.equal(undo, changed); assert.equal(undo.connections, original.connections); assert.equal(undo.connections[2].toPort, "input-3"); assert.deepEqual(undo.nodes[0].metadata, table.metadata);
    const redo = cut.current; assert.deepEqual(redo.connections, [original.connections[3]]); assert.equal(redo.connections[0].toPort, "llm-output");
    assert.equal(connectionCutHistory(original, original, [], new Set(["missing"])), null);
    const one = connectionCutHistory(original, original, [], new Set(["edge0", "edge1"]))!; assert.deepEqual(one.past, [original]);
});
await check("cut result survives actual local project save/rehydrate without losing remaining toPort", async () => {
    await useCanvasStore.persist.rehydrate();
    const store = useCanvasStore.getState(); const id = store.createProject("offline-cut-review");
    store.updateProject(id, { nodes, connections });
    const before = useCanvasStore.getState().openProject(id)!;
    const cut = connectionCutHistory(before, before, [], new Set(["edge0", "edge1"]))!;
    store.updateProject(id, { connections: cut.current.connections }); await flushCanvasStorage();
    useCanvasStore.setState({ projects: [] }); await useCanvasStore.persist.rehydrate();
    const restored = useCanvasStore.getState().openProject(id)!; assert.deepEqual(restored.connections, [connections[2]]); assert.equal(restored.connections[0].toPort, "input-3"); assert.deepEqual(restored.nodes, nodes);
});

fs.mkdirSync(".checks", { recursive: true }); fs.writeFileSync(".checks/connection-cut-results.json", JSON.stringify(results, null, 2));
console.log(`${results.filter((entry) => entry.passed).length}/${results.length} connection cutting checks passed`);
if (results.some((entry) => !entry.passed)) process.exitCode = 1;
