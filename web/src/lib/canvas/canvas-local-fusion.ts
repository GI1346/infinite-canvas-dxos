import { fetchImageBlob, getImageBlob, uploadImage, type UploadedImage } from "@/services/image-storage";
import type { CanvasConnection, CanvasCropContext, CanvasCropRect, CanvasNodeData } from "@/types/canvas";

import { FUSION_PATCH_PORT } from "@/lib/canvas/canvas-fusion-ports";
export { LOCAL_FUSION_NODE_TYPE, FUSION_PATCH_PORT } from "@/lib/canvas/canvas-fusion-ports";
export type LocalCropContext = Exclude<CanvasCropContext, { full: true } | { conflict: true }>;
export type CropContextResolution = { kind: "none" } | { kind: "local"; context: LocalCropContext } | { kind: "conflict" };

// Each branch stops at its first explicit boundary; a full image never inherits an old local region.
export function resolveCropContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CropContextResolution {
    const index = new Map(nodes.map((node) => [node.id, node]));
    const upstream = new Map<string, string[]>();
    connections.forEach((edge) => upstream.set(edge.toNodeId, [...(upstream.get(edge.toNodeId) || []), edge.fromNodeId]));
    const pending = [nodeId], seen = new Set<string>(), contexts = new Map<string, LocalCropContext>();
    for (let cursor = 0; cursor < pending.length; cursor++) {
        const id = pending[cursor];
        if (seen.has(id)) continue;
        seen.add(id);
        const node = index.get(id);
        if (!node) continue;
        const context = node.metadata?.cropContext;
        if (context) {
            if ("conflict" in context) return { kind: "conflict" };
            if (!("full" in context)) contexts.set(JSON.stringify([context.sourceIdentity, context.rect, context.paddedRect]), context);
            continue;
        }
        pending.push(...(upstream.get(id) || []));
    }
    if (contexts.size > 1) return { kind: "conflict" };
    return contexts.size ? { kind: "local", context: contexts.values().next().value! } : { kind: "none" };
}

type ImageContextReference = { id?: string; nodeId?: string; storageKey?: string; url?: string; dataUrl?: string };
// Freeze only actual image inputs. A table/config traversal would mix unrelated rows or unused references.
export function imageOutputCropContext(references: ImageContextReference[], nodes: CanvasNodeData[], connections: CanvasConnection[], editingNode?: CanvasNodeData): CanvasCropContext {
    const primary = editingNode?.metadata?.cropContext;
    // Editing a local image keeps its own destination; additional references only describe the edit.
    if (primary && "full" in primary) return { full: true };
    if (primary && !("full" in primary) && !("conflict" in primary)) return structuredClone(primary);
    const contexts = new Map<string, LocalCropContext>();
    for (const reference of references) {
        const id = reference.nodeId || reference.id;
        const exact = nodes.filter((node) => node.id === id || (id?.startsWith(`${node.id}:`) && node.metadata?.images?.some((image) => `${node.id}:${image.id}` === id)));
        const matches = exact.length ? exact : nodes.filter((node) => (reference.storageKey && (node.metadata?.storageKey === reference.storageKey || node.metadata?.images?.some((image) => image.storageKey === reference.storageKey))) || ([reference.url, reference.dataUrl].some((url) => url && (node.metadata?.content === url || node.metadata?.images?.some((image) => image.content === url)))));
        for (const match of matches) {
            const resolved = resolveCropContext(match.id, nodes, connections);
            if (resolved.kind === "conflict") return { conflict: true };
            if (resolved.kind === "local") contexts.set(JSON.stringify([resolved.context.sourceIdentity, resolved.context.rect, resolved.context.paddedRect]), resolved.context);
        }
    }
    return contexts.size > 1 ? { conflict: true } : contexts.size ? structuredClone(contexts.values().next().value!) : { full: true };
}

// Recover an already-generated ambiguous patch only when the connected original identifies one region.
// Never cross a full-image boundary, a table or a config node to guess a destination.
export function resolveFusionCropContext(nodeId: string, original: CanvasNodeData | undefined, nodes: CanvasNodeData[], connections: CanvasConnection[]): CropContextResolution {
    const resolved = resolveCropContext(nodeId, nodes, connections);
    if (resolved.kind !== "conflict" || !original) return resolved;
    const index = new Map(nodes.map((node) => [node.id, node])), pending = [nodeId], seen = new Set<string>(), candidates = new Map<string, LocalCropContext>();
    for (let cursor = 0; cursor < pending.length; cursor++) {
        const node = index.get(pending[cursor]);
        if (!node || node.type !== "image" || seen.has(node.id)) continue;
        seen.add(node.id);
        const context = node.metadata?.cropContext;
        if (context && "full" in context) continue;
        if (context && !("conflict" in context)) {
            if (context.sourceNodeId === original.id || (context.sourceStorageKey && context.sourceStorageKey === original.metadata?.storageKey)) candidates.set(JSON.stringify([context.sourceIdentity, context.rect, context.paddedRect]), context);
            continue;
        }
        const references = node.metadata?.references || [];
        for (const reference of references) {
            nodes.filter((item) => item.metadata?.storageKey === reference || item.metadata?.content === reference).forEach((item) => pending.push(item.id));
        }
        connections.filter((edge) => edge.toNodeId === node.id).forEach((edge) => pending.push(edge.fromNodeId));
    }
    return candidates.size === 1 ? { kind: "local", context: candidates.values().next().value! } : resolved;
}

