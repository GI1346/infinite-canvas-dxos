import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { CanvasSelectionToolbar } from "../src/components/canvas/canvas-selection-toolbar";
import { CanvasNodeHoverToolbar } from "../src/components/canvas/canvas-node-hover-toolbar";
import { useCanvasImageDownload } from "../src/hooks/use-canvas-image-download";
import type { CanvasNodeData } from "../src/types/canvas";

const no = () => {}, tick = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));
let passed = 0;
async function test(name: string, work: () => unknown | Promise<unknown>) { await work(); console.log(`PASS ${name}`); passed++; }
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); }
const click = (target: EventTarget) => fire(target, new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
const node = (id: string, type: string, metadata = {}): CanvasNodeData => ({ id, type, title: `重命名-${id}`, position: { x: 100, y: 150 }, width: 300, height: 240, metadata });
const toolbarProps = { viewport: { x: 0, y: 0, k: 1 }, onKeep: no, onLeave: no, onInfo: no, onDecreaseFont: no, onIncreaseFont: no, onToggleDialog: no, onGenerateImage: no, onUpload: no, onDownload: no, onSaveAsset: no, onPaint: no, onMaskEdit: no, onCrop: no, onSplit: no, onUpscale: no, onSuperResolve: no, onAngle: no, onViewImage: no, onReversePrompt: no, onRetry: no, onToggleFreeResize: no, onDelete: no, onUngroup: no };
const saved: { blob: Blob; name: string }[] = [], reads: string[] = [], blobs = new Map<string, Blob>(), fetches: string[] = [], remotes = new Map<string, Blob>();
let readBlob = async (key: string): Promise<Blob | null> => { reads.push(key); return blobs.get(key) || null; };
(globalThis as any).__downloadSave = (blob: Blob, name: string) => { saved.push({ blob, name }); };
(globalThis as any).__downloadBlob = (key: string) => readBlob(key);
(globalThis as any).__downloadFetch = async (url: string) => { fetches.push(url); const blob = remotes.get(url); if (!blob) throw new Error("Offline test refused URL: " + url); return blob; };

async function main() {
    const group = node("group", "group"), sub = node("sub", "group", { groupId: group.id }), a = node("A", "image", { groupId: group.id, status: "success", storageKey: "image:a" }), b = node("B", "image", { groupId: sub.id, status: "success", storageKey: "image:b" }), text = node("text", "text", { content: "hello" }), empty = node("empty", "group");
    const nodes = [group, sub, a, b, text, empty]; blobs.set("image:a", new Blob(["original-a"], { type: "image/png" })); blobs.set("image:b", new Blob(["original-b"], { type: "image/jpeg" }));
    let renderMode!: (mode: string) => void, externalDownload!: () => Promise<void>, externalSingle!: (node: CanvasNodeData, imageId?: string) => Promise<void>, parentEvents = 0;
    function Harness() {
        const [mode, setMode] = useState("selection"), { downloading, downloadImages, downloadImage } = useCanvasImageDownload(); renderMode = setMode; externalSingle = downloadImage;
        const ids = mode === "empty" ? [empty.id] : mode === "selection" ? [a.id, b.id] : [group.id, sub.id, a.id];
        const start = () => downloadImages(ids, nodes, mode === "selection" ? undefined : mode === "empty" ? empty.title : group.title); externalDownload = start;
        return <div onPointerDown={() => parentEvents++} onMouseDown={() => parentEvents++}>
            {mode === "selection" || mode === "text" || mode === "single" || mode === "hidden" ? <CanvasSelectionToolbar nodes={mode === "text" ? [text, node("other", "text")] : mode === "single" ? [a] : [a, b]} viewport={{ x: 0, y: 0, k: 1 }} showToolbar={mode !== "hidden"} canGroup canUngroup={false} onGroup={no} onUngroup={no} onGrid={no} onDownload={() => void start()} downloading={downloading} /> : <CanvasNodeHoverToolbar {...toolbarProps} node={mode === "empty" ? empty : group} onBatchDownload={() => void start()} batchDownloading={downloading} />}
        </div>;
    }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<ConfigProvider virtual={false}><App><Harness /></App></ConfigProvider>); await tick(); });
    const button = () => { const result = host.querySelector<HTMLButtonElement>('[aria-label="批量下载图片（选择目录）"]'); assert.ok(result); return result; };
    const mode = async (name: string) => act(async () => { renderMode(name); await tick(); });
    try {
        await test("框选多图显示中文批量下载，点击一次输出一个ZIP且名称与原始MIME正确", async () => {
            assert.ok(button().textContent?.includes("批量下载")); await click(button()); assert.equal(saved.length, 1); assert.equal(saved[0].name, "画布图片.zip"); assert.equal(saved[0].blob.type, "application/zip");
            const entries = unzipSync(new Uint8Array(await saved[0].blob.arrayBuffer())); assert.deepEqual(Object.keys(entries), ["重命名-A.png", "重命名-B.jpg"]); assert.equal(new TextDecoder().decode(entries["重命名-A.png"]), "original-a"); assert.equal(new TextDecoder().decode(entries["重命名-B.jpg"]), "original-b");
        });
        await test("单选分组显示批量下载，递归子组并与重复选中的子图去重", async () => {
            await mode("group"); await click(button()); assert.equal(saved.length, 2); assert.equal(saved[1].name, "重命名-group.zip"); assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await saved[1].blob.arrayBuffer()))).sort(), ["重命名-A.png", "重命名-B.jpg"]);
            const el = button(); await fire(el, new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); await fire(el, new MouseEvent("mousedown", { bubbles: true, cancelable: true })); assert.equal(parentEvents, 0);
        });
        await test("无图片或全部读取失败给出中文提示，不保存空ZIP；部分失败下载剩余图并提示数量", async () => {
            const count = saved.length; await mode("empty"); await click(button()); assert.equal(saved.length, count); assert.ok(document.body.textContent?.includes("没有可下载的图片"));
            await mode("group"); const original = readBlob;
            readBlob = async () => { throw new Error("missing"); }; await click(button()); assert.equal(saved.length, count); assert.ok(document.body.textContent?.includes("2 张图片缺失或读取失败"));
            readBlob = async (key) => key === "image:b" ? null : original(key); await click(button()); assert.equal(saved.length, count + 1); assert.ok(document.body.textContent?.includes("已下载 1 张图片，1 张缺失或读取失败已跳过")); assert.equal(Object.keys(unzipSync(new Uint8Array(await saved.at(-1)!.blob.arrayBuffer()))).length, 1); readBlob = original;
        });
        await test("打包中禁用两个入口且同步重复调用也只启动一次，完成后恢复", async () => {
            let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }), original = readBlob;
            readBlob = async (key) => { await wait; return original(key); }; const before = saved.length, readCount = reads.length;
            await click(button()); assert.equal(button().disabled, true); assert.ok(button().textContent?.includes("打包中"));
            await act(async () => { void externalDownload(); void externalDownload(); }); assert.equal(reads.length, readCount);
            await mode("selection"); assert.equal(button().disabled, true); await click(button());
            await act(async () => { release(); await tick(30); }); assert.equal(saved.length, before + 1); assert.equal(reads.length, readCount + 2); assert.equal(button().disabled, false); readBlob = original;
        });
        await test("纯文本多选、仅一图和框选拖动未结束时不显示图片批量入口", async () => {
            for (const name of ["text", "single", "hidden"]) { await mode(name); assert.equal(host.querySelector('[aria-label="批量下载图片（选择目录）"]'), null); }
        });
        await test("项目已接线实时nodes/selectedIds和单组入口；原始图片读取复用既有代理与超时实现", () => {
            const source = readFileSync("src/pages/canvas/project.tsx", "utf8"), storage = readFileSync("src/services/image-storage.ts", "utf8");
            assert.ok(source.includes("onBatchDownload={(node) => void downloadImages([node.id], nodesRef.current, node.title || \"分组图片\")}"));
            assert.ok(source.includes("onDownload={() => void downloadImages(selectedNodeIdsRef.current, nodesRef.current)}")); assert.ok(source.includes("downloading={batchDownloading}"));
            assert.ok(source.includes("if (node.type === CanvasNodeType.Image) return downloadImage(node);")); assert.ok(source.includes("=> downloadImage(node, imageId), [downloadImage])"));
            assert.ok(storage.includes("export async function fetchImageBlob(")); assert.ok(storage.includes("fetch(withLocalProxy(url), { signal: controller.signal })"));
        });
        await test("桌面批量保存选目录、原图字节传入且取消不回退默认路径", async () => {
            await mode("group"); let calls = 0;
            window.blinkflowDownloads = { saveImages: async (files) => { calls++; assert.deepEqual(files.map(f => f.name).sort(), ["重命名-A.png", "重命名-B.jpg"]); assert.equal(new TextDecoder().decode(files[0].data), "original-a"); return { canceled: true, count: 0 }; } };
            const count = saved.length; await click(button()); assert.equal(calls, 1); assert.equal(saved.length, count); delete window.blinkflowDownloads;
        });
        await test("单图工具栏点击即下载一张原图；storageKey优先，失效预览URL不阻断下载", async () => {
            const image = node("单图", "image", { status: "success", storageKey: "image:a", content: "blob:expired-preview", mimeType: "image/jpeg" });
            let calls = 0, canvasPointer = 0; const count = saved.length, beforeFetch = fetches.length;
            window.blinkflowDownloads = { saveImages: async (files) => { calls++; assert.equal(files.length, 1); assert.equal(files[0].name, "重命名-单图.png"); assert.equal(new TextDecoder().decode(files[0].data), "original-a"); return { canceled: false, count: 1 }; } };
            const ownHost = document.createElement("div"); document.body.append(ownHost); const ownRoot = createRoot(ownHost);
            await act(async () => { ownRoot.render(<ConfigProvider><div onPointerDown={() => canvasPointer++} onMouseDown={() => canvasPointer++}><CanvasNodeHoverToolbar {...toolbarProps} node={image} onDownload={() => void externalSingle(image)} /></div></ConfigProvider>); await tick(); });
            try {
                const download = ownHost.querySelector<HTMLButtonElement>('[aria-label="下载图片"]'); assert.ok(download, ownHost.innerHTML);
                await fire(download, new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })); await fire(download, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); await fire(download, new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 })); await fire(download, new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 })); await click(download); assert.equal(canvasPointer, 0); assert.equal(calls, 1); assert.equal(fetches.length, beforeFetch); assert.equal(saved.length, count);
            } finally { await act(async () => ownRoot.unmount()); ownHost.remove(); delete window.blinkflowDownloads; }
        });
        await test("单张生成结果从图片按钮和节点入口下载都保留名称，不附加-1", async () => {
            const image = { ...node("Single", "image", { status: "success", content: "blob:expired", storageKey: "image:a", images: [{ id: "only", status: "success", content: "blob:expired", storageKey: "image:a" }] }), title: "详情3.png" } as CanvasNodeData;
            const snapshot = JSON.stringify(image), count = saved.length;
            await act(async () => { await externalSingle(image, "only"); }); assert.equal(saved.at(-1)!.name, "详情3.png");
            await act(async () => { await externalSingle(image); }); assert.equal(saved.at(-1)!.name, "详情3.png"); assert.equal(saved.length, count + 2);
            assert.equal(await saved.at(-1)!.blob.text(), "original-a"); assert.equal(JSON.stringify(image), snapshot);
        });
        await test("单张生成批次只保存所点图片，使用节点重命名、原始序号与真实MIME", async () => {
            const image = node("Batch", "image", { status: "success", content: "blob:primary", storageKey: "image:a", images: [{ id: "first", status: "success", content: "blob:primary", storageKey: "image:a" }, { id: "second", status: "success", content: "blob:expired-second", storageKey: "image:b" }] });
            const count = saved.length; await act(async () => { await externalSingle(image, "second"); });
            assert.equal(saved.length, count + 1); assert.equal(saved.at(-1)!.name, "重命名-Batch-2.jpg"); assert.equal(saved.at(-1)!.blob.type, "image/jpeg"); assert.equal(await saved.at(-1)!.blob.text(), "original-b");
            await act(async () => { await externalSingle(image, "missing"); }); assert.equal(saved.length, count + 1);
        });
        await test("单图浏览器选目录写原图，不走ZIP；无目录选择器可选另存位置", async () => {
            const image = node("A", "image", { content: "blob:expired", storageKey: "image:a" });
            let name = "", data: Blob | null = null, closed = 0;
            const writer = { write: async (blob: Blob) => { data = blob; }, close: async () => { closed++; } };
            (window as any).showDirectoryPicker = async () => ({ getFileHandle: async (value: string) => { name = value; return { createWritable: async () => writer }; } });
            const count = saved.length;
            try { await act(async () => { await externalSingle(image); }); assert.equal(name, "重命名-A.png"); assert.equal(await data!.text(), "original-a"); assert.equal(closed, 1); assert.equal(saved.length, count); }
            finally { delete (window as any).showDirectoryPicker; }
            name = ""; data = null;
            (window as any).showSaveFilePicker = async (options: { suggestedName: string }) => { name = options.suggestedName; return { createWritable: async () => writer }; };
            try { await act(async () => { await externalSingle(image); }); assert.equal(name, "重命名-A.png"); assert.equal(await data!.text(), "original-a"); assert.equal(closed, 2); assert.equal(saved.length, count); }
            finally { delete (window as any).showSaveFilePicker; }
        });
        await test("单图URL通过原图读取通道转Blob，读取失败有提示，取消不回退下载", async () => {
            const url = "https://download.invalid/original", image = node("URL", "image", { content: url }); remotes.set(url, new Blob(["remote-original"], { type: "image/webp" }));
            const count = saved.length; await act(async () => { await externalSingle(image); }); assert.equal(saved.length, count + 1); assert.equal(saved.at(-1)!.name, "重命名-URL.webp"); assert.equal(await saved.at(-1)!.blob.text(), "remote-original"); assert.equal(fetches.at(-1), url);
            await act(async () => { await externalSingle(node("Missing", "image", { storageKey: "missing-original", content: "blob:missing" })); }); assert.equal(saved.length, count + 1); assert.ok(document.body.textContent?.includes("1 张图片缺失或读取失败"));
            (window as any).showDirectoryPicker = async () => { throw new DOMException("Canceled", "AbortError"); };
            try { const before = reads.length; await act(async () => { await externalSingle(a); }); assert.equal(reads.length, before); assert.equal(saved.length, count + 1); }
            finally { delete (window as any).showDirectoryPicker; }
            window.blinkflowDownloads = { saveImages: async (files) => { assert.equal(files.length, 1); return { canceled: true, count: 0 }; } };
            try { await act(async () => { await externalSingle(a); }); assert.equal(saved.length, count + 1); }
            finally { delete window.blinkflowDownloads; }
        });
        await test("单图与批量共享忙状态，连点只保存一次且不会修改节点数据", async () => {
            const snapshot = JSON.stringify(nodes), count = saved.length, original = readBlob; let release!: () => void;
            const wait = new Promise<void>((resolve) => { release = resolve; }); readBlob = async (key) => { await wait; return original(key); };
            await act(async () => { void externalSingle(a); void externalSingle(a); void externalDownload(); });
            await act(async () => { release(); await tick(30); }); readBlob = original;
            assert.equal(saved.length, count + 1); assert.equal(saved.at(-1)!.name, "重命名-A.png"); assert.equal(JSON.stringify(nodes), snapshot);
        });
        console.log(`Batch download UI: ${passed}/${passed} passed (real React/Ant UI, real ZIP bytes, original image I/O and save dialog mocked)`);
    } finally { await act(async () => root.unmount()); host.remove(); }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
