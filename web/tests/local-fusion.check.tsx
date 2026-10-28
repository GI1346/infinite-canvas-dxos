import assert from "node:assert/strict";
import { mock } from "bun:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanvasConnection, CanvasCropContext, CanvasNodeData } from "../src/types/canvas";
import type { CanvasAgentOp } from "../src/lib/canvas/canvas-agent-ops";
import type { CanvasPluginHost } from "../src/types/canvas-plugin";

type Bitmap = { width: number; height: number; pixels: number[] };
const blobs = new Map<string, Blob>();
const uploaded: Bitmap[] = [];
const blobOf = (value: Bitmap) => new Blob([JSON.stringify(value)], { type: "image/png" });
const decode = async (value: Blob) => JSON.parse(await value.text()) as Bitmap;
const fixture = (width: number, height: number, color = [25, 50, 75, 255]): Bitmap => ({ width, height, pixels: Array.from({ length: width * height }, () => color).flat() });
let pauseUpload: Promise<void> | null = null;
let uploadEntered: (() => void) | null = null;
mock.module("../src/services/image-storage", () => ({
    getImageBlob: async (key: string) => blobs.get(key) || null,
    fetchImageBlob: async (url: string) => { const stored = blobs.get(url); if (stored) return stored; if (url.startsWith("data:")) return new Blob([Buffer.from(url.split(",")[1], "base64")], { type: "image/png" }); throw new Error(`Unexpected image URL: ${url}`); },
    uploadImage: async (value: Blob) => { const image = await decode(value); uploaded.push(image); uploadEntered?.(); if (pauseUpload) await pauseUpload; const key = `image:output-${uploaded.length}`; blobs.set(key, value); return { url: `blob:${key}`, storageKey: key, width: image.width, height: image.height, bytes: value.size, mimeType: "image/png" }; },
}));
globalThis.fetch = async () => { throw new Error("No network calls allowed in local-fusion tests"); };
let bitmapsClosed = 0;
globalThis.createImageBitmap = (async (blob: Blob) => ({ ...await decode(blob), close: () => { bitmapsClosed++; } })) as typeof createImageBitmap;
class Reader {
    result: string | null = null; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((buffer) => { this.result = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`; this.onload?.(); }, () => this.onerror?.()); }
}
Object.defineProperty(globalThis, "FileReader", { value: Reader, configurable: true });

class Raster {
    width = 0; height = 0;
    private pixels = new Uint8ClampedArray();
    private raster() { if (this.pixels.length !== this.width * this.height * 4) this.pixels = new Uint8ClampedArray(this.width * this.height * 4); return this.pixels; }
    private context: any;
    getContext() {
        if (this.context) return this.context;
        const canvas = this;
        this.context = {
            globalCompositeOperation: "source-over", fillStyle: "white", filter: "none",
            createImageData(width: number, height: number) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
            getImageData(x: number, y: number, width: number, height: number) { const data = new Uint8ClampedArray(width * height * 4), original = canvas.raster(); for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) for (let channel = 0; channel < 4; channel++) data[(py * width + px) * 4 + channel] = original[((y + py) * canvas.width + x + px) * 4 + channel] || 0; return { width, height, data }; },
            putImageData(value: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) { const target = canvas.raster(); for (let py = 0; py < value.height; py++) for (let px = 0; px < value.width; px++) for (let channel = 0; channel < 4; channel++) target[((y + py) * canvas.width + x + px) * 4 + channel] = value.data[(py * value.width + px) * 4 + channel]; },
            fillRect(x: number, y: number, width: number, height: number) { const data = canvas.raster(); for (let py = Math.max(0, y); py < Math.min(canvas.height, y + height); py++) for (let px = Math.max(0, x); px < Math.min(canvas.width, x + width); px++) for (let channel = 0; channel < 4; channel++) data[(py * canvas.width + px) * 4 + channel] = 255; },
            drawImage(source: Bitmap | Raster, ...args: number[]) {
                const image = source instanceof Raster ? { width: source.width, height: source.height, pixels: source.raster() } : source;
                const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 2 ? [0, 0, image.width, image.height, args[0], args[1], image.width, image.height] : args.length === 4 ? [0, 0, image.width, image.height, ...args] : args;
                const target = canvas.raster();
                for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
                    const tx = dx + x, ty = dy + y; if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
                    const a = ((sy + Math.floor(y / dh * sh)) * image.width + sx + Math.floor(x / dw * sw)) * 4, b = (ty * canvas.width + tx) * 4, opacity = image.pixels[a + 3] / 255;
                    if (this.globalCompositeOperation === "destination-in") { target[b + 3] *= opacity; continue; }
                    const oldOpacity = target[b + 3] / 255, outOpacity = opacity + oldOpacity * (1 - opacity);
                    for (let channel = 0; channel < 3; channel++) target[b + channel] = outOpacity ? (image.pixels[a + channel] * opacity + target[b + channel] * oldOpacity * (1 - opacity)) / outOpacity : 0;
                    target[b + 3] = outOpacity * 255;
                }
            },
        }; return this.context;
    }
    toBlob(done: (blob: Blob | null) => void) { done(blobOf({ width: this.width, height: this.height, pixels: [...this.raster()] })); }
}
const originalCreateElement = document.createElement.bind(document);
(document as any).createElement = (tag: string, ...rest: any[]) => tag === "canvas" ? new Raster() : originalCreateElement(tag, ...rest);
const { extractImageSelection, selectionRect, paddedSelection, resolveCropContext, imageOutputCropContext, resolveFusionCropContext, fuseImageNodes, fusionInputs } = await import("../src/lib/canvas/canvas-local-fusion");
const { runLocalFusionNode, isLocalFusionRunning } = await import("../src/lib/canvas/canvas-local-fusion-run");
const { LocalFusionContent } = await import("../src/components/canvas/nodes/local-fusion-node");
const { buildNodeContext } = await import("../src/lib/canvas/plugin-node-context");
const { canvasThemes } = await import("../src/lib/canvas-theme");
const { LOCAL_FUSION_NODE_TYPE, FUSION_PATCH_PORT, fusionTargetAnchor, fusionConnectionPort } = await import("../src/lib/canvas/canvas-fusion-ports");
const { normalizeConnection, getConnectionTargetAnchor } = await import("../src/lib/canvas/canvas-node-geometry");
const { connectionCurve } = await import("../src/lib/canvas/canvas-connection-geometry");
const { ActiveConnectionPath } = await import("../src/components/canvas/canvas-connections");
const node = (id: string, cropContext?: CanvasCropContext, type = "image"): CanvasNodeData => ({ id, type, title: id, position: { x: 100, y: 100 }, width: 460, height: 380, metadata: { content: `blob:${id}`, storageKey: `image:${id}`, ...(cropContext ? { cropContext } : {}) } });
const edge = (fromNodeId: string, toNodeId: string, toPort?: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}-${toPort || ""}`, fromNodeId, toNodeId, ...(toPort ? { toPort } : {}) });
const pixel = (image: Bitmap, x: number, y: number) => image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4);
let passes = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); console.log(`PASS ${++passes}: ${name}`); }
const original = node("original", { full: true }); blobs.set("image:original", blobOf(fixture(40, 30)));
let context: Exclude<CanvasCropContext, { full: true } | { conflict: true }>;
async function main() {
    await check("selection validation, ratio contraction and edge expansion retain complete selected area", () => {
        assert.throws(() => selectionRect({ x: 0, y: 0, width: 0, height: 1 }, 100, 100), /无效/);
        assert.throws(() => selectionRect({ x: NaN, y: 0, width: 1, height: 1 }, 100, 100), /无效/);
        assert.deepEqual(selectionRect({ x: 10, y: 10, width: 40, height: 20 }, 100, 100, "1:1"), { x: 20, y: 10, width: 20, height: 20 });
        for (let i = 0; i < 1500; i++) {
            const width = 20 + i % 41, height = 20 + i % 37, rect = selectionRect({ x: (i * 13) % width, y: (i * 17) % height, width: 1 + i % 30, height: 1 + i % 23 }, width, height), padded = paddedSelection(rect, width, height);
            assert(padded.x >= 0 && padded.y >= 0 && padded.x + padded.width <= width && padded.y + padded.height <= height);
            assert(padded.x <= rect.x && padded.y <= rect.y && padded.x + padded.width >= rect.x + rect.width && padded.y + padded.height >= rect.y + rect.height);
        }
        assert.equal(selectionRect({ x: 0, y: 0, width: 20000, height: 20000 }, 20000, 20000).width, 20000);
    });
    await check("extract copies padded source pixels, preserves original and hashes durable source identity", async () => {
        const result = await extractImageSelection(original, { x: 10, y: 10, width: 10, height: 10 }, "1:1"); context = result.context;
        assert.deepEqual(context.rect, { x: 10, y: 10, width: 10, height: 10 }); assert.deepEqual(context.paddedRect, { x: 9, y: 9, width: 12, height: 12 });
        const output = JSON.parse(Buffer.from(result.dataUrl.split(",")[1], "base64").toString()) as Bitmap;
        assert.equal(output.width, 12); assert.deepEqual(pixel(output, 0, 0), [25, 50, 75, 255]); assert.match(context.sourceIdentity, /^[a-f0-9]{64}$/);
        assert.equal((await decode(blobs.get("image:original")!)).width, 40); assert(!JSON.stringify(context).includes("base64"));
    });
    const local = node("local", context), edit = node("edit"), same = node("same", structuredClone(context)), cropped = node("crop", { full: true }), other = node("other", { ...context, rect: { ...context.rect, x: 11 } });
    const graph = [original, local, edit, same, cropped, other], edges = [edge("local", "edit"), edge("edit", "local"), edge("other", "crop")];
    await check("context BFS handles cycles, local boundaries, full-image boundaries, same-region dedup and conflict", () => {
        assert.equal(resolveCropContext("edit", graph, edges).kind, "local"); assert.equal(resolveCropContext("crop", graph, edges).kind, "none");
        assert.equal(resolveCropContext("edit", graph, [...edges, edge("same", "edit")]).kind, "local");
        assert.equal(resolveCropContext("edit", graph, [...edges, edge("other", "edit")]).kind, "conflict");
        assert.equal(resolveCropContext("error", [...graph, node("error", { conflict: true })], []).kind, "conflict");
    });
    await check("actual-reference materialization prevents cross-row context mixing and survives JSON persistence", () => {
        const all = [...graph, node("table", undefined, "dxos:table")]; const connected = [...edges, edge("local", "table"), edge("other", "table")];
        assert.deepEqual(imageOutputCropContext([{ nodeId: "local" }], all, connected), context);
        assert.deepEqual(imageOutputCropContext([{ storageKey: "image:local" }], all, connected), context);
        assert.deepEqual(imageOutputCropContext([{ id: "local" }, { id: "same" }], all, connected), context);
        assert.deepEqual(imageOutputCropContext([{ id: "local" }, { id: "other" }], all, connected), { conflict: true });
        assert.deepEqual(imageOutputCropContext([{ id: "crop" }], all, connected), { full: true });
        const saved = JSON.parse(JSON.stringify(node("saved", imageOutputCropContext([{ id: "edit" }], all, connected))));
        assert.equal(resolveCropContext("saved", [saved], []).kind, "local");
        const batch = node("batch", context); batch.metadata!.images = [{ id: "item", status: "success", content: "blob:item", storageKey: "image:item", naturalWidth: 12, naturalHeight: 12, bytes: 1, mimeType: "image/png" }];
        assert.deepEqual(imageOutputCropContext([{ nodeId: "batch:item" }], [batch], []), context);
    });
    await check("editing local target preserves destination despite additional local references; full-image boundary stays full", () => {
        const foreign = node("foreign", { ...context, sourceNodeId: "different-original", sourceIdentity: "different-hash", sourceStorageKey: "image:different" });
        assert.deepEqual(imageOutputCropContext([{ id: "local" }, { id: "foreign" }], [...graph, foreign], [], local), context);
        assert.deepEqual(imageOutputCropContext([{ id: "local" }], graph, [], cropped), { full: true });
        const result = node("ambiguous", { conflict: true }); result.metadata!.references = ["image:local", "image:foreign"];
        const saved = JSON.parse(JSON.stringify([...graph, foreign, result]));
        assert.deepEqual(resolveFusionCropContext(result.id, original, saved, []), { kind: "local", context });
        result.metadata!.references!.push("image:other");
        assert.equal(resolveFusionCropContext(result.id, original, [...graph, foreign, result], []).kind, "conflict", "two regions of same original must never be guessed");
        assert.equal(resolveFusionCropContext("crop", original, graph, [edge("local", "crop")]).kind, "none");
    });
    const fusion = node("fusion", undefined, LOCAL_FUSION_NODE_TYPE);
    await check("fusion original/patch inputs, reverse-start direction and fixed/preview curve anchors agree", () => {
        const h = { nodeId: "original", handleType: "source" as const };
        assert.deepEqual(fusionTargetAnchor(fusion, FUSION_PATCH_PORT), { x: 560, y: 140 }); assert.equal(fusionConnectionPort(fusion, h, { x: 560, y: 140 }, null), "patch");
        assert.equal(fusionConnectionPort(fusion, h, { x: 100, y: 290 }, null), undefined);
        const handle = document.createElement("div"); handle.dataset.nodeId = "fusion"; const point = document.createElement("span"); point.dataset.fusionPort = "patch"; handle.append(point);
        assert.equal(fusionConnectionPort(fusion, h, { x: 100, y: 290 }, point), "patch");
        assert.deepEqual(normalizeConnection("fusion", "local", [fusion, local], "target"), { fromNodeId: "local", toNodeId: "fusion" });
        assert.deepEqual(getConnectionTargetAnchor(fusion, h, { x: 560, y: 140 }), { x: 560, y: 140 });
        const curve = connectionCurve(edge("local", "fusion", "patch"), local, fusion); assert.deepEqual(curve[3], { x: 560, y: 140 }); assert(curve[2].x > curve[3].x);
        const svg = renderToStaticMarkup(<ActiveConnectionPath node={local} handle={h} mouseWorld={{ x: 560, y: 140 }} target={fusion} />); assert(svg.includes("560 140"));
        const reverse = renderToStaticMarkup(<ActiveConnectionPath node={fusion} handle={{ nodeId: "fusion", handleType: "target", portId: "patch" }} mouseWorld={{ x: 50, y: 50 }} />); assert(reverse.includes("560 140"));
        const inputs = fusionInputs("fusion", [original, local, fusion], [edge("original", "fusion"), edge("local", "fusion", "patch")]); assert.equal(inputs.originals[0].id, "original"); assert.equal(inputs.patches[0].id, "local");
    });
    blobs.set("image:local", blobOf(fixture(12, 12, [200, 20, 30, 255])));
    await check("fusion retains full dimensions, exact outside pixels and replaced inner pixels without mutating original", async () => {
        const result = await fuseImageNodes(original, [local], [original, local], [], false), output = await decode(blobs.get(result.storageKey!)!);
        assert.equal(output.width, 40); assert.equal(output.height, 30); assert.deepEqual(pixel(output, 0, 0), [25, 50, 75, 255]); assert.deepEqual(pixel(output, 10, 10), [200, 20, 30, 255]);
        for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) if (x < 9 || x >= 21 || y < 9 || y >= 21) assert.deepEqual(pixel(output, x, y), [25, 50, 75, 255]);
        assert.deepEqual(pixel(await decode(blobs.get("image:original")!), 10, 10), [25, 50, 75, 255]);
    });
    await check("saved ambiguous edit with another product reference recovers its region and fuses without changing original", async () => {
        const foreign = node("foreign-reference", { ...context, sourceNodeId: "other-original", sourceStorageKey: "image:other-original", sourceIdentity: "other-identity" });
        const edited = node("saved-edit", { conflict: true });
        edited.metadata!.references = ["image:local", "image:foreign-reference"];
        blobs.set("image:saved-edit", blobOf(fixture(12, 12, [100, 120, 140, 255])));
        const nodes = JSON.parse(JSON.stringify([original, local, foreign, edited]));
        const result = await fuseImageNodes(original, [edited], nodes, [], false), output = await decode(blobs.get(result.storageKey!)!);
        assert.deepEqual(pixel(output, 10, 10), [100, 120, 140, 255]);
        for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) if (x < 9 || x >= 21 || y < 9 || y >= 21) assert.deepEqual(pixel(output, x, y), [25, 50, 75, 255]);
        assert.deepEqual(pixel(await decode(blobs.get("image:original")!), 10, 10), [25, 50, 75, 255]);
    });
    await check("fusion color matching is optional and channel correction is bounded", async () => {
        const result = await fuseImageNodes(original, [local], [original, local], [], true), output = await decode(blobs.get(result.storageKey!)!);
        assert.deepEqual(pixel(output, 10, 10), [176, 44, 54, 255]);
    });
    await check("mismatched identity/geometry/ratio or missing/conflicting context reject with zero partial uploads", async () => {
        const before = uploaded.length;
        await assert.rejects(fuseImageNodes(original, [], [original], []), /至少一张/);
        await assert.rejects(fuseImageNodes(original, [node("missing")], [original, node("missing")], []), /没有选区上下文/);
        for (const bad of [{ ...context, sourceIdentity: "different" }, { ...context, sourceWidth: 41 }, { ...context, paddedRect: { ...context.paddedRect, width: 0 } }]) {
            const invalid = node("invalid", bad); await assert.rejects(fuseImageNodes(original, [invalid], [original, invalid], []), /不属于|损坏/);
        }
        const wrong = node("wrong", context); blobs.set("image:wrong", blobOf(fixture(12, 6))); await assert.rejects(fuseImageNodes(original, [local, wrong], [original, local, wrong], []), /比例.*12×12.*12×6/);
        const conflict = node("conflict", { conflict: true }); await assert.rejects(fuseImageNodes(original, [conflict], [original, conflict], []), /多个不同选区/);
        assert.equal(uploaded.length, before);
    });
    function runtime(id = "runtime") {
        const f = { ...fusion, id }; let snapshot = { projectId: id, nodes: [original, local, f], connections: [edge("original", id), edge("local", id, "patch")] }; const calls: CanvasAgentOp[][] = [];
        return { getSnapshot: () => snapshot, set: (value: typeof snapshot) => { snapshot = value; }, calls, applyOps: (ops: CanvasAgentOp[]) => {
            calls.push(ops);
            for (const op of ops) {
                if (op.type === "add_node") snapshot.nodes.push({ id: op.id!, type: op.nodeType!, title: op.title!, position: op.position!, width: op.width!, height: op.height!, metadata: op.metadata });
                if (op.type === "update_node") snapshot.nodes = snapshot.nodes.map((entry) => entry.id === op.id ? { ...entry, metadata: { ...entry.metadata, ...op.metadata } } : entry);
                if (op.type === "connect_nodes") snapshot.connections.push(edge(op.fromNodeId, op.toNodeId, op.toPort));
            }
        } };
    }
    await check("awaitable shared run creates output, edge, latest fusion resource and selection in one apply", async () => {
        const r = runtime(); const result = await runLocalFusionNode("runtime", r.getSnapshot, r.applyOps);
        assert.equal(result.type, "image"); assert.deepEqual(result.metadata?.cropContext, { full: true }); assert.equal(r.calls.length, 1); assert.deepEqual(r.calls[0].map((op) => op.type), ["add_node", "connect_nodes", "update_node", "select_nodes"]);
        assert(r.getSnapshot().connections.some((connection) => connection.fromNodeId === "runtime" && connection.toNodeId === result.id));
        const previousY = result.position.y, next = await runLocalFusionNode("runtime", r.getSnapshot, r.applyOps); assert(next.position.y > previousY);
    });
    await check("simultaneous UI/Agent run rejects duplicate; released lock permits retry", async () => {
        const r = runtime("dupe"); let release!: () => void; pauseUpload = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { uploadEntered = resolve; });
        const first = runLocalFusionNode("dupe", r.getSnapshot, r.applyOps); await started;
        assert.equal(isLocalFusionRunning(), true, "cleanup must see the shared in-flight lock");
        await assert.rejects(runLocalFusionNode("dupe", r.getSnapshot, r.applyOps), /正在运行/); release(); pauseUpload = null; uploadEntered = null; await first; assert.equal(r.calls.length, 1);
        assert.equal(isLocalFusionRunning(), false);
        await runLocalFusionNode("dupe", r.getSnapshot, r.applyOps); assert.equal(r.calls.length, 2);
        assert.equal(isLocalFusionRunning(), false);
    });
    await check("rewire, upstream context mutation, deletion, project switch and abort never import obsolete output", async () => {
        for (const mutation of ["rewire", "context", "delete", "project", "abort", "unmount"]) {
            const r = runtime(`stale-${mutation}`), signal = new AbortController(); let alive = true, release!: () => void; pauseUpload = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { uploadEntered = resolve; });
            const result = runLocalFusionNode(`stale-${mutation}`, r.getSnapshot, r.applyOps, { signal: signal.signal, isCurrent: () => alive }); await started;
            const snap = r.getSnapshot();
            if (mutation === "rewire") r.set({ ...snap, connections: snap.connections.filter((connection) => connection.toPort !== "patch") });
            if (mutation === "context") r.set({ ...snap, nodes: snap.nodes.map((entry) => entry.id === "local" ? { ...entry, metadata: { ...entry.metadata, cropContext: { ...context, rect: { ...context.rect, x: context.rect.x + 1 } } } } : entry) });
            if (mutation === "delete") r.set({ ...snap, nodes: snap.nodes.filter((entry) => entry.type !== LOCAL_FUSION_NODE_TYPE) });
            if (mutation === "project") r.set({ ...snap, projectId: "switched" }); if (mutation === "abort") signal.abort(); if (mutation === "unmount") alive = false;
            release(); pauseUpload = null; uploadEntered = null; await assert.rejects(result, /发生变化|已停止/); assert.equal(r.calls.length, 0, mutation);
            assert.equal(isLocalFusionRunning(), false, `${mutation} must release the cleanup guard`);
        }
        await assert.rejects(runLocalFusionNode("missing", () => ({ nodes: [], connections: [] }), () => undefined), /不存在/);
        const stopped = new AbortController(); stopped.abort(); await assert.rejects(runLocalFusionNode("missing", () => ({ nodes: [], connections: [] }), () => undefined, { signal: stopped.signal }), /已停止/);
        assert(bitmapsClosed > 0);
    });
    await check("same-mounted fusion UI rejects identical graph from another project; shared busy gate clears and permits retry", async () => {
        const r = runtime("ui-switch"); let projectId = "ui-project-a", release!: () => void;
        const pluginHost: CanvasPluginHost = {
            getProjectId: () => projectId,
            getNode: (id) => r.getSnapshot().nodes.find((item) => item.id === id) || null,
            getNodes: () => r.getSnapshot().nodes, getConnections: () => r.getSnapshot().connections,
            getUpstream: () => [], getDownstream: () => [], updateNode: () => {}, updateMetadata: () => {}, applyOps: r.applyOps,
            ai: { generateImage: async () => { throw new Error("Local fusion must not call AI"); }, generateVideo: async () => { throw new Error("Local fusion must not call AI"); }, generateText: async () => { throw new Error("Local fusion must not call AI"); }, listModels: () => [], defaultModel: () => "" },
            openPanel: () => {}, closePanel: () => {},
        };
        const ctx = buildNodeContext(pluginHost, r.getSnapshot().nodes.find((item) => item.id === "ui-switch")!, canvasThemes.light, 1);
        const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
        const settle = async () => { for (let i = 0; i < 50; i++) { await new Promise((resolve) => setTimeout(resolve, 1)); if (!isLocalFusionRunning()) return; } throw new Error("Fusion did not settle"); };
        try {
            await act(async () => { root.render(<LocalFusionContent ctx={ctx} />); });
            pauseUpload = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { uploadEntered = resolve; });
            await act(async () => { host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); await started; });
            assert.equal(isLocalFusionRunning(), true);
            projectId = "ui-project-b";
            r.set({ ...r.getSnapshot(), projectId, nodes: structuredClone(r.getSnapshot().nodes), connections: structuredClone(r.getSnapshot().connections) });
            assert.equal(ctx.getProjectId?.(), projectId, "node context must forward the live host identity");
            await act(async () => { root.render(<LocalFusionContent ctx={buildNodeContext(pluginHost, r.getSnapshot().nodes.find((item) => item.id === "ui-switch")!, canvasThemes.light, 1)} />); });
            await act(async () => { release(); pauseUpload = null; uploadEntered = null; await settle(); });
            assert.equal(r.calls.length, 0, "old UI operation must not write into the identical graph in project B");
            assert.match(host.querySelector('[role="alert"]')?.textContent || "", /已停止/);
            assert.equal(isLocalFusionRunning(), false);
            await act(async () => { host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); await settle(); });
            assert.equal(r.calls.length, 1, "stale-operation cleanup must allow an intentional run in project B");
            assert.equal(isLocalFusionRunning(), false);
        } finally { pauseUpload = null; uploadEntered = null; release?.(); await act(async () => { root.unmount(); }); host.remove(); }
    });
    console.log(`PASS local fusion offline suites: ${passes} checks; no paid APIs or real credentials.`);
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