export function fusionInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const index = new Map(nodes.map((node) => [node.id, node]));
    const inputs = connections.filter((edge) => edge.toNodeId === nodeId).map((edge) => ({ edge, node: index.get(edge.fromNodeId) })).filter((item): item is { edge: CanvasConnection; node: CanvasNodeData } => Boolean(item.node));
    return { originals: inputs.filter(({ edge }) => edge.toPort !== FUSION_PATCH_PORT).map(({ node }) => node), patches: inputs.filter(({ edge }) => edge.toPort === FUSION_PATCH_PORT).map(({ node }) => node) };
}

const bound = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
export function selectionRect(rect: CanvasCropRect, width: number, height: number, ratio?: string): CanvasCropRect {
    if (![rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || width < 1 || height < 1) throw new Error("选区坐标或图片尺寸无效");
    let w = rect.width, h = rect.height;
    const parts = ratio?.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    const value = parts ? Number(parts[1]) / Number(parts[2]) : 0;
    if (value > 0 && Number.isFinite(value)) { if (w / h > value) w = h * value; else h = w / value; }
    const scale = Math.min(1, width / w, height / h);
    w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
    return { x: bound(Math.round(rect.x + (rect.width - w) / 2), 0, width - w), y: bound(Math.round(rect.y + (rect.height - h) / 2), 0, height - h), width: w, height: h };
}

export function paddedSelection(rect: CanvasCropRect, width: number, height: number): CanvasCropRect {
    // Uniform expansion preserves the selected ratio even when the region touches the image edge.
    const factor = Math.min(1.2, width / rect.width, height / rect.height);
    const w = Math.max(rect.width, Math.min(width, Math.round(rect.width * factor)));
    const h = Math.max(rect.height, Math.min(height, Math.round(rect.height * factor)));
    return { x: bound(Math.round(rect.x - (w - rect.width) / 2), Math.max(0, rect.x + rect.width - w), Math.min(rect.x, width - w)), y: bound(Math.round(rect.y - (h - rect.height) / 2), Math.max(0, rect.y + rect.height - h), Math.min(rect.y, height - h)), width: w, height: h };
}

async function imageBlob(node: CanvasNodeData) {
    if (!node.metadata?.content && !node.metadata?.storageKey) throw new Error(`“${node.title || "图片"}”还没有图片`);
    const stored = node.metadata?.storageKey ? await getImageBlob(node.metadata.storageKey) : null;
    return stored || fetchImageBlob(node.metadata!.content!);
}
async function imageIdentity(blob: Blob) {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}
function surface(width: number, height: number) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || canvas.width !== width || canvas.height !== height) throw new Error("无法创建图片处理画布，请缩小图片后重试");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    return { canvas, context };
}
async function png(canvas: HTMLCanvasElement) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("图片导出失败");
    return blob;
}

export async function extractImageSelection(source: CanvasNodeData, rect: CanvasCropRect, ratio?: string): Promise<{ dataUrl: string; context: LocalCropContext }> {
    const blob = await imageBlob(source), bitmap = await createImageBitmap(blob);
    try {
        const selected = selectionRect(rect, bitmap.width, bitmap.height, ratio);
        const padded = paddedSelection(selected, bitmap.width, bitmap.height);
        const output = surface(padded.width, padded.height);
        output.context.drawImage(bitmap, padded.x, padded.y, padded.width, padded.height, 0, 0, padded.width, padded.height);
        const result = await png(output.canvas);
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("无法读取提取结果")); reader.readAsDataURL(result); });
        return { dataUrl, context: { version: 1, sourceNodeId: source.id, sourceIdentity: await imageIdentity(blob), sourceStorageKey: source.metadata?.storageKey, sourceWidth: bitmap.width, sourceHeight: bitmap.height, rect: selected, paddedRect: padded } };
    } finally { bitmap.close(); }
}

function validateContext(context: LocalCropContext, bitmap: ImageBitmap, identity: string) {
    if (context.version !== 1 || context.sourceIdentity !== identity || context.sourceWidth !== bitmap.width || context.sourceHeight !== bitmap.height) throw new Error("局部图不属于当前原图，请连接当初提取选区的那张完整原图");
    const { rect: inner, paddedRect: outer } = context;
    for (const rect of [inner, outer]) if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isInteger) || rect.width < 1 || rect.height < 1 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > bitmap.width || rect.y + rect.height > bitmap.height) throw new Error("局部图选区上下文损坏，请重新提取选区");
    if (inner.x < outer.x || inner.y < outer.y || inner.x + inner.width > outer.x + outer.width || inner.y + inner.height > outer.y + outer.height) throw new Error("选区超出其上下文区域，请重新提取选区");
}

