export type ImagePaintMode = "draw" | "arrow" | "number" | "rectangle" | "ellipse" | "erase";
export type ImagePaintPoint = { x: number; y: number };
export type ImagePaintStroke = { mode: ImagePaintMode; color: string; textColor: string; size: number; opacity: number; number: number; points: ImagePaintPoint[] };

// DX paint semantics: annotations live on a transparent layer, then merge with the original.
export function renderImagePaint(context: CanvasRenderingContext2D, strokes: ImagePaintStroke[], width: number, height: number) {
    context.clearRect(0, 0, width, height);
    for (const stroke of strokes) {
        const first = stroke.points[0], last = stroke.points.at(-1);
        if (!first || !last) continue;
        context.save();
        context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
        context.globalAlpha = stroke.opacity / 100;
        context.strokeStyle = context.fillStyle = stroke.color;
        context.lineWidth = stroke.size;
        context.lineCap = context.lineJoin = "round";
        context.beginPath();
        if (stroke.mode === "number") {
            const radius = Math.max(12, stroke.size * 1.5);
            context.arc(first.x, first.y, radius, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = stroke.textColor;
            context.font = `bold ${radius * 1.3}px sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(String(stroke.number), first.x, first.y);
        } else if (stroke.mode === "rectangle") {
            context.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
        } else if (stroke.mode === "ellipse") {
            context.ellipse((first.x + last.x) / 2, (first.y + last.y) / 2, Math.max(0.5, Math.abs(last.x - first.x) / 2), Math.max(0.5, Math.abs(last.y - first.y) / 2), 0, 0, Math.PI * 2);
            context.stroke();
        } else if (stroke.mode === "arrow") {
            context.moveTo(first.x, first.y);
            context.lineTo(last.x, last.y);
            context.stroke();
            const angle = Math.atan2(last.y - first.y, last.x - first.x), head = Math.max(12, stroke.size * 3);
            context.beginPath();
            context.moveTo(last.x, last.y);
            context.lineTo(last.x - head * Math.cos(angle - Math.PI / 6), last.y - head * Math.sin(angle - Math.PI / 6));
            context.lineTo(last.x - head * Math.cos(angle + Math.PI / 6), last.y - head * Math.sin(angle + Math.PI / 6));
            context.closePath();
            context.fill();
        } else if (stroke.points.length === 1) {
            context.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
            context.fill();
        } else {
            context.moveTo(first.x, first.y);
            for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
            context.stroke();
        }
        context.restore();
    }
}

export function mergeImagePaint(image: HTMLImageElement, layer: HTMLCanvasElement) {
    const output = document.createElement("canvas");
    output.width = image.naturalWidth;
    output.height = image.naturalHeight;
    const context = output.getContext("2d");
    if (!context) throw new Error("无法创建画笔画布");
    context.drawImage(image, 0, 0);
    context.drawImage(layer, 0, 0, output.width, output.height);
    return output.toDataURL("image/png");
}
