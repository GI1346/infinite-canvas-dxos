import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Select } from "antd";
import { ZoomIn, ZoomOut } from "lucide-react";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { resizeImageFrame, type FrameHandle } from "@/lib/canvas/canvas-image-frame";
import { selectionRect } from "@/lib/canvas/canvas-local-fusion";
import { resolveImageUrl } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasCropRect, CanvasNodeData } from "@/types/canvas";

const ratios = ["自由", "1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9"];
const handles: FrameHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
type ImageSize = { width: number; height: number };

export function CanvasExtractSelectionDialog({ node, open, onClose, onConfirm }: { node: CanvasNodeData; open: boolean; onClose: () => void; onConfirm: (rect: CanvasCropRect, ratio?: string) => Promise<void> }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [image, setImage] = useState<ImageSize | null>(null), [url, setUrl] = useState("");
    const [rect, setRect] = useState<CanvasCropRect | null>(null), [ratio, setRatio] = useState("自由"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
    const drag = useRef<AbortController | null>(null), mounted = useRef(false), saving = useRef(false);
    const viewport = useImageEditorViewport(image, open);
    const ratioValue = ratio.includes(":") ? Number(ratio.split(":")[0]) / Number(ratio.split(":")[1]) : null;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; drag.current?.abort(); }; }, []);
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setRect(null); setRatio("自由"); setImage(null); setUrl(""); setError(""); setBusy(false);
        const source = new Image();
        source.onload = () => { if (!cancelled) setImage({ width: source.naturalWidth, height: source.naturalHeight }); };
        source.onerror = () => { if (!cancelled) setError("无法读取原图，请重新载入图片后再试"); };
        void resolveImageUrl(node.metadata?.storageKey, node.metadata?.content || "").then((value) => { if (!cancelled) { setUrl(value); source.src = value; } }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
        return () => { cancelled = true; source.onload = null; source.onerror = null; drag.current?.abort(); };
    }, [node.id, node.metadata?.content, node.metadata?.storageKey, open]);
    const startDrag = (event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>, mode: "draw" | "move" | FrameHandle) => {
        if (event.button !== 0 || viewport.spacePressed || !image || busy) return;
        const box = viewport.stageRef.current?.getBoundingClientRect();
        if (!box?.width || !box.height) return;
        event.preventDefault(); event.stopPropagation(); drag.current?.abort();
        const controller = new AbortController(); drag.current = controller;
        const point = (clientX: number, clientY: number) => ({ x: Math.max(0, Math.min(image.width, (clientX - box.left) / box.width * image.width)), y: Math.max(0, Math.min(image.height, (clientY - box.top) / box.height * image.height)) });
        const start = point(event.clientX, event.clientY), base = rect;
        let latest = rect;
        if (mode === "draw") { latest = null; setRect(null); }
        const move = (next: PointerEvent) => {
            const cursor = point(next.clientX, next.clientY);
            if (mode === "draw") {
                if (cursor.x === start.x || cursor.y === start.y) return;
                latest = selectionRect({ x: Math.min(start.x, cursor.x), y: Math.min(start.y, cursor.y), width: Math.abs(cursor.x - start.x), height: Math.abs(cursor.y - start.y) }, image.width, image.height, ratio);
            } else if (base && mode === "move") {
                latest = { ...base, x: Math.round(Math.max(0, Math.min(image.width - base.width, base.x + cursor.x - start.x))), y: Math.round(Math.max(0, Math.min(image.height - base.height, base.y + cursor.y - start.y))) };
            } else if (base && mode !== "move") {
                const frame = resizeImageFrame({ x: base.x / image.width, y: base.y / image.height, width: base.width / image.width, height: base.height / image.height }, (cursor.x - start.x) / image.width, (cursor.y - start.y) / image.height, mode, image, ratioValue);
                latest = selectionRect({ x: frame.x * image.width, y: frame.y * image.height, width: frame.width * image.width, height: frame.height * image.height }, image.width, image.height, ratio);
            }
            setRect(latest);
        };
        const finish = () => { controller.abort(); drag.current = null; };
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", finish, { signal: controller.signal, once: true });
        document.addEventListener("pointercancel", () => { setRect(base); finish(); }, { signal: controller.signal, once: true });
    };
    const confirm = async () => {
        if (!rect || saving.current) return;
        saving.current = true; setBusy(true); setError("");
        try { await onConfirm(rect, ratio === "自由" ? undefined : ratio); }
        catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { saving.current = false; if (mounted.current) setBusy(false); }
    };
    return <Modal title="提取选区" open={open} onCancel={() => { if (!busy) onClose(); }} footer={null} width={940} centered destroyOnHidden transitionName="" maskTransitionName="" maskClosable={!busy} closable={!busy}>
        <div data-canvas-overlay data-canvas-no-zoom className="space-y-3">
            <p className="text-xs opacity-65">在原图内框选局部区域。提取时四周外扩 10% 保留上下文，原图不变；局部改图后可连接融合节点回贴。</p>
            <div ref={viewport.viewportRef} {...viewport.panHandlers} data-extract-viewport className={`relative h-[min(60vh,620px)] min-h-[300px] rounded-lg ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : "cursor-crosshair"}`} style={{ background: theme.canvas.background }}>
                <div className="relative" style={viewport.contentStyle}>
                    <div ref={viewport.stageRef} data-extract-stage className="absolute isolate select-none" style={viewport.stageStyle} onPointerDown={(event) => startDrag(event, "draw")}>
                        {url && <img src={url} alt="提取选区原图" draggable={false} className="pointer-events-none h-full w-full" />}
                        {rect && image && <div data-extract-frame className="absolute cursor-move border-2" style={{ left: `${rect.x / image.width * 100}%`, top: `${rect.y / image.height * 100}%`, width: `${rect.width / image.width * 100}%`, height: `${rect.height / image.height * 100}%`, borderColor: theme.canvas.selectionStroke, boxShadow: "0 0 0 9999px rgba(0,0,0,.32)" }} onPointerDown={(event) => startDrag(event, "move")}>
                            {handles.map((handle) => <button key={handle} type="button" data-extract-handle={handle} aria-label={`调整选区 ${handle}`} className="absolute size-3 rounded-full border" style={{ ...handlePosition(handle), background: theme.node.panel, borderColor: theme.canvas.selectionStroke }} onPointerDown={(event) => startDrag(event, handle)} />)}
                        </div>}
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1">
                <Button type="text" aria-label="缩小选区预览" icon={<ZoomOut className="size-4" />} disabled={!viewport.canZoomOut || busy} onClick={viewport.zoomOut} />
                <button type="button" className="min-w-14 text-xs tabular-nums" onClick={viewport.resetZoom}>{Math.round(viewport.zoom * 100)}%</button>
                <Button type="text" aria-label="放大选区预览" icon={<ZoomIn className="size-4" />} disabled={!viewport.canZoomIn || busy} onClick={viewport.zoomIn} />
                <span className="ml-2 text-xs opacity-60">滚轮缩放 · 空格 + 左键 / 中键平移</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs">比例</span><Select aria-label="提取选区比例" value={ratio} disabled={busy} className="w-28" options={ratios.map((value) => ({ label: value, value }))} onChange={(value) => { setRatio(value); if (rect && image) setRect(selectionRect(rect, image.width, image.height, value)); }} />
                <span className="flex-1 text-xs opacity-60">{image ? `原图 ${image.width} × ${image.height}` : "正在读取图片…"}{rect ? ` · 选区 ${rect.width} × ${rect.height}` : " · 左键拖出选区"}</span>
                <Button disabled={busy} onClick={() => setRect(null)}>重选</Button><Button disabled={busy} onClick={onClose}>取消</Button><Button type="primary" disabled={!rect || !image} loading={busy} onClick={() => void confirm()}>提取选区</Button>
            </div>
            {error && <p role="alert" className="text-sm" style={{ color: theme.node.text }}>{error}</p>}
        </div>
    </Modal>;
}

function handlePosition(handle: FrameHandle) {
    return { left: handle.includes("w") ? "0%" : handle.includes("e") ? "100%" : "50%", top: handle.includes("n") ? "0%" : handle.includes("s") ? "100%" : "50%", transform: "translate(-50%, -50%)", cursor: `${handle}-resize` };
}