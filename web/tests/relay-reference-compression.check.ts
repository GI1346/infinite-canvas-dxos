import axios, { AxiosError } from "axios";
import { requestRelayImage } from "../src/services/api/relay-tasks";
import { createModelChannel, defaultConfig, RELAY_IMAGE_URL, RELAY_TASK_URL, useConfigStore } from "../src/stores/use-config-store";
import { prepareRelayReferences } from "../src/services/api/relay-reference-images";
import { getDataUrlByteSize } from "../src/lib/image-utils";

const MB = 1024 * 1024;
const serialize = (images: string[]) => JSON.stringify({ kind: "image", model: "synthetic-offline-model", input: { prompt: "中文测试提示词", size: "2304x4096", resolution: "4k", quality: "max", image_urls: images } });
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const bytes = (images: string[]) => new Blob([serialize(images)]).size;
const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
async function check(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.stack || error.message : String(error) }); }
}
function makeImage(width: number, height: number, type = "image/png", transparent = false) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d")!, image = context.createImageData(width, height);
    let seed = 103;
    for (let index = 0; index < image.data.length; index += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        image.data[index] = seed & 255; image.data[index + 1] = (seed >>> 8) & 255; image.data[index + 2] = (seed >>> 16) & 255;
        image.data[index + 3] = transparent && index % (width * 4) < 32 * 4 ? 0 : 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL(type, 1);
}
async function read(url: string) { const image = new Image(); image.src = url; await image.decode(); return image; }
async function reject(run: () => Promise<unknown>, message: string) { try { await run(); } catch (error) { assert(error instanceof Error && error.message.includes(message), `Expected ${message}: ${String(error)}`); return; } throw new Error(`Expected rejection: ${message}`); }

