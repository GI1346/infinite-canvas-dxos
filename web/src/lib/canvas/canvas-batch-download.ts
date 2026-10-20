import { createZip } from "@/lib/zip";
import { canvasDownloadName } from "@/lib/canvas/canvas-download-name";
import { fetchImageBlob, getImageBlob } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export type DownloadImage = { nodeId: string; title: string; content: string; storageKey?: string; mimeType?: string; index?: number };

export function collectDownloadImages(selectedIds: Iterable<string>, nodes: CanvasNodeData[]) {
    const byId = new Map(nodes.map((node) => [node.id, node])), children = new Map<string, string[]>(), visited = new Set<string>(), images: DownloadImage[] = [];
    for (const node of nodes) if (node.metadata?.groupId) children.set(node.metadata.groupId, [...(children.get(node.metadata.groupId) || []), node.id]);
    const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = byId.get(id);
        if (!node) return;
        if (node.type === CanvasNodeType.Group) { for (const child of children.get(id) || []) visit(child); return; }
        if (node.type !== CanvasNodeType.Image) return;
        const metadata = node.metadata || {}, title = node.title || "图片";
        if (metadata.images?.length) {
            metadata.images.forEach((image, index) => { if (image.status === "success") images.push({ nodeId: id, title, content: image.content, storageKey: image.storageKey, mimeType: image.mimeType, index: index + 1 }); });
        } else if (metadata.status !== "loading" && metadata.status !== "error" && (metadata.content || metadata.storageKey || metadata.status === "success")) images.push({ nodeId: id, title, content: metadata.content || "", storageKey: metadata.storageKey, mimeType: metadata.mimeType });
    };
    for (const id of selectedIds) visit(id);
    return images;
}

export async function collectCanvasImageFiles(selectedIds: Iterable<string>, nodes: CanvasNodeData[]) {
    const files: { name: string; data: Blob }[] = [], used = new Set<string>();
    let skipped = 0;
    for (const image of collectDownloadImages(selectedIds, nodes)) {
        try {
            const stored = image.storageKey ? await getImageBlob(image.storageKey).catch(() => null) : null;
            const blob = stored || (image.content ? await fetchImageBlob(image.content) : null);
            if (!blob?.size || (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream")) { skipped++; continue; }
            const base = canvasDownloadName(image.title, image.content, blob.type.startsWith("image/") ? blob.type : image.mimeType, "png", image.index);
            let name = base;
            for (let index = 2; used.has(name.toLowerCase()); index++) name = base.replace(/(\.[^.]+)$/, `-${index}$1`);
            used.add(name.toLowerCase()); files.push({ name, data: blob });
        } catch { skipped++; }
    }
    return { files, count: files.length, skipped };
}

export async function createCanvasImageZip(selectedIds: Iterable<string>, nodes: CanvasNodeData[]) {
    const result = await collectCanvasImageFiles(selectedIds, nodes);
    return { blob: result.files.length ? await createZip(result.files) : null, count: result.count, skipped: result.skipped };
}
