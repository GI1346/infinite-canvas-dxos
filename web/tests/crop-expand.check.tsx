import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "../src/components/canvas/canvas-node-crop-dialog";
import { cropDataUrl, splitDataUrl } from "../src/lib/canvas/canvas-image-data";
import { fitFrameScene, framePixels, fullImageFrame, resizeImageFrame, sizeImageFrame, type FrameHandle } from "../src/lib/canvas/canvas-image-frame";

type Pixel = [number, number, number, number];
type Bitmap = { width: number; height: number; pixels: Pixel[] };
const rgba = (hex: string): Pixel => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
const transparent: Pixel = [0, 0, 0, 0];
const original: Bitmap = { width: 4, height: 2, pixels: Array.from({ length: 8 }, (_, i) => [i + 1, 0, 0, 255]) };
const uiImage: Bitmap = { width: 100, height: 50, pixels: [] };
const images = new Map([["original", original], ["ui", uiImage]]);
let invalidExport = false;
class TestImage {
    width = 0; height = 0; naturalWidth = 0; naturalHeight = 0; pixels: Pixel[] = [];
    onload: (() => void) | null = null; onerror: (() => void) | null = null; _src = "";
    set src(value: string) {
        this._src = value; const source = images.get(value);
        if (source) { this.width = this.naturalWidth = source.width; this.height = this.naturalHeight = source.height; this.pixels = source.pixels; }
        queueMicrotask(() => source ? this.onload?.() : this.onerror?.());
    }
    get src() { return this._src; }
}
Object.defineProperty(globalThis, "Image", { value: TestImage, configurable: true });
Object.defineProperty(globalThis, "AbortController", { value: window.AbortController, configurable: true });
const canvasPixels = new WeakMap<HTMLCanvasElement, Bitmap>();
function bitmap(canvas: HTMLCanvasElement) {
    let result = canvasPixels.get(canvas);
    if (!result || result.width !== canvas.width || result.height !== canvas.height) {
        result = { width: canvas.width, height: canvas.height, pixels: Array.from({ length: canvas.width * canvas.height }, () => [...transparent]) };
        canvasPixels.set(canvas, result);
    }
    return result;
}
(window.HTMLCanvasElement.prototype as any).getContext = function () {
    const canvas = this as HTMLCanvasElement;
    return {
        fillStyle: "#000000",
        fillRect(x: number, y: number, width: number, height: number) {
            const target = bitmap(canvas), color = rgba(this.fillStyle);
            for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) target.pixels[py * target.width + px] = [...color];
        },
        drawImage(image: TestImage, ...args: number[]) {
            const target = bitmap(canvas);
            const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 4 ? [0, 0, image.width, image.height, ...args] : args;
            for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
                const tx = dx + x, ty = dy + y;
                if (tx >= 0 && ty >= 0 && tx < target.width && ty < target.height) target.pixels[ty * target.width + tx] = [...image.pixels[(sy + Math.floor(y / dh * sh)) * image.width + sx + Math.floor(x / dw * sw)]];
            }
        },
    };
};
(window.HTMLCanvasElement.prototype as any).toDataURL = function () { return invalidExport ? "data:," : "data:image/png;base64," + Buffer.from(JSON.stringify(bitmap(this))).toString("base64"); };
const decode = (dataUrl: string): Bitmap => JSON.parse(Buffer.from(dataUrl.split(",")[1], "base64").toString());
let passes = 0;
async function check(name: string, work: () => void | Promise<void>) { await work(); console.log("PASS " + name); passes++; }
const same = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, String(a) + " ~= " + String(b));

