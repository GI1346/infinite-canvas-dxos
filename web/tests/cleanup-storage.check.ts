import assert from "node:assert/strict";
import localforage from "localforage";
import { unzipSync, strToU8, zipSync } from "fflate";
import { prepareCleanup, restoreCleanupBackup } from "../src/services/canvas-cleanup";
import { useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { useAssetStore } from "../src/stores/use-asset-store";

async function main() {
    const db = (storeName: string) => localforage.createInstance({ name: "infinite-canvas", storeName });
    await Promise.all([useCanvasStore.persist.rehydrate(), useAssetStore.persist.rehydrate()]);
    const project = (id: string, storageKey: string): CanvasProject => ({ id, title: id, createdAt: "now", updatedAt: "now", nodes: [{ id: "img", type: "image", title: "image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { storageKey, content: "blob:test", model: "relay::image", prompt: "translate" } }], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } });
    const projects = [project("current", "image:remove"), project("other", "image:shared")];
    useCanvasStore.setState({ hydrated: true, projects });
    useAssetStore.setState({ hydrated: true, assets: [] });
    const imageStore = db("image_files"), previewStore = db("image_previews"), logs = db("image_generation_logs"), state = db("app_state"), protocols = db("call_protocols");
    await state.setItem("infinite-canvas:config", JSON.stringify({ baseUrl: "https://relay.invalid", apiKey: "test-not-a-secret" }));
    await protocols.setItem("canvas-call-protocols-v1", { state: { protocols: [{ id: "custom", script: "return []" }] } });
    const protectedBefore = [await state.getItem("infinite-canvas:config"), await protocols.getItem("canvas-call-protocols-v1")];
    for (const key of ["image:remove", "image:shared", "image:history"]) {
        await imageStore.setItem(key, new Blob([key], { type: "image/png" }));
        await previewStore.setItem(key, { version: 1, blob: new Blob(["preview"], { type: "image/webp" }) });
    }
    await logs.setItem("history", { references: [{ storageKey: "image:history" }], images: [] });
    const options = { images: true, history: true, logs: false, assets: false, allProjects: false };
    const plan = await prepareCleanup("current", options);
    assert.equal(plan.imageCount, 1);
    const entries = unzipSync(new Uint8Array(await plan.backup.arrayBuffer()));
    assert(entries["manifest.json"]);
    assert(Object.keys(entries).some((name) => name.startsWith("blobs/")));
    await plan.apply();
    const saved = JSON.parse((await state.getItem<string>("infinite-canvas:canvas_store"))!);
    assert.equal(saved.state.projects[0].nodes[0].metadata.content, undefined);
    assert.equal(saved.state.projects[0].nodes[0].metadata.model, "relay::image");
    assert.equal(saved.state.projects[1].nodes[0].metadata.storageKey, "image:shared");
    assert.equal(await imageStore.getItem("image:remove"), null);
    assert(await imageStore.getItem("image:shared"));
    assert(await imageStore.getItem("image:history"));
    assert.equal(await previewStore.getItem("image:remove"), null);
    useCanvasStore.setState({ projects: saved.state.projects });
    await restoreCleanupBackup(new File([plan.backup], "cleanup.zip"));
    const restored = JSON.parse((await state.getItem<string>("infinite-canvas:canvas_store"))!);
    assert.equal(restored.state.projects.find((p: CanvasProject) => p.id === "current").nodes[0].metadata.storageKey, "image:remove");
    assert.equal(await (await imageStore.getItem<Blob>("image:remove"))!.text(), "image:remove");
    const preview = await previewStore.getItem<{ blob: Blob }>("image:remove");
    assert.equal(await preview!.blob.text(), "preview");
    assert.deepEqual([await state.getItem("infinite-canvas:config"), await protocols.getItem("canvas-call-protocols-v1")], protectedBefore);
    const invalid = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "canvas-cleanup/v1", projects: [], assets: [], records: [{ store: "call_protocols", key: "canvas-call-protocols-v1", value: "tampered" }] })) });
    await assert.rejects(restoreCleanupBackup(new File([invalid], "bad.zip")), /不允许/);
    const all = await prepareCleanup("current", { ...options, allProjects: true, logs: true });
    await all.apply();
    assert.equal(await imageStore.length(), 0);
    assert.equal(await logs.length(), 0);
    await restoreCleanupBackup(new File([all.backup], "all.zip"));
    assert.equal(await logs.length(), 1);
    assert.equal(await imageStore.length(), 3);
    assert.deepEqual([await state.getItem("infinite-canvas:config"), await protocols.getItem("canvas-call-protocols-v1")], protectedBefore);
    console.log("PASS: IndexedDB 清理事务 / ZIP 图片及缩略图恢复 / 当前与全部画布 / 共享及历史引用保护 / 日志恢复 / API 与协议字节不变 / 恶意配置写入被阻止");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
