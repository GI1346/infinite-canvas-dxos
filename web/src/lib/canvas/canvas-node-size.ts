import type { CanvasNodeData } from "@/types/canvas";

export const IMAGE_NODE_MAX_EDGE = 640;

export function fitNodeSize(width: number, height: number, maxWidth = IMAGE_NODE_MAX_EDGE, maxHeight = IMAGE_NODE_MAX_EDGE) {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    return { width: w * scale, height: h * scale };
}

export function nodeSizeFromRatio(size: string, baseWidth: number, baseHeight: number) {
    const match = size?.match(/^(\d+)(?:x|:)(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    const ratio = width / Math.max(1, height);
    if (ratio < 0.25 || ratio > 4) return { width: baseWidth, height: baseHeight };
    return ratio >= baseWidth / baseHeight ? { width: baseWidth, height: baseWidth / ratio } : { width: baseHeight * ratio, height: baseHeight };
}

// Fresh generated results share the import scale; explicit resizes and existing images keep their geometry.
export function generatedImageNodeSize(width: number, height: number, node: CanvasNodeData, preserveSize = false) {
    if (node.metadata?.imageSizeManual || node.metadata?.freeResize) return { width: node.width, height: node.height };
    const edge = Math.max(node.width, node.height);
    return preserveSize || node.metadata?.content ? fitNodeSize(width, height, edge, edge) : fitNodeSize(width, height);
}