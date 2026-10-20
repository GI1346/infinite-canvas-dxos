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
const saved: { blob: Blob; name: string }[] = [], reads: string[] = [], blobs = new Map<string, Blob>();
let readBlob = async (key: string): Promise<Blob | null> => { reads.push(key); return blobs.get(key) || null; };
(globalThis as any).__downloadSave = (blob: Blob, name: string) => { saved.push({ blob, name }); };
(globalThis as any).__downloadBlob = (key: string) => readBlob(key);

async function main() {
    const group = node("group", "group"), sub = node("sub", "group", { groupId: group.id }), a = node("A", "image", { groupId: group.id, status: "success", storageKey: "image:a" }), b = node("B", "image", { groupId: sub.id, status: "success", storageKey: "image:b" }), text = node("text", "text", { content: "hello" }), empty = node("empty", "group");
    const nodes = [group, sub, a, b, text, empty]; blobs.set("image:a", new Blob(["original-a"], { type: "image/png" })); blobs.set("image:b", new Blob(["original-b"], { type: "image/jpeg" }));
    let renderMode!: (mode: string) => void, externalDownload!: () => Promise<void>, parentEvents = 0;
    function Harness() {
        const [mode, setMode] = useState("selection"), { downloading, downloadImages } = useCanvasImageDownload(); renderMode = setMode;
        const ids = mode === "empty" ? [empty.id] : mode === "selection" ? [a.id, b.id] : [group.id, sub.id, a.id];
        const start = () => downloadImages(ids, nodes, mode === "selection" ? undefined : mode === "empty" ? empty.title : group.title); externalDownload = start;
        return <div onPointerDown={() => parentEvents++} onMouseDown={() => parentEvents++}>
            {mode === "selection" || mode === "text" || mode === "single" || mode === "hidden" ? <CanvasSelectionToolbar nodes={mode === "text" ? [text, node("other", "text")] : mode === "single" ? [a] : [a, b]} viewport={{ x: 0, y: 0, k: 1 }} showToolbar={mode !== "hidden"} canGroup canUngroup={false} onGroup={no} onUngroup={no} onGrid={no} onDownload={() => void start()} downloading={downloading} /> : <CanvasNodeHoverToolbar {...toolbarProps} node={mode === "empty" ? empty : group} onBatchDownload={() => void start()} batchDownloading={downloading} />}
        </div>;
    }
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<ConfigProvider virtual={false}><App><Harness /></App></ConfigProvider>); await tick(); });
    const button = () => { const result = host.querySelector<HTMLButtonElement>('[aria-label="批量下载图片（ZIP）"]'); assert.ok(result); return result; };
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
            for (const name of ["text", "single", "hidden"]) { await mode(name); assert.equal(host.querySelector('[aria-label="批量下载图片（ZIP）"]'), null); }
        });
        await test("项目已接线实时nodes/selectedIds和单组入口；原始图片读取复用既有代理与超时实现", () => {
            const source = readFileSync("src/pages/canvas/project.tsx", "utf8"), storage = readFileSync("src/services/image-storage.ts", "utf8");
            assert.ok(source.includes("onBatchDownload={(node) => void downloadImages([node.id], nodesRef.current, node.title || \"分组图片\")}"));
            assert.ok(source.includes("onDownload={() => void downloadImages(selectedNodeIdsRef.current, nodesRef.current)}")); assert.ok(source.includes("downloading={batchDownloading}"));
            assert.ok(storage.includes("export async function fetchImageBlob(")); assert.ok(storage.includes("fetch(withLocalProxy(url), { signal: controller.signal })"));
        });
        console.log(`Batch download UI: ${passed}/${passed} passed (real React/Ant UI, real ZIP bytes, original image I/O and save dialog mocked)`);
    } finally { await act(async () => root.unmount()); host.remove(); }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
