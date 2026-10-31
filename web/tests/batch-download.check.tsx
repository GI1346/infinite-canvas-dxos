import assert from "node:assert/strict";
import fs from "node:fs";
import localforage from "localforage";
import { unzipSync } from "fflate";
import { collectDownloadImages, createCanvasImageZip } from "../src/lib/canvas/canvas-batch-download";
import { defaultConfig, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { useCallProtocolStore } from "../src/stores/use-call-protocol-store";
import type { CanvasNodeData, CanvasNodeImage, CanvasNodeMetadata } from "../src/types/canvas";

// Offline ZIP acceptance uses the real collection/naming/ZIP code. Only original-byte I/O is mocked.
const results: { name: string; passed: boolean; detail?: string }[] = [];
const originalFetch = globalThis.fetch;
const disk = new Map<string, Blob | Error | null>(), replies = new Map<string, Blob | Error | Response>();
const reads: string[] = [], fetches: string[] = [];
const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: "image/png" });
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 8, 7, 6])], { type: "image/jpeg" });
const webp = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 8, 7])], { type: "image/webp" });
const gif = new Blob([new Uint8Array([0x47, 0x49, 0x46, 0x38, 3, 2, 1])], { type: "image/gif" });
const node = (id: string, title = id, metadata: CanvasNodeMetadata = {}, type = "image"): CanvasNodeData => ({ id, type, title, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
const group = (id: string, groupId?: string) => node(id, id, groupId ? { groupId } : {}, "group");
const image = (id: string, status: CanvasNodeImage["status"], content = `blob:${id}`, storageKey?: string, mimeType = "image/png"): CanvasNodeImage => ({ id, status, content, ...(storageKey ? { storageKey } : {}), mimeType, naturalWidth: 512, naturalHeight: 512, bytes: 7 });
const protectedConfig: AiConfig = { ...defaultConfig, apiKey: "synthetic-global-unused", proxyEnabled: false, proxyUrl: "http://127.0.0.1:19999", imageModel: "image::same-model", textModel: "text::same-model", channels: [
    { ...defaultConfig.channels[0], id: "image", baseUrl: "https://image-relay.invalid", apiKey: "synthetic-image-key", imageTaskBaseUrl: "https://image-tasks.invalid", protocolId: "test-image", models: [{ name: "same-model", capability: "image", protocolId: "test-image" }] },
    { ...defaultConfig.channels[1], id: "text", baseUrl: "https://text-relay.invalid", apiKey: "synthetic-text-key", protocolId: "test-text", models: [{ name: "same-model", capability: "text" }] },
] };
const protocols = [{ format: "canvas-call/v1" as const, id: "test-image", label: "saved image", capability: "image" as const, script: 'throw new Error("download must not execute API protocol");' }, { format: "canvas-call/v1" as const, id: "test-text", label: "saved text", capability: "text" as const, script: 'throw new Error("download must not execute text protocol");' }];
const stateDb = localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
const protocolDb = localforage.createInstance({ name: "infinite-canvas", storeName: "call_protocols" });
const configKey = "infinite-canvas:ai_config_store", protocolKey = "canvas-call-protocols-v1";
await Promise.all([useConfigStore.persist.rehydrate(), useCallProtocolStore.persist.rehydrate()]);
useConfigStore.setState({ config: protectedConfig }); useCallProtocolStore.setState({ protocols });
await new Promise((resolve) => setTimeout(resolve, 5));
const savedConfig = JSON.stringify({ state: { config: protectedConfig }, version: 0 }), savedProtocol = JSON.stringify({ state: { protocols }, version: 0 });
localStorage.setItem(configKey, savedConfig); await stateDb.setItem(configKey, savedConfig); await protocolDb.setItem(protocolKey, savedProtocol);
const configSnapshot = JSON.stringify(useConfigStore.getState().config), protocolSnapshot = JSON.stringify(useCallProtocolStore.getState().protocols);
async function assertProtected() {
    assert.equal(JSON.stringify(useConfigStore.getState().config), configSnapshot, "download changed API channels/default model/proxy/key");
    assert.equal(JSON.stringify(useCallProtocolStore.getState().protocols), protocolSnapshot, "download changed custom protocol");
    assert.equal(localStorage.getItem(configKey), savedConfig); assert.equal(await stateDb.getItem(configKey), savedConfig); assert.equal(await protocolDb.getItem(protocolKey), savedProtocol);
}
function reset() {
    disk.clear(); replies.clear(); reads.length = 0; fetches.length = 0;
    (globalThis as any).__batchDownloadReadBlob = async (key: string) => { reads.push(key); const value = disk.get(key); if (value instanceof Error) throw value; return value ?? null; };
    globalThis.fetch = async (url) => { const address = String(url); fetches.push(address); const value = replies.get(address); if (value instanceof Error) throw value; if (value instanceof Response) return value; if (!value) throw new Error("Offline test refused unknown image URL"); return new Response(value, { status: 200, headers: { "Content-Type": value.type } }); };
}
async function check(name: string, work: () => unknown | Promise<unknown>) {
    reset();
    try { await work(); await assertProtected(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, detail: String(error) }); console.error(`FAIL ${name}\n${error instanceof Error ? error.stack : error}`); }
}
async function entries(blob: Blob | null) { assert.ok(blob); assert.equal(blob.type, "application/zip"); return unzipSync(new Uint8Array(await blob.arrayBuffer())); }
async function bytes(blob: Blob) { return new Uint8Array(await blob.arrayBuffer()); }

await check("recursive selected group plus descendants exports each image node once, never unrelated media", () => {
    const selected = new Set(["g", "nested", "a", "c", "g", "missing"]), nodes = [group("g"), node("a", "a", { groupId: "g", content: "blob:a" }), group("nested", "g"), group("deep", "nested"), node("b", "b", { groupId: "deep", content: "blob:b" }), node("c", "c", { content: "blob:c" }), node("else", "else", { content: "blob:else" }), node("text", "text", { groupId: "g", content: "not-an-image" }, "text"), node("video", "video", { groupId: "nested", content: "blob:video" }, "video")];
    const snapshot = JSON.stringify(nodes), ids = [...selected];
    assert.deepEqual(collectDownloadImages(selected, nodes).map((item) => item.nodeId), ["a", "b", "c"]); assert.deepEqual([...selected], ids); assert.equal(JSON.stringify(nodes), snapshot);
});
await check("cyclic nested groups terminate and still include reachable images only once", () => {
    const nodes = [group("g1", "g2"), group("g2", "g1"), node("a", "a", { groupId: "g2", content: "blob:a" }), node("b", "b", { groupId: "g1", content: "blob:b" })];
    assert.deepEqual(new Set(collectDownloadImages(["g1", "g2", "a"], nodes).map((item) => item.nodeId)), new Set(["a", "b"]));
});
await check("all successful multi-image items preserve original indices and primary is not duplicated", () => {
    const images = [image("first", "success", "blob:first", "image:first"), image("loading", "loading"), image("third", "success", "", "image:third", "image/jpeg"), image("error", "error"), image("idle", "idle")];
    const batch = node("batch", "重命名系列", { status: "success", primaryImageId: "first", storageKey: "image:first", content: "blob:first", images });
    const found = collectDownloadImages([batch.id], [batch]);
    assert.equal(found.length, 2); assert.deepEqual(found.map((item) => item.index), [1, 3]); assert.deepEqual(found.map((item) => item.title), ["重命名系列", "重命名系列"]); assert.deepEqual(found.map((item) => item.storageKey), ["image:first", "image:third"]);
});
await check("single visible image and storage-only content are eligible; loading/error batches export no primary fallback", () => {
    const values = [node("single", "visible", { content: "blob:visible" }), node("stored", "stored", { storageKey: "image:stored" }), node("pending", "pending", { content: "blob:preview", status: "loading", images: [image("pending", "loading")] }), node("failed", "failed", { content: "blob:preview", status: "error", images: [image("failed", "error")] }), node("empty"), group("empty-group")];
    assert.deepEqual(collectDownloadImages(values.map((value) => value.id), values).map((item) => item.nodeId), ["single", "stored"]);
});
await check("one generated image keeps the renamed filename in both single-node and multi-node ZIP exports", async () => {
    disk.set("image:single", png); disk.set("image:other", jpeg);
    const values = [node("one", "详情3.png", { content: "blob:expired", storageKey: "image:single", images: [image("only", "success", "blob:expired", "image:single")] }), node("two", "详情4", { images: [image("other", "success", "", "image:other")] })];
    const snapshot = JSON.stringify(values), found = collectDownloadImages(["one", "two"], values);
    assert.deepEqual(found.map(item => item.index), [undefined, undefined]);
    const single = await createCanvasImageZip(["one"], values); assert.deepEqual(Object.keys(await entries(single.blob)), ["详情3.png"]);
    const multi = await createCanvasImageZip(["one", "two"], values); assert.deepEqual(Object.keys(await entries(multi.blob)), ["详情3.png", "详情4.jpg"]);
    assert.equal(JSON.stringify(values), snapshot); assert.deepEqual((await entries(single.blob))["详情3.png"], await bytes(png));
});
await check("ZIP bytes use full original storage blob rather than preview URL, and actual MIME wins", async () => {
    disk.set("image:original", jpeg);
    const result = await createCanvasImageZip(["stored"], [node("stored", "重命名.png", { storageKey: "image:original", content: "blob:stale-preview", mimeType: "image/png" })]);
    assert.equal(result.count, 1); assert.equal(result.skipped, 0); assert.deepEqual(reads, ["image:original"]); assert.deepEqual(fetches, []);
    const archive = await entries(result.blob); assert.deepEqual(Object.keys(archive), ["重命名.jpg"]); assert.deepEqual(archive["重命名.jpg"], await bytes(jpeg));
});
await check("missing or failed stored blob falls back to its blob/data/remote content", async () => {
    disk.set("image:missing", null); disk.set("image:throw", new Error("offline synthetic storage failure"));
    replies.set("blob:present", png); replies.set("data:image/webp;base64,UklGRg==", webp); replies.set("https://image.invalid/original.gif", gif);
    const nodes = [node("a", "first", { storageKey: "image:missing", content: "blob:present" }), node("b", "second", { storageKey: "image:throw", content: "data:image/webp;base64,UklGRg==" }), node("c", "third", { content: "https://image.invalid/original.gif" })];
    const result = await createCanvasImageZip(nodes.map((n) => n.id), nodes), archive = await entries(result.blob);
    assert.equal(result.count, 3); assert.equal(result.skipped, 0); assert.deepEqual(reads, ["image:missing", "image:throw"]); assert.deepEqual(fetches, ["blob:present", "data:image/webp;base64,UklGRg==", "https://image.invalid/original.gif"]);
    assert.deepEqual(Object.keys(archive), ["first.png", "second.webp", "third.gif"]); assert.deepEqual(archive["first.png"], await bytes(png)); assert.deepEqual(archive["second.webp"], await bytes(webp)); assert.deepEqual(archive["third.gif"], await bytes(gif));
});
await check("same byte URL under separately renamed nodes remains two image downloads", async () => {
    replies.set("blob:shared", png);
    const result = await createCanvasImageZip(["a", "b", "a"], [node("a", "保留构图", { content: "blob:shared" }), node("b", "翻译英文", { content: "blob:shared" })]), archive = await entries(result.blob);
    assert.equal(result.count, 2); assert.equal(result.skipped, 0); assert.deepEqual(Object.keys(archive), ["保留构图.png", "翻译英文.png"]); assert.deepEqual(archive["保留构图.png"], archive["翻译英文.png"]);
});
await check("case-insensitive and sanitized name collisions cannot overwrite ZIP entries", async () => {
    const titles = ["Photo", "photo", "PHOTO-2", "photo", "A/B", "A:B", "CON", "NUL.txt", "..\\folder/../evil", "", "   "];
    const nodes = titles.map((title, i) => node(String(i), title, { content: `blob:${i}` })); for (const n of nodes) replies.set(n.metadata!.content!, png);
    const result = await createCanvasImageZip(nodes.map((n) => n.id), nodes), archive = await entries(result.blob), names = Object.keys(archive);
    assert.equal(result.count, titles.length); assert.equal(names.length, titles.length); assert.equal(new Set(names.map((name) => name.toLowerCase())).size, titles.length);
    assert.ok(names.includes("Photo.png")); assert.ok(names.includes("photo-2.png")); assert.ok(names.some((name) => name.toLowerCase().startsWith("photo-2-") || name.toLowerCase() === "photo-3.png"));
    for (const name of names) { assert.equal(/[\\/:*?"<>|\x00-\x1f]/.test(name), false, name); assert.equal(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name), false, name); assert.ok(archive[name].length > 0); }
});
await check("multi-image filenames use renamed title plus original image index and real original MIME", async () => {
    disk.set("image:a", jpeg); disk.set("image:c", webp);
    const nodes = [node("batch", "组-已改名.webp", { images: [image("a", "success", "", "image:a"), image("b", "error"), image("c", "success", "", "image:c")] })];
    const result = await createCanvasImageZip(["batch"], nodes), archive = await entries(result.blob);
    assert.equal(result.count, 2); assert.deepEqual(Object.keys(archive), ["组-已改名-1.jpg", "组-已改名-3.webp"]); assert.deepEqual(archive["组-已改名-1.jpg"], await bytes(jpeg)); assert.deepEqual(archive["组-已改名-3.webp"], await bytes(webp));
});
await check("partial read failures keep successful ZIP entries and report only real failed candidates", async () => {
    disk.set("image:ok", png); disk.set("image:lost", null); replies.set("https://image.invalid/403.png", new Response("denied", { status: 403 })); replies.set("blob:broken", new Error("offline network failure"));
    const values = [node("ok", "good", { storageKey: "image:ok" }), node("lost", "lost", { storageKey: "image:lost" }), node("http", "http", { content: "https://image.invalid/403.png" }), node("broken", "broken", { content: "blob:broken" })];
    const result = await createCanvasImageZip(values.map((n) => n.id), values); assert.equal(result.count, 1); assert.equal(result.skipped, 3); const archive = await entries(result.blob); assert.deepEqual(Object.keys(archive), ["good.png"]); assert.deepEqual(archive["good.png"], await bytes(png));
});
await check("all missing/read-failed candidates return no empty ZIP; empty selection makes no reads", async () => {
    const failed = [node("lost", "lost", { storageKey: "image:lost" }), node("broken", "broken", { content: "blob:broken" })];
    const result = await createCanvasImageZip(["lost", "broken"], failed); assert.equal(result.count, 0); assert.equal(result.skipped, 2); assert.equal(result.blob, null);
    reads.length = 0; fetches.length = 0; const empty = await createCanvasImageZip([], failed); assert.equal(empty.blob, null); assert.equal(empty.count, 0); assert.equal(empty.skipped, 0); assert.deepEqual(reads, []); assert.deepEqual(fetches, []);
});
await check("successful-but-empty image slots are reported skipped without aborting valid sibling outputs", async () => {
    disk.set("image:valid", png);
    const values = [node("empty-success", "missing original", { status: "success" }), node("batch", "partial batch", { images: [image("missing", "success", ""), image("valid", "success", "", "image:valid"), image("running", "loading", "blob:running")] })];
    assert.equal(collectDownloadImages(values.map((n) => n.id), values).length, 3);
    const result = await createCanvasImageZip(values.map((n) => n.id), values); assert.equal(result.count, 1); assert.equal(result.skipped, 2);
    assert.deepEqual(Object.keys(await entries(result.blob)), ["partial batch-2.png"]); assert.deepEqual(reads, ["image:valid"]); assert.deepEqual(fetches, []);
});
await check("empty blobs and successful HTTP error documents are skipped instead of disguised as image files", async () => {
    replies.set("https://image.invalid/html.png", new Blob(["<html>not an image</html>"], { type: "text/html" }));
    replies.set("https://image.invalid/json.png", new Blob(['{"error":"not image"}'], { type: "application/json" }));
    replies.set("blob:zero", new Blob([], { type: "image/png" })); replies.set("blob:valid", jpeg);
    const values = [node("html", "html", { content: "https://image.invalid/html.png", mimeType: "image/png" }), node("json", "json", { content: "https://image.invalid/json.png" }), node("zero", "zero", { content: "blob:zero" }), node("ok", "valid", { content: "blob:valid" })];
    const result = await createCanvasImageZip(values.map((n) => n.id), values); assert.equal(result.count, 1); assert.equal(result.skipped, 3); const archive = await entries(result.blob); assert.deepEqual(Object.keys(archive), ["valid.jpg"]); assert.deepEqual(archive["valid.jpg"], await bytes(jpeg));
});
await check("octet-stream or unspecified original MIME keeps bytes and derives explicit image metadata/URL extension", async () => {
    const octet = new Blob([new Uint8Array([1, 5, 9, 13])], { type: "application/octet-stream" }), unknown = new Blob([new Uint8Array([2, 4, 6])]);
    disk.set("image:octet", octet); disk.set("image:unknown", unknown);
    const values = [node("octet", "retained-name.png", { storageKey: "image:octet", mimeType: "image/webp" }), node("unknown", "来自节点的名称", { storageKey: "image:unknown", content: "https://image.invalid/path.jpeg?signature=synthetic", mimeType: undefined })];
    const result = await createCanvasImageZip(values.map((n) => n.id), values), archive = await entries(result.blob);
    assert.equal(result.count, 2); assert.equal(result.skipped, 0); assert.deepEqual(Object.keys(archive), ["retained-name.webp", "来自节点的名称.jpg"]); assert.deepEqual(archive["retained-name.webp"], await bytes(octet)); assert.deepEqual(archive["来自节点的名称.jpg"], await bytes(unknown)); assert.deepEqual(fetches, []);
});
await check("successful output ZIP contains image files only, not source metadata/credentials/history", async () => {
    disk.set("image:png", png); const start = node("a", "image-only", { storageKey: "image:png", model: "image::same-model", prompt: "private synthetic prompt", references: ["blob:reference"] }); const snapshot = JSON.stringify(start);
    const result = await createCanvasImageZip(["a"], [start]), archive = await entries(result.blob); assert.equal(JSON.stringify(start), snapshot); assert.deepEqual(Object.keys(archive), ["image-only.png"]); assert.deepEqual(archive["image-only.png"], await bytes(png));
});

globalThis.fetch = originalFetch; delete (globalThis as any).__batchDownloadReadBlob;
fs.mkdirSync(".checks", { recursive: true }); fs.writeFileSync(".checks/batch-download-results.json", JSON.stringify(results, null, 2));
console.log(`${results.filter((entry) => entry.passed).length}/${results.length} batch image ZIP checks passed`);
if (results.some((entry) => !entry.passed)) process.exitCode = 1;