// The ring is the untouched surrounding context, not the edited region itself.
function ringMean(pixels: ImageData, inner: CanvasCropRect): [number, number, number] {
    const sum: [number, number, number] = [0, 0, 0]; let count = 0;
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) {
        if (x >= inner.x && x < inner.x + inner.width && y >= inner.y && y < inner.y + inner.height) continue;
        const offset = (y * pixels.width + x) * 4; if (!pixels.data[offset + 3]) continue;
        for (let channel = 0; channel < 3; channel++) sum[channel] += pixels.data[offset + channel];
        count++;
    }
    return count ? sum.map((value) => value / count) as [number, number, number] : [0, 0, 0];
}
function featherMask(width: number, height: number, inner: CanvasCropRect) {
    const raw = surface(width, height), pixels = raw.context.createImageData(width, height);
    const smooth = (value: number) => { const t = bound(value, 0, 1); return t * t * (3 - 2 * t); };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const horizontal = x < inner.x ? x / Math.max(1, inner.x) : x >= inner.x + inner.width ? (width - 1 - x) / Math.max(1, width - inner.x - inner.width) : 1;
        const vertical = y < inner.y ? y / Math.max(1, inner.y) : y >= inner.y + inner.height ? (height - 1 - y) / Math.max(1, height - inner.y - inner.height) : 1;
        const offset = (y * width + x) * 4; pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = 255; pixels.data[offset + 3] = Math.round(smooth(Math.min(horizontal, vertical)) * 255);
    }
    raw.context.putImageData(pixels, 0, 0);
    const blurred = surface(width, height); blurred.context.filter = "blur(0.8px)"; blurred.context.drawImage(raw.canvas, 0, 0); blurred.context.filter = "none";
    blurred.context.fillStyle = "white"; blurred.context.fillRect(inner.x, inner.y, inner.width, inner.height);
    return blurred.canvas;
}

export async function fuseImageNodes(original: CanvasNodeData, patches: CanvasNodeData[], nodes: CanvasNodeData[], connections: CanvasConnection[], colorMatch = true): Promise<UploadedImage> {
    if (!patches.length) throw new Error("请连接至少一张局部修改图");
    const originalBlob = await imageBlob(original), originalBitmap = await createImageBitmap(originalBlob);
    const decoded: ImageBitmap[] = [];
    try {
        const identity = await imageIdentity(originalBlob);
        const contexts: LocalCropContext[] = [];
        for (const patch of patches) {
            const resolved = resolveFusionCropContext(patch.id, original, nodes, connections);
            if (resolved.kind === "none") throw new Error(`“${patch.title}”没有选区上下文，请连接“提取选区”得到的局部图或其改图结果`);
            if (resolved.kind === "conflict") throw new Error(`“${patch.title}”混入多个不同选区，无法确定回贴位置；只保留需要回贴的局部图，其他参考请使用普通裁剪图`);
            validateContext(resolved.context, originalBitmap, identity);
            const bitmap = await createImageBitmap(await imageBlob(patch)); decoded.push(bitmap);
            const region = resolved.context.paddedRect;
            if (Math.abs(bitmap.width / bitmap.height / (region.width / region.height) - 1) > 0.01) throw new Error(`“${patch.title}”比例与选区不一致：选区 ${region.width}×${region.height}，修改图 ${bitmap.width}×${bitmap.height}；请按选区比例生成`);
            contexts.push(resolved.context);
        }
        const output = surface(originalBitmap.width, originalBitmap.height); output.context.drawImage(originalBitmap, 0, 0);
        // O(original pixels + sum(patch pixels)); process layers sequentially rather than retaining all intermediate canvases.
        for (let index = 0; index < decoded.length; index++) {
            const region = contexts[index].paddedRect, selected = contexts[index].rect;
            const inner = { ...selected, x: selected.x - region.x, y: selected.y - region.y };
            const layer = surface(region.width, region.height); layer.context.drawImage(decoded[index], 0, 0, region.width, region.height);
            if (colorMatch) {
                const pixels = layer.context.getImageData(0, 0, region.width, region.height);
                const base = ringMean(output.context.getImageData(region.x, region.y, region.width, region.height), inner), edit = ringMean(pixels, inner);
                const adjustment = base.map((value, channel) => bound(Math.round(value - edit[channel]), -24, 24));
                for (let offset = 0; offset < pixels.data.length; offset += 4) for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] += adjustment[channel];
                layer.context.putImageData(pixels, 0, 0);
            }
            layer.context.globalCompositeOperation = "destination-in"; layer.context.drawImage(featherMask(region.width, region.height, inner), 0, 0);
            output.context.drawImage(layer.canvas, region.x, region.y);
        }
        return uploadImage(await png(output.canvas));
    } finally { decoded.forEach((bitmap) => bitmap.close()); originalBitmap.close(); }
}