async function pixelChecks() {
    await check("local crop preserves exact selected source pixels", async () => {
        const result = decode(await cropDataUrl("original", { x: .25, y: 0, width: .5, height: 1 }));
        assert.deepEqual(result, { width: 2, height: 2, pixels: [original.pixels[1], original.pixels[2], original.pixels[5], original.pixels[6]] });
    });
    await check("local expansion keeps original pixel scale and fills chosen background", async () => {
        const result = decode(await cropDataUrl("original", { x: -.25, y: -.5, width: 1.5, height: 2, background: "#ffeecc" }));
        assert.equal(result.width, 6); assert.equal(result.height, 4);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) assert.deepEqual(result.pixels[y * 6 + x], x >= 1 && x < 5 && y >= 1 && y < 3 ? original.pixels[(y - 1) * 4 + x - 1] : rgba("#ffeecc"));
    });
    await check("transparent expansion and wholly-outside frame remain valid local images", async () => {
        const result = decode(await cropDataUrl("original", { x: .5, y: -.5, width: 1, height: 1, background: "transparent" }));
        assert.equal(result.width, 4); assert.equal(result.height, 2); assert.deepEqual(result.pixels.slice(0, 4), Array.from({ length: 4 }, () => transparent));
        assert.deepEqual(result.pixels.slice(4), [original.pixels[2], original.pixels[3], transparent, transparent]);
        const outside = decode(await cropDataUrl("original", { x: 2, y: 2, width: .5, height: .5, background: "#123456" }));
        assert.deepEqual(outside.pixels, [rgba("#123456"), rgba("#123456")]);
    });
    await check("invalid regions, unreadable images and browser export failure reject", async () => {
        for (const crop of [{ x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: 0, y: 0, width: 1, height: Infinity }]) await assert.rejects(cropDataUrl("original", crop), /区域无效/);
        await assert.rejects(cropDataUrl("broken", fullImageFrame), /无法读取图片/);
        invalidExport = true; try { await assert.rejects(cropDataUrl("original", fullImageFrame), /尺寸过大/); await assert.rejects(splitDataUrl("original", { rows: 2, columns: 2 }), /尺寸过大/); } finally { invalidExport = false; }
    });
    await check("uneven and selected grid slices report actual output pixels without duplicates", async () => {
        const pieces = await splitDataUrl("original", { rows: 2, columns: 3 });
        assert.deepEqual(pieces.map((p) => [p.width, p.height]), [[1, 1], [2, 1], [1, 1], [1, 1], [2, 1], [1, 1]]);
        pieces.forEach((p) => { const decoded = decode(p.dataUrl); assert.equal(decoded.width, p.width); assert.equal(decoded.height, p.height); });
        const selected = await splitDataUrl("original", { rows: 99, columns: 99, horizontalLines: [], verticalLines: [.5, .5, NaN, 1, -1], selectedCells: [{ row: 0, column: 1 }] });
        assert.equal(selected.length, 1); assert.equal(selected[0].row, 0); assert.equal(selected[0].column, 1); assert.equal(selected[0].width, 2); assert.equal(selected[0].height, 2);
        assert.deepEqual(decode(selected[0].dataUrl).pixels, [original.pixels[2], original.pixels[3], original.pixels[6], original.pixels[7]]);
        assert.equal((await splitDataUrl("original", { rows: 4, columns: 4, horizontalLines: [], verticalLines: [] })).length, 1);
        assert.equal((await splitDataUrl("original", { rows: 2, columns: 2, selectedCells: [] })).length, 0);
    });
    await check("all eight handles freely expand past original, honor ratio and preserve opposite edges", () => {
        for (const handle of ["n", "e", "s", "w", "ne", "nw", "se", "sw"] as FrameHandle[]) {
            const next = resizeImageFrame(fullImageFrame, handle.includes("w") ? -.25 : .25, handle.includes("n") ? -.5 : .5, handle, uiImage, null);
            if (handle.includes("w")) { assert.equal(next.x, -.25); assert.equal(next.x + next.width, 1); }
            if (handle.includes("n")) { assert.equal(next.y, -.5); assert.equal(next.y + next.height, 1); }
            if (handle.includes("e")) assert.equal(next.width, 1.25);
            if (handle.includes("s")) assert.equal(next.height, 1.5);
            const square = resizeImageFrame(fullImageFrame, .2, .4, handle, uiImage, 1);
            same(square.width * uiImage.width, square.height * uiImage.height);
        }
        const sized = sizeImageFrame(fullImageFrame, uiImage, 200, 100);
        assert.deepEqual(framePixels(sized, uiImage), { x: -50, y: -25, width: 200, height: 100 });
        const scene = fitFrameScene(sized); assert.ok(scene.x < sized.x && scene.y < sized.y && scene.x + scene.width > sized.x + sized.width);
    });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); }
const click = () => new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: x, clientY: y });
function label(name: string) { const found = document.querySelector<HTMLElement>('[aria-label="' + name + '"]'); assert.ok(found, name); return found; }
function textButton(text: string) { const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.replace(/\s/g, "") === text.replace(/\s/g, "")); assert.ok(found, text); return found; }
async function value(name: string, next: string) {
    const input = label(name) as HTMLInputElement; await act(async () => { input.focus(); });
    await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, next); input.dispatchEvent(new Event("input", { bubbles: true })); await tick(); });
    await act(async () => { input.blur(); });
}
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return this.hasAttribute("data-crop-viewport") ? 800 : 0; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return this.hasAttribute("data-crop-viewport") ? 400 : 0; } });
const oldRect = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-crop-scene") || this.hasAttribute("data-crop-viewport")) {
        const width = this.hasAttribute("data-crop-scene") ? parseFloat(this.style.width) : 800, height = this.hasAttribute("data-crop-scene") ? parseFloat(this.style.height) : 400;
        return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
    }
    return oldRect.call(this);
};

