import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
// Virtual module is compiled directly from the current project.tsx AST by the runner.
// @ts-expect-error Test-only generated module.
import { ProjectDragHarness } from "project-drag-harness";
import { registerNodeDefinitions } from "../src/lib/canvas/node-registry";
import { dxosNodeDefinitions } from "../src/components/canvas/nodes/dxos-workflow-nodes";
import { emptyTable, TABLE_TYPE } from "../src/lib/canvas/dxos-table";
import type { CanvasNodeData, CanvasConnection, ViewportTransform } from "../src/types/canvas";

registerNodeDefinitions([...dxosNodeDefinitions, ...["image", "text", "group"].map(type => ({ type, title: type, icon: null, defaultSize: { width: 100, height: 80 }, hidePanel: true }))]);
const no = () => {}, tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0, requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { requests++; throw Error("Offline drag test must not call APIs"); };
async function test(name: string, work: () => Promise<void>) { await work(); assert.equal(requests, 0); passed++; console.log(`PASS ${name}`); }
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); return event; }
const mouse = (type: string, options = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...options });
const pointer = (type: string, options = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, ...options });
async function down(target: EventTarget, options = {}) { await fire(target, pointer("pointerdown", options)); await fire(target, mouse("mousedown", options)); }
async function move(options = {}) { await fire(window, pointer("pointermove", options)); await fire(window, mouse("mousemove", options)); await act(async () => { await tick(25); }); }
async function up(options = {}) { await fire(window, pointer("pointerup", { buttons: 0, ...options })); await fire(window, mouse("mouseup", { buttons: 0, ...options })); }
const key = (name: string, options = {}) => fire(window, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name, ...options }));
const node = (id: string, x = 20, y = 40, type = "image", groupId?: string): CanvasNodeData => ({ id, type, title: `名称-${id}`, position: { x, y }, width: 100, height: 80, metadata: { ...(groupId ? { groupId } : {}), ...(type === "image" ? { content: `data:image/png;base64,AA==`, status: "success" } : type === "text" ? { content: "节点正文" } : {}) } });
const edge = (id: string, fromNodeId: string, toNodeId: string, toPort?: string): CanvasConnection => ({ id, fromNodeId, toNodeId, ...(toPort ? { toPort } : {}) });
type Seed = { nodes: CanvasNodeData[]; connections?: CanvasConnection[]; viewport?: ViewportTransform; selected?: string[] };
async function mount(seed: Seed) {
    let state: any;
    const el = document.createElement("div"); document.body.append(el); const root = createRoot(el);
    await act(async () => { root.render(<ProjectDragHarness seed={{ connections: [], viewport: { x: 70, y: -30, k: 1 }, ...seed }} expose={(value: any) => { state = value; }} />); await tick(30); });
    const box = { left: 265, top: 92, width: 1200, height: 900 };
    state.container.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: no });
    const find = (id: string) => el.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
    const title = (id: string) => find(id).firstElementChild as HTMLElement;
    return { el, get state() { return state; }, box, find, title, screen: (x: number, y: number) => ({ clientX: box.left + state.viewport.x + x * state.viewport.k, clientY: box.top + state.viewport.y + y * state.viewport.k }), close: async () => { await act(async () => { root.unmount(); await tick(); }); el.remove(); } };
}
async function main() {
    try {
        await test("Alt+单节点真实React DOM拖动阈值后仅复制一次，多帧及松Alt继续移动副本而非原件", async () => {
            const a = node("a"), h = await mount({ nodes: [a] });
            try {
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true });
                await move({ clientX: 402, clientY: 302, altKey: true }); assert.equal(h.state.nodes.length, 1);
                await move({ clientX: 420, clientY: 310, altKey: true }); assert.equal(h.state.nodes.length, 2);
                const copyId = h.state.nodes[1].id;
                await fire(window, new KeyboardEvent("keyup", { bubbles: true, key: "Alt", code: "AltLeft" }));
                for (const [clientX, clientY] of [[440, 330], [470, 350], [510, 380]]) { await move({ clientX, clientY, altKey: false }); assert.equal(h.state.nodes.length, 2); assert.equal(h.state.nodes[1].id, copyId); }
                await up({ clientX: 520, clientY: 390 });
                assert.deepEqual(h.state.nodes[0], a); assert.deepEqual(h.state.nodes[1].position, { x: 140, y: 130 });
                assert.equal(h.state.nodes[1].title, a.title); assert.deepEqual([...h.state.selected], [copyId]); assert.equal(h.state.history.past.length, 1); assert.equal(h.state.isNodeDragging, false);
            } finally { await h.close(); }
        });
        await test("Alt点击或阈值内抖动不复制、不产生撤销记录；mouseup-only快速拖动仍只复制一次", async () => {
            const h = await mount({ nodes: [node("a")] });
            try {
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await up({ clientX: 400, clientY: 300, altKey: true });
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 403, clientY: 303, altKey: true }); await up({ clientX: 403, clientY: 303, altKey: true });
                assert.equal(h.state.nodes.length, 1); assert.deepEqual(h.state.nodes[0].position, { x: 20, y: 40 }); assert.equal(h.state.history.past.length, 0);
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await up({ clientX: 490, clientY: 340, altKey: true });
                assert.equal(h.state.nodes.length, 2); assert.deepEqual(h.state.nodes[1].position, { x: 110, y: 80 }); assert.equal(h.state.history.past.length, 1);
            } finally { await h.close(); }
        });
        await test("真实左键框选两图后Alt拖动整组选中集，原图不动且保留两条不同输入端口", async () => {
            const a = node("a", 20, 40), b = node("b", 170, 40), outside = node("outside", 600, 500);
            const connections = [edge("in2", "outside", "a", "input-2"), edge("in5", "a", "b", "input-5"), edge("out", "b", "outside")];
            const h = await mount({ nodes: [a, b, outside], connections });
            try {
                await down(h.state.container, h.screen(0, 0)); await move(h.screen(300, 150)); await up(h.screen(300, 150)); assert.deepEqual(h.state.selected, new Set(["a", "b"]));
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 530, clientY: 370 }); await up({ clientX: 540, clientY: 380 });
                const [ca, cb] = h.state.nodes.slice(3); assert.equal(h.state.nodes.length, 5); assert.deepEqual(h.state.nodes.slice(0, 3), [a, b, outside]); assert.deepEqual(ca.position, { x: 160, y: 120 }); assert.deepEqual(cb.position, { x: 310, y: 120 }); assert.deepEqual(h.state.selected, new Set([ca.id, cb.id]));
                assert.equal(h.state.connections.length, 6); assert.deepEqual(h.state.connections.slice(3).map(({ fromNodeId, toNodeId, toPort }: CanvasConnection) => ({ fromNodeId, toNodeId, toPort })), [{ fromNodeId: "outside", toNodeId: ca.id, toPort: "input-2" }, { fromNodeId: ca.id, toNodeId: cb.id, toPort: "input-5" }, { fromNodeId: cb.id, toNodeId: "outside", toPort: undefined }]);
                assert.deepEqual(h.state.connections.slice(0, 3), connections); assert.equal(h.state.history.past.length, 1);
            } finally { await h.close(); }
        });
        await test("嵌套分组与混合重复选择递归仅复制一份，内部父组/连线端口重映射且一次undo/redo恢复整个手势", async () => {
            const outer = { ...node("outer", 0, 0, "group"), width: 600, height: 400 }, inner = { ...node("inner", 30, 60, "group", "outer"), width: 320, height: 240 }, a = node("a", 50, 90, "image", "inner"), b = node("b", 190, 90, "image", "inner"), c = node("c", 400, 80, "text", "outer"), outside = node("outside", 1000, 800);
            const originals = [outer, inner, a, b, c, outside], connections = [edge("in", "outside", "a", "input-4"), edge("inside", "a", "b", "input-3"), edge("next", "b", "c"), edge("out", "c", "outside")];
            const h = await mount({ nodes: originals, connections, selected: ["outer", "a", "inner"] });
            try {
                await down(h.title("outer"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 500, clientY: 340, altKey: true }); await move({ clientX: 1100, clientY: 800, altKey: true }); await up({ clientX: 1200, clientY: 900, altKey: true });
                assert.equal(h.state.nodes.length, 11); assert.deepEqual(h.state.nodes.slice(0, 6), originals);
                const copies: CanvasNodeData[] = h.state.nodes.slice(6), byTitle = new Map(copies.map(n => [n.title, n])), co = byTitle.get(outer.title)!, ci = byTitle.get(inner.title)!, ca = byTitle.get(a.title)!, cb = byTitle.get(b.title)!, cc = byTitle.get(c.title)!;
                assert.equal(ci.metadata?.groupId, co.id); assert.equal(ca.metadata?.groupId, ci.id); assert.equal(cb.metadata?.groupId, ci.id); assert.equal(cc.metadata?.groupId, co.id);
                for (const old of originals.slice(0, 5)) { const copy = byTitle.get(old.title)!; assert.deepEqual(copy.position, { x: old.position.x + 800, y: old.position.y + 600 }); }
                assert.deepEqual(h.state.selected, new Set([co.id, ca.id, ci.id])); assert.equal(h.state.connections.length, 8); assert.deepEqual(h.state.connections.slice(4).map(({ fromNodeId, toNodeId, toPort }: CanvasConnection) => [fromNodeId, toNodeId, toPort]), [[outside.id, ca.id, "input-4"], [ca.id, cb.id, "input-3"], [cb.id, cc.id, undefined], [cc.id, outside.id, undefined]]);
                const after = JSON.stringify({ nodes: h.state.nodes, connections: h.state.connections }); assert.equal(h.state.history.past.length, 1);
                await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, originals); assert.deepEqual(h.state.connections, connections); assert.equal(h.state.history.past.length, 0); assert.equal(h.state.history.future.length, 1);
                await key("z", { ctrlKey: true, shiftKey: true }); assert.equal(JSON.stringify({ nodes: h.state.nodes, connections: h.state.connections }), after); assert.equal(h.state.history.past.length, 1); assert.equal(h.state.history.future.length, 0);
                await key("z", { ctrlKey: true }); await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, originals);
            } finally { await h.close(); }
        });
        await test("pointercancel/窗口blur/Escape回滚已拖副本及连线，恢复原选择且无延迟残留副本或撤销项", async () => {
            for (const cancel of ["pointercancel", "blur", "Escape"]) {
                const originals = [node("a"), node("b", 250)], connections = [edge("original", "a", "b", "input-2")], h = await mount({ nodes: originals, connections, selected: ["a", "b"] });
                try {
                    await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 440, clientY: 320, altKey: true }); assert.equal(h.state.nodes.length, 4);
                    // Queue a fresh frame immediately before cancellation to exercise RAF cleanup.
                    await act(async () => { window.dispatchEvent(mouse("mousemove", { clientX: 460, clientY: 340 })); window.dispatchEvent(cancel === "Escape" ? new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }) : cancel === "blur" ? new Event("blur") : pointer("pointercancel")); await tick(35); });
                    await up({ clientX: 460, clientY: 340 }); await act(async () => { await tick(210); });
                    assert.deepEqual(h.state.nodes, originals, cancel); assert.deepEqual(h.state.connections, connections); assert.deepEqual(h.state.selected, new Set(["a", "b"])); assert.equal(h.state.history.past.length, 0); assert.equal(h.state.isNodeDragging, false);
                    await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, originals);
                } finally { await h.close(); }
            }
        });
        await test("已有普通编辑时活动Alt拖动的CtrlZ/Y与CmdShiftZ只取消副本，不撕裂既有undo/redo栈", async () => {
            for (const shortcut of [{ key: "z", ctrlKey: true }, { key: "y", ctrlKey: true }, { key: "z", metaKey: true, shiftKey: true }]) {
                const a = node("a"), h = await mount({ nodes: [a] });
                try {
                    await down(h.title("a"), { clientX: 400, clientY: 300 }); await move({ clientX: 430, clientY: 320 }); await up({ clientX: 430, clientY: 320 }); await act(async () => { await tick(210); });
                    const prior = structuredClone(h.state.nodes); assert.equal(h.state.history.past.length, 1);
                    // Redo variants need past and future entries to detect either stack being consumed.
                    if (shortcut.key === "y" || shortcut.shiftKey) {
                        await down(h.title("a"), { clientX: 400, clientY: 300 }); await move({ clientX: 440, clientY: 330 }); await up({ clientX: 440, clientY: 330 }); await act(async () => { await tick(210); });
                        await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, prior); assert.equal(h.state.history.future.length, 1);
                    }
                    const historyBefore = JSON.stringify(h.state.history), lastBefore = JSON.stringify(h.state.last);
                    await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 460, clientY: 340, altKey: true }); assert.equal(h.state.nodes.length, 2);
                    await fire(window, new KeyboardEvent("keyup", { bubbles: true, key: "Alt", code: "AltLeft" }));
                    const event = await key(shortcut.key, shortcut); assert.equal(event.defaultPrevented, true);
                    await up({ clientX: 480, clientY: 350 }); await act(async () => { await tick(210); });
                    assert.deepEqual(h.state.nodes, prior); assert.equal(h.state.isNodeDragging, false); assert.equal(JSON.stringify(h.state.history), historyBefore); assert.equal(JSON.stringify(h.state.last), lastBefore);
                    await key(shortcut.key, shortcut);
                    if (shortcut.key === "z" && !shortcut.shiftKey) assert.deepEqual(h.state.nodes, [a]);
                    else assert.deepEqual(h.state.nodes[0].position, { x: 90, y: 90 });
                } finally { await h.close(); }
            }
        });
        await test("活动复制期间Delete/Backspace/复制/粘贴/全选/打组快捷键被隔离，不改变副本集及既有历史", async () => {
            const originals = [node("a"), node("b", 250)], h = await mount({ nodes: originals, selected: ["a", "b"] }), invoked: string[] = [];
            (globalThis as any).__dragShortcut = (name: string) => invoked.push(name);
            try {
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 440, clientY: 320, altKey: true });
                const before = JSON.stringify({ nodes: h.state.nodes, connections: h.state.connections, selected: [...h.state.selected] });
                for (const shortcut of [{ key: "Delete" }, { key: "Backspace" }, { key: "c", ctrlKey: true }, { key: "v", ctrlKey: true }, { key: "a", ctrlKey: true }, { key: "g", ctrlKey: true }, { key: "g", ctrlKey: true, shiftKey: true }, { key: "v", metaKey: true }]) {
                    const event = await key(shortcut.key, shortcut); assert.equal(event.defaultPrevented, true);
                    assert.equal(h.state.isNodeDragging, true); assert.equal(JSON.stringify({ nodes: h.state.nodes, connections: h.state.connections, selected: [...h.state.selected] }), before); assert.equal(h.state.history.past.length, 0);
                }
                assert.deepEqual(invoked, []); await up({ clientX: 460, clientY: 330 }); assert.equal(h.state.nodes.length, 4); assert.equal(h.state.history.past.length, 1);
                await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, originals);
            } finally { delete (globalThis as any).__dragShortcut; await h.close(); }
        });
        await test("复制过程中原图异步完成结果在一次undo后保留，redo只恢复副本及最后拖动位置", async () => {
            const a = { ...node("a"), metadata: { status: "loading" as const, prompt: "尚在执行" } }, h = await mount({ nodes: [a] });
            try {
                await down(h.title("a"), { clientX: 400, clientY: 300, altKey: true }); await move({ clientX: 440, clientY: 320, altKey: true });
                await act(async () => { h.state.updateOriginal("a", { status: "success", content: "data:image/png;base64,AQ==", naturalWidth: 512, naturalHeight: 512 }); await tick(); });
                const completed = structuredClone(h.state.nodes[0]); await up({ clientX: 460, clientY: 330 }); const final = structuredClone(h.state.nodes);
                assert.equal(final.length, 2); assert.equal(final[1].metadata?.status, "idle");
                await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, [completed]); assert.equal(h.state.nodes[0].metadata?.status, "success");
                await key("z", { ctrlKey: true, shiftKey: true }); assert.deepEqual(h.state.nodes, final); assert.deepEqual(h.state.nodes[0], completed);
            } finally { await h.close(); }
        });
        await test("普通drag不复制且晚按Alt不变复制；普通分组drag递归移动所有后代", async () => {
            const originals = [node("group", 0, 0, "group"), node("inner", 40, 60, "group", "group"), node("a", 60, 80, "image", "inner")];
            const h = await mount({ nodes: originals });
            try {
                await down(h.title("group"), { clientX: 400, clientY: 300 }); await move({ clientX: 430, clientY: 320, altKey: true }); await up({ clientX: 450, clientY: 330, altKey: true });
                assert.equal(h.state.nodes.length, 3); for (const [i, n] of h.state.nodes.entries()) assert.deepEqual(n.position, { x: originals[i].position.x + 50, y: originals[i].position.y + 30 });
                await act(async () => { await tick(210); }); assert.equal(h.state.history.past.length, 1);
                await key("z", { ctrlKey: true }); assert.deepEqual(h.state.nodes, originals);
            } finally { await h.close(); }
        });
        await test("Alt拖动在非零容器偏移/平移及极端缩放.05/.25/1/2/5均使用真实世界位移", async () => {
            for (const k of [.05, .25, 1, 2, 5]) {
                const a = node("a"), h = await mount({ nodes: [a], viewport: { x: -133, y: 87, k } });
                try {
                    await down(h.title("a"), { clientX: 500, clientY: 400, altKey: true }); await move({ clientX: 560, clientY: 430, altKey: true }); await up({ clientX: 570, clientY: 440 });
                    assert.equal(h.state.nodes.length, 2); assert.deepEqual(h.state.nodes[0], a); assert.deepEqual(h.state.nodes[1].position, { x: 20 + 70 / k, y: 40 + 40 / k }); assert.deepEqual(h.state.viewport, { x: -133, y: 87, k });
                } finally { await h.close(); }
            }
        });
        await test("Space+Alt优先画布平移；节点输入框与端口的Alt交互不启动复制", async () => {
            const table = { ...node("table", 100, 100, TABLE_TYPE), width: 700, height: 600, metadata: { table: emptyTable(), tableInputChannels: [{ id: "input-1" }, { id: "input-3" }] } }, h = await mount({ nodes: [table] });
            try {
                await key(" ", { code: "Space" }); await down(h.title("table"), { clientX: 500, clientY: 400, altKey: true }); await move({ clientX: 550, clientY: 430, altKey: true }); await up({ clientX: 550, clientY: 430, altKey: true }); await fire(window, new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: " ", code: "Space" }));
                assert.equal(h.state.nodes.length, 1); assert.deepEqual(h.state.nodes[0], table); assert.equal(h.state.viewport.x, 120); assert.equal(h.state.viewport.y, 0); assert.equal(h.state.history.past.length, 0);
                const input = h.find("table").querySelector<HTMLElement>("input,textarea,select")!; assert.ok(input);
                await down(input, { clientX: 500, clientY: 400, altKey: true }); await move({ clientX: 600, clientY: 450, altKey: true }); await up({ clientX: 600, clientY: 450 }); assert.equal(h.state.nodes.length, 1); assert.equal(h.state.isNodeDragging, false);
                const port = h.find("table").querySelector<HTMLElement>('[data-table-port="input-3"] span')!;
                await down(port, { clientX: 500, clientY: 400, altKey: true }); assert.deepEqual(h.state.connecting, { nodeId: "table", handleType: "target", portId: "input-3" }); assert.equal(h.state.isNodeDragging, false); assert.equal(h.state.nodes.length, 1);
            } finally { await h.close(); }
        });
        console.log(`Alt drag UI: ${passed}/${passed} passed (actual project AST handlers/effects + React DOM CanvasNode/InfiniteCanvas; no browser physical gesture, no API)`);
    } finally { globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
