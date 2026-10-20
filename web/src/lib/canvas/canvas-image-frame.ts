export type ImageFrame = { x: number; y: number; width: number; height: number; background?: string };
export type FrameHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
export type FrameImageSize = { width: number; height: number };
export const fullImageFrame: ImageFrame = { x: 0, y: 0, width: 1, height: 1, background: "transparent" };

export function framePixels(frame: ImageFrame, image: FrameImageSize) {
    return { x: Math.round(frame.x * image.width), y: Math.round(frame.y * image.height), width: Math.max(1, Math.round(frame.width * image.width)), height: Math.max(1, Math.round(frame.height * image.height)) };
}

// Coordinates intentionally extend beyond 0..1: the same frame crops or expands.
export function resizeImageFrame(frame: ImageFrame, dx: number, dy: number, handle: FrameHandle, image: FrameImageSize, ratio: number | null): ImageFrame {
    const minW = 1 / image.width, minH = 1 / image.height;
    const west = handle.includes("w"), north = handle.includes("n"), horizontal = west || handle.includes("e"), vertical = north || handle.includes("s");
    let width = horizontal ? Math.max(minW, frame.width + (west ? -dx : dx)) : frame.width;
    let height = vertical ? Math.max(minH, frame.height + (north ? -dy : dy)) : frame.height;
    if (ratio) {
        const normalized = ratio * image.height / image.width;
        if (horizontal && (!vertical || Math.abs(dx * image.width) >= Math.abs(dy * image.height))) height = width / normalized;
        else width = height * normalized;
        const grow = Math.max(1, minW / width, minH / height); width *= grow; height *= grow;
    }
    return { ...frame, width, height, x: west ? frame.x + frame.width - width : !horizontal && ratio ? frame.x + (frame.width - width) / 2 : frame.x, y: north ? frame.y + frame.height - height : !vertical && ratio ? frame.y + (frame.height - height) / 2 : frame.y };
}

export function sizeImageFrame(frame: ImageFrame, image: FrameImageSize, width: number, height: number): ImageFrame {
    const w = Math.max(1, Math.round(width)) / image.width, h = Math.max(1, Math.round(height)) / image.height;
    return { ...frame, x: frame.x + (frame.width - w) / 2, y: frame.y + (frame.height - h) / 2, width: w, height: h };
}

export function fitFrameScene(frame: ImageFrame) {
    const left = Math.min(0, frame.x), top = Math.min(0, frame.y), right = Math.max(1, frame.x + frame.width), bottom = Math.max(1, frame.y + frame.height);
    const margin = Math.max(right - left, bottom - top) * 0.2;
    return { x: left - margin, y: top - margin, width: right - left + margin * 2, height: bottom - top + margin * 2 };
}