async function uiChecks() {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    let confirmed: CanvasImageCropRect | null = null;
    const render = async (dataUrl = "ui") => { await act(async () => { root.render(<CanvasNodeCropDialog dataUrl={dataUrl} open onClose={() => {}} onConfirm={(frame) => { confirmed = frame; }} />); await tick(); }); };
    await render();
    try {
        await check("crop/expand dialog defaults to full original with 8 handles and no AI prompt", async () => {
            assert.equal(document.querySelectorAll("[data-crop-handle]").length, 8); assert.equal((label("裁剪扩图输出宽度") as HTMLInputElement).value, "100");
            assert.equal((label("裁剪扩图输出高度") as HTMLInputElement).value, "50"); assert.equal(document.querySelector("textarea"), null);
            await fire(textButton("确认裁剪 / 扩图"), click()); assert.deepEqual(confirmed, fullImageFrame);
        });
        await check("outside resize commits once, undo/redo and output pixel inputs work", async () => {
            const frame = document.querySelector("[data-crop-frame]")!;
            await fire(frame.querySelector('[data-crop-handle="nw"]')!, pointer("pointerdown", 20, 20));
            await fire(document, pointer("pointermove", 0, 0)); await fire(document, pointer("pointerup", 0, 0));
            await fire(textButton("确认裁剪 / 扩图"), click()); assert.ok(confirmed!.x < 0 && confirmed!.y < 0);
            await fire(label("撤销裁剪扩图"), click()); await fire(textButton("确认裁剪 / 扩图"), click()); assert.deepEqual(confirmed, fullImageFrame);
            await fire(label("重做裁剪扩图"), click()); await fire(textButton("确认裁剪 / 扩图"), click()); assert.ok(confirmed!.x < 0);
            await value("裁剪扩图输出宽度", "200"); await value("裁剪扩图输出高度", "100");
            await fire(textButton("确认裁剪 / 扩图"), click()); assert.equal(framePixels(confirmed!, uiImage).width, 200); assert.equal(framePixels(confirmed!, uiImage).height, 100);
            const checkbox = [...document.querySelectorAll("input")].find((e) => e.type === "checkbox")!;
            await fire(checkbox, click()); await fire(textButton("确认裁剪 / 扩图"), click()); assert.equal(confirmed!.background, "#ffffff");
        });
        await check("Space+left and wheel over frame pan/zoom preview without editing pixels", async () => {
            await fire(textButton("确认裁剪 / 扩图"), click()); const before = { ...confirmed! }, frame = document.querySelector("[data-crop-frame]")!, viewport = document.querySelector("[data-crop-viewport]")! as HTMLElement;
            const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 50, clientY: 50 }); await fire(frame, wheel); assert.equal(wheel.defaultPrevented, true);
            assert.ok([...document.querySelectorAll("button")].some((e) => e.textContent === "120%"));
            viewport.scrollLeft = 90; viewport.scrollTop = 60;
            await fire(frame, new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }));
            await fire(frame, pointer("pointerdown", 50, 50)); await fire(viewport, pointer("pointermove", 80, 70)); await fire(viewport, pointer("pointerup", 80, 70));
            await fire(frame, new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true, cancelable: true }));
            assert.equal(viewport.scrollLeft, 60); assert.equal(viewport.scrollTop, 40);
            await fire(textButton("确认裁剪 / 扩图"), click()); assert.deepEqual(confirmed, before);
        });
        await check("reset restores original and image errors disable confirmation", async () => {
            await fire(textButton("恢复原图选区"), click()); await fire(textButton("确认裁剪 / 扩图"), click()); assert.deepEqual(confirmed, fullImageFrame);
            await render("broken"); assert.ok(document.querySelector('[role="alert"]')?.textContent?.includes("无法读取图片")); assert.equal(textButton("确认裁剪 / 扩图").disabled, true);
        });
    } finally { await act(async () => root.unmount()); host.remove(); }
}
(async () => { await pixelChecks(); await uiChecks(); console.log("PASS crop-expand: " + passes + "/" + passes + " checks (software pixel canvas + real React; no network/API use)"); })().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
