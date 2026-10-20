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
    const imageStore = db("image_files"), previewStore = db("image_previews"), logs = db("image_generation_logs"), videoLogs = db("video_generation_logs"), tasks = db("relay_tasks"), state = db("app_state"), protocols = db("call_protocols");
    const configKey = "infinite-canvas:ai_config_store", protocolKey = "canvas-call-protocols-v1";
    const config = JSON.stringify({ state: { config: { channels: [
        { id: "image", baseUrl: "https://image-relay.invalid", apiKey: "image-test-not-a-secret", imageTaskBaseUrl: "https://tasks.invalid", protocolId: "custom", models: [{ name: "image-model", capability: "image", protocolId: "custom" }] },
        { id: "text", baseUrl: "https://text-relay.invalid", apiKey: "text-test-not-a-secret", protocolId: "custom-text", models: [{ name: "text-model", capability: "text" }] },
    ], imageModel: "image::image-model", textModel: "text::text-model" } }, version: 0 });
    localStorage.setItem(configKey, config);
    await state.setItem(configKey, config);
    const protocol = JSON.stringify({ state: { protocols: [{ format: "canvas-call/v1", id: "custom", label: "test", capability: "image", script: "return []" }] }, version: 0 });
    await protocols.setItem(protocolKey, protocol);
    const assertProtected = async () => {
        assert.equal(localStorage.getItem(configKey), config, "localStorage API 配置字节不变，生图与对话密钥不混用");
        assert.equal(await state.getItem(configKey), config, "IndexedDB API 配置字节不变");
        assert.equal(await protocols.getItem(protocolKey), protocol, "自定义协议字节不变");
    };
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
    await assertProtected();
    const invalid = zipSync({ "manifest.json": strToU8(JSON.stringify({ format: "canvas-cleanup/v1", projects: [], assets: [], records: [{ store: "call_protocols", key: "canvas-call-protocols-v1", value: "tampered" }] })) });
    await assert.rejects(restoreCleanupBackup(new File([invalid], "bad.zip")), /不允许/);
    const all = await prepareCleanup("current", { ...options, allProjects: true, logs: true });
    await all.apply();
    assert.equal(await imageStore.length(), 0);
    assert.equal(await logs.length(), 0);
    await restoreCleanupBackup(new File([all.backup], "all.zip"));
    assert.equal(await logs.length(), 1);
    assert.equal(await imageStore.length(), 3);
    await assertProtected();

    // The visible cleanup action uses this direct mode: no archive is generated or required.
    useCanvasStore.setState({ projects: [project("current", "image:remove"), project("other", "image:shared")] });
    await videoLogs.setItem("video-log", { references: [{ storageKey: "image:history" }] });
    await tasks.setItem("img_test", { id: "img_test", channelId: "image", model: "image-model", baseUrl: "https://tasks.invalid", status: "pending", createdAt: "now" });
    const retainedLogs = [await logs.getItem("history"), await videoLogs.getItem("video-log"), await tasks.getItem("img_test")];
    const direct = await prepareCleanup("current", options, false);
    assert.equal(direct.backup.size, 0, "直接清理不创建 ZIP 备份");
    assert.equal(direct.imageCount, 1);
    assert.equal(direct.recordCount, 0);
    await direct.apply();
    const directSaved = JSON.parse((await state.getItem<string>("infinite-canvas:canvas_store"))!);
    assert.equal(directSaved.state.projects[0].nodes[0].metadata.content, undefined);
    assert.equal(directSaved.state.projects[0].nodes[0].metadata.model, "relay::image");
    assert.equal(directSaved.state.projects[0].nodes[0].metadata.prompt, "translate");
    assert.equal(await imageStore.getItem("image:remove"), null);
    assert.equal(await previewStore.getItem("image:remove"), null);
    assert(await imageStore.getItem("image:shared"), "其他画布引用的图片保留");
    assert(await imageStore.getItem("image:history"), "未选日志仍引用的图片保留");
    assert.deepEqual([await logs.getItem("history"), await videoLogs.getItem("video-log"), await tasks.getItem("img_test")], retainedLogs, "未选日志时同时保留图片、视频及异步任务日志");
    await assertProtected();

    useCanvasStore.setState({ projects: directSaved.state.projects });
    const directLogs = await prepareCleanup("current", { images: false, history: false, logs: true, assets: false, allProjects: false }, false);
    assert.equal(directLogs.backup.size, 0);
    assert.equal(directLogs.imageCount, 0);
    assert.equal(directLogs.recordCount, 3);
    await directLogs.apply();
    assert.equal(await logs.length(), 0);
    assert.equal(await videoLogs.length(), 0);
    assert.equal(await tasks.length(), 0, "选中日志时清除 relay_tasks");
    assert(await imageStore.getItem("image:history"), "只清日志时不删除图片文件");
    await assertProtected();

    const directAll = await prepareCleanup("current", { ...options, allProjects: true, logs: true }, false);
    assert.equal(directAll.backup.size, 0);
    await directAll.apply();
    assert.equal(await imageStore.length(), 0);
    assert.equal(await previewStore.length(), 0);
    await assertProtected();
    console.log("PASS: IndexedDB 清理事务 / 直接清理无 ZIP / 未选日志和异步任务保留 / 选中日志清除 relay_tasks / 当前及全部画布 / 共享及历史引用保护 / 生图与对话独立 API 配置及协议字节不变 / ZIP 恢复回归 / 恶意配置写入被阻止");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