async function main() {
    const small = makeImage(64, 48), large = makeImage(1200, 900, "image/png", true);
    await check("small images / URLs unchanged, new array only, order preserved", async () => {
        const refs = [small, "https://images.invalid/do-not-fetch.png", small], result = await prepareRelayReferences(refs, serialize);
        assert(result !== refs && JSON.stringify(refs) === JSON.stringify(result), "Input or image order changed");
    });
    await check("single large transparent PNG compressed to <=1MB, aspect and alpha retained", async () => {
        assert(getDataUrlByteSize(large) > MB, "Fixture not large");
        const refs = [large], before = refs[0], result = await prepareRelayReferences(refs, serialize);
        assert(refs[0] === before, "Original overwritten");
        assert(result[0].startsWith("data:image/png;") && getDataUrlByteSize(result[0]) <= MB, "PNG target not achieved");
        const image = await read(result[0]); assert(image.naturalWidth <= 1200 && image.naturalHeight <= 900 && Math.abs(image.naturalWidth / image.naturalHeight - 4 / 3) < 0.01, "Aspect changed or image enlarged");
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0); assert(ctx.getImageData(0, 0, 1, 1).data[3] === 0, "Transparency lost");
    });
    await check("multiple sub-1MB images compressed when JSON/Base64 total exceeds 4MB", async () => {
        const medium = makeImage(480, 360), refs = [medium, medium, medium, medium, medium, medium, medium];
        assert(getDataUrlByteSize(medium) < MB && bytes(refs) > 4 * MB, "Total-only fixture invalid");
        const result = await prepareRelayReferences(refs, serialize);
        assert(bytes(result) <= 4 * MB && result.length === refs.length && result.some((image) => image !== medium), "Total request budget failed");
        assert(refs.every((image) => image === medium), "Input array overwritten");
    });
    await check("opaque JPEG remains JPEG and meets image/request targets", async () => {
        const jpeg = makeImage(1400, 1000, "image/jpeg"); assert(getDataUrlByteSize(jpeg) > MB, "JPEG fixture not large");
        const result = await prepareRelayReferences([jpeg], serialize);
        assert(result[0].startsWith("data:image/jpeg;") && getDataUrlByteSize(result[0]) <= MB && bytes(result) <= 4 * MB, "JPEG target failed");
    });
    await check("large noisy JPEG falls back to <=2048 long edge without distortion", async () => {
        const jpeg = makeImage(3200, 2400, "image/jpeg"), result = await prepareRelayReferences([jpeg], serialize), image = await read(result[0]);
        assert(Math.max(image.naturalWidth, image.naturalHeight) <= 2048, "Resize fallback did not apply long-edge target");
        assert(Math.abs(image.naturalWidth / image.naturalHeight - 4 / 3) < 0.01 && getDataUrlByteSize(result[0]) <= MB, "Resized image distorted / oversized");
    });
    await check("quality-only compression retains original resolution when target already met", async () => {
        const jpeg = makeImage(1400, 1000, "image/jpeg"), result = await prepareRelayReferences([jpeg], serialize), image = await read(result[0]);
        assert(image.naturalWidth === 1400 && image.naturalHeight === 1000, "Quality-only compression changed dimensions");
    });
    await check("WebP transparency survives compression", async () => {
        const webp = makeImage(1300, 1000, "image/webp", true); assert(getDataUrlByteSize(webp) > MB, "WebP fixture not large");
        const result = await prepareRelayReferences([webp], serialize), image = await read(result[0]);
        assert(result[0].startsWith("data:image/webp;") && getDataUrlByteSize(result[0]) <= MB, "WebP target failed");
        const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0); assert(ctx.getImageData(0, 0, 1, 1).data[3] === 0, "WebP alpha lost");
    });
    await check("too-large prompt fails locally even after image processing", async () => {
        await reject(() => prepareRelayReferences([small], (images) => JSON.stringify({ images, prompt: "中".repeat(1500000) })), "请求总量仍超过 4MB");
    });
    await check("corrupt large reference rejected without replacing original", async () => {
        const bad = "data:image/png;base64," + "A".repeat(2 * MB);
        await reject(() => prepareRelayReferences([bad], serialize), "原图未修改，任务未提交");
    });
    await check("unsupported oversized format rejected without silent animation flattening", async () => {
        await reject(() => prepareRelayReferences(["data:image/gif;base64," + "A".repeat(2 * MB)], serialize), "不支持自动压缩");
    });
    await check("cancel before processing returns AbortError", async () => {
        const controller = new AbortController(); controller.abort();
        try { await prepareRelayReferences([large], serialize, controller.signal); } catch (error) { assert(error instanceof DOMException && error.name === "AbortError", "Wrong abort error"); return; }
        throw new Error("Cancelled compression succeeded");
    });
    await check("cancel during real worker processing returns AbortError", async () => {
        const controller = new AbortController(), job = prepareRelayReferences([large], serialize, controller.signal);
        setTimeout(() => controller.abort(), 10);
        try { await job; } catch (error) { assert(error instanceof DOMException && error.name === "AbortError", "Wrong running abort error"); return; }
        throw new Error("Cancelled worker succeeded");
    });
    await check("generation size/resolution/quality and reference order remain untouched", async () => {
        const refs = [small, large, small], output = await prepareRelayReferences(refs, serialize), payload = JSON.parse(serialize(output));
        assert(payload.input.size === "2304x4096" && payload.input.resolution === "4k" && payload.input.quality === "max", "Generation params changed");
        assert(output[0] === small && output[2] === small && output[1] !== large, "Reference order / small images changed");
    });
    await check("uncompressible request stops before Axios submission", async () => {
        let posts = 0; const adapter = axios.defaults.adapter;
        const channel = createModelChannel({ id: "offline-compression", baseUrl: RELAY_IMAGE_URL, imageTaskBaseUrl: RELAY_TASK_URL, apiKey: "synthetic-not-real", models: [{ name: "synthetic-image", capability: "image" }] });
        const config = { ...defaultConfig, channels: [channel], model: "offline-compression::synthetic-image", systemPrompt: "", size: "2304x4096", imageResolution: "4k" as const, quality: "max" };
        useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: false } });
        axios.defaults.adapter = async () => { posts++; throw new Error("Unexpected network submission"); };
        try {
            await reject(() => requestRelayImage(config, "中".repeat(1500000), [small]), "请求总量仍超过 4MB");
            assert(posts === 0, "Oversized request reached network");
        } finally { axios.defaults.adapter = adapter; }
    });
    await check("real submit uses compressed copy, preserves params/key, and never resubmits HTTP 413", async () => {
        let posts = 0; const adapter = axios.defaults.adapter;
        const channel = createModelChannel({ id: "offline-compression", baseUrl: RELAY_IMAGE_URL, imageTaskBaseUrl: RELAY_TASK_URL, apiKey: "synthetic-not-real", models: [{ name: "synthetic-image", capability: "image" }] });
        const config = { ...defaultConfig, channels: [channel], model: "offline-compression::synthetic-image", systemPrompt: "系统要求", size: "2304x4096", imageResolution: "4k" as const, quality: "max" };
        axios.defaults.adapter = async (request) => {
            posts++; const payload = JSON.parse(request.data);
            assert(request.method === "post" && new Blob([request.data]).size <= 4 * MB, "Wrong request/size");
            assert(request.headers.Authorization === "Bearer synthetic-not-real", "Independent key changed");
            assert(payload.input.size === config.size && payload.input.resolution === config.imageResolution && payload.input.quality === config.quality, "Output params changed");
            assert(payload.input.prompt === "系统要求\n测试" && getDataUrlByteSize(payload.input.image_urls[0]) <= MB && payload.input.image_urls[0] !== large, "Request copy not prepared");
            throw new AxiosError("synthetic 413", "ERR_BAD_REQUEST", request, undefined, { data: {}, status: 413, statusText: "Content Too Large", headers: {}, config: request });
        };
        try { await reject(() => requestRelayImage(config, "测试", [large]), "HTTP 413"); assert(posts === 1, "Submission retried"); }
        finally { axios.defaults.adapter = adapter; }
    });
    await check("oversized-reference cancellation never submits a task", async () => {
        let posts = 0; const adapter = axios.defaults.adapter, controller = new AbortController();
        const channel = createModelChannel({ id: "offline-compression", baseUrl: RELAY_IMAGE_URL, imageTaskBaseUrl: RELAY_TASK_URL, apiKey: "synthetic-not-real", models: [{ name: "synthetic-image", capability: "image" }] });
        const config = { ...defaultConfig, channels: [channel], model: "offline-compression::synthetic-image" };
        axios.defaults.adapter = async () => { posts++; throw new Error("Unexpected request"); };
        const job = requestRelayImage(config, "测试", [large], controller.signal); setTimeout(() => controller.abort(), 10);
        try { await reject(() => job, "已取消提交"); assert(posts === 0, "Cancelled compression submitted task"); }
        finally { axios.defaults.adapter = adapter; }
    });
    return results;
}
(globalThis as unknown as { compressionTestRun: Promise<typeof results> }).compressionTestRun = main();
