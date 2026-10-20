import localforage from "localforage";
import { zip, unzip, strToU8, strFromU8 } from "fflate";
import { cleanAssets, cleanProject, type CleanupOptions } from "@/lib/canvas/canvas-cleanup";
import { useCanvasStore, flushCanvasStorage, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";

const imageStores = ["image_files", "image_previews"];
const logStores = ["image_generation_logs", "video_generation_logs", "relay_tasks"];
const allowedStores = [...imageStores, ...logStores];
const canvasKey = "infinite-canvas:canvas_store", assetKey = "infinite-canvas:asset_store";
type RecordEntry = { store: string; key: string; value: unknown };
type Backup = { format: "canvas-cleanup/v1"; createdAt: string; projects: CanvasProject[]; assets: Asset[]; records: RecordEntry[] };
export type CleanupPlan = { backup: Blob; imageCount: number; recordCount: number; apply: () => Promise<void> };

const storeFor = (storeName: string) => localforage.createInstance({ name: "infinite-canvas", storeName });
function imageKeys(value: unknown, keys = new Set<string>()): Set<string> {
    if (typeof value === "string" && value.startsWith("image:")) keys.add(value);
    else if (value && typeof value === "object") Object.values(value).forEach((item) => imageKeys(item, keys));
    return keys;
}
async function recordsIn(names: string[]) {
    const records: RecordEntry[] = [];
    for (const store of names) {
        const db = storeFor(store);
        await db.ready();
        if (db.driver() !== localforage.INDEXEDDB) throw new Error("当前浏览器未启用 IndexedDB，清理未执行");
        await db.iterate((value, key) => { records.push({ store, key, value }); });
    }
    return records;
}

export async function prepareCleanup(projectId: string, options: CleanupOptions, createBackup = true): Promise<CleanupPlan> {
    if (!options.images && !options.history && !options.logs) throw new Error("请至少选择一项清理内容");
    if (!useCanvasStore.getState().hydrated || !useAssetStore.getState().hydrated) throw new Error("本地数据尚未加载完成");
    await flushCanvasStorage();
    const { projects, deletedProjects } = useCanvasStore.getState();
    const assets = useAssetStore.getState().assets;
    const affected = projects.filter((p) => options.allProjects || p.id === projectId);
    if (!affected.length) throw new Error("没有找到当前画布");
    const selected = new Set(affected.map((p) => p.id));
    const nextProjects = projects.map((p) => selected.has(p.id) ? cleanProject(p, options) : p);
    const nextAssets = cleanAssets(assets, options);
    const logs = await recordsIn(logStores);
    // Retain blobs referenced by untouched canvases, assets and retained workbench records.
    const retained = imageKeys({ projects: nextProjects, assets: nextAssets, logs: options.logs ? [] : logs });
    const records = options.images ? (await recordsIn(imageStores)).filter((r) => !retained.has(r.key)) : [];
    if (options.logs) records.push(...logs);
    const backup = createBackup ? await encodeBackup({ format: "canvas-cleanup/v1", createdAt: new Date().toISOString(), projects: affected, assets: options.images && options.assets ? assets.filter((a) => a.kind === "image") : [], records }) : new Blob();
    return {
        backup,
        imageCount: records.filter((r) => r.store === "image_files").length,
        recordCount: options.logs ? logs.length : 0,
        apply: async () => {
            if (useCanvasStore.getState().projects !== projects || useAssetStore.getState().assets !== assets) throw new Error("清理准备后画布或素材发生了变化，请重新执行清理");
            const writes: RecordEntry[] = [{ store: "app_state", key: canvasKey, value: JSON.stringify({ state: { projects: nextProjects, deletedProjects }, version: 0 }) }];
            if (options.images && options.assets) writes.push({ store: "app_state", key: assetKey, value: JSON.stringify({ state: { assets: nextAssets }, version: 0 }) });
            await commitRecords(writes, records);
        },
    };
}

// One IndexedDB transaction: failure leaves all selected data untouched.
function commitRecords(writes: RecordEntry[], removals: RecordEntry[] = []) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("infinite-canvas");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            try {
                const names = [...new Set([...writes, ...removals].map((r) => r.store))];
                const tx = db.transaction(names, "readwrite");
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onabort = () => { db.close(); reject(tx.error || new Error("清理事务已回滚")); };
                tx.onerror = () => {}; // Abort owns error reporting and rollback.
                removals.forEach((r) => tx.objectStore(r.store).delete(r.key));
                writes.forEach((r) => tx.objectStore(r.store).put(r.value, r.key));
            } catch (error) { db.close(); reject(error); }
        };
    });
}

async function encodeBackup(backup: Backup) {
    const files: Record<string, Uint8Array> = {};
    let index = 0;
    async function encode(value: unknown): Promise<unknown> {
        if (value instanceof Blob) {
            const path = `blobs/${index++}`;
            files[path] = new Uint8Array(await value.arrayBuffer());
            return { $cleanupBlob: path, type: value.type };
        }
        if (Array.isArray(value)) return Promise.all(value.map(encode));
        if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encode(v)])));
        return value;
    }
    files["manifest.json"] = strToU8(JSON.stringify(await encode(backup)));
    const result = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => zip(files, { level: 0 }, (error, data) => error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>)));
    return new Blob([result], { type: "application/zip" });
}

export async function restoreCleanupBackup(file: File) {
    const input = new Uint8Array(await file.arrayBuffer());
    const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(input, (error, data) => error ? reject(error) : resolve(data)));
    function decode(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(decode);
        if (value && typeof value === "object") {
            const object = value as Record<string, unknown>;
            if (typeof object.$cleanupBlob === "string") {
                const bytes = files[object.$cleanupBlob];
                if (!bytes) throw new Error("备份中的图片文件缺失");
                return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: String(object.type || "") });
            }
            return Object.fromEntries(Object.entries(object).map(([k, v]) => [k, decode(v)]));
        }
        return value;
    }
    if (!files["manifest.json"]) throw new Error("不是画布清理备份");
    const backup = decode(JSON.parse(strFromU8(files["manifest.json"]))) as Backup;
    if (backup.format !== "canvas-cleanup/v1" || !Array.isArray(backup.projects) || !Array.isArray(backup.assets) || !Array.isArray(backup.records)) throw new Error("备份格式不正确");
    if (backup.projects.some((p) => typeof p.id !== "string" || !Array.isArray(p.nodes) || !Array.isArray(p.connections) || !Array.isArray(p.chatSessions)) || backup.assets.some((a) => typeof a.id !== "string" || a.kind !== "image") || backup.records.some((r) => !allowedStores.includes(r.store) || typeof r.key !== "string")) throw new Error("备份包含不允许恢复的数据");
    for (const store of allowedStores) await storeFor(store).ready();
    await flushCanvasStorage();
    const state = useCanvasStore.getState();
    const projects = [...state.projects.filter((p) => !backup.projects.some((b) => b.id === p.id)), ...backup.projects];
    const assets = [...useAssetStore.getState().assets.filter((a) => !backup.assets.some((b) => b.id === a.id)), ...backup.assets];
    await commitRecords([...backup.records, { store: "app_state", key: canvasKey, value: JSON.stringify({ state: { projects, deletedProjects: state.deletedProjects }, version: 0 }) }, { store: "app_state", key: assetKey, value: JSON.stringify({ state: { assets }, version: 0 }) }]);
}
