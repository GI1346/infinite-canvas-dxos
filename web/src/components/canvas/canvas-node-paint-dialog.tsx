import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Alert, Button, InputNumber, Modal, Segmented, Slider } from "antd";
import { Redo2, RotateCcw, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { mergeImagePaint, renderImagePaint, type ImagePaintMode, type ImagePaintStroke } from "@/lib/canvas/canvas-image-paint";

export function CanvasNodePaintDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (dataUrl: string) => Promise<void> }) {
    const imageRef = useRef<HTMLImageElement>(null);
    const layerRef = useRef<HTMLCanvasElement>(null);
    const activeRef = useRef<{ pointerId: number; stroke: ImagePaintStroke } | null>(null);
    const strokesRef = useRef<ImagePaintStroke[]>([]);
    const redoRef = useRef<ImagePaintStroke[]>([]);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [mode, setMode] = useState<ImagePaintMode>("draw");
    const [color, setColor] = useState("#ff2424");
    const [textColor, setTextColor] = useState("#ffffff");
    const [size, setSize] = useState(12);
    const [opacity, setOpacity] = useState(100);
    const [number, setNumber] = useState(1);
    const [counts, setCounts] = useState({ undo: 0, redo: 0 });
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const viewport = useImageEditorViewport(image, open);
    const repaint = useCallback(() => {
        const layer = layerRef.current, context = layer?.getContext("2d");
        if (layer && context) renderImagePaint(context, [...strokesRef.current, ...(activeRef.current ? [activeRef.current.stroke] : [])], layer.width, layer.height);
        setCounts({ undo: strokesRef.current.length, redo: redoRef.current.length });
    }, []);
    useEffect(() => {
        if (!open) return;
        setImage(null); setMode("draw"); setColor("#ff2424"); setTextColor("#ffffff"); setSize(12); setOpacity(100); setNumber(1); setError("");
        strokesRef.current = []; redoRef.current = []; activeRef.current = null;
        setCounts({ undo: 0, redo: 0 });
    }, [dataUrl, open]);
    useEffect(() => repaint(), [image, repaint]);
    const undo = useCallback(() => {
        if (activeRef.current) return;
        const stroke = strokesRef.current.pop();
        if (stroke) redoRef.current.push(stroke);
        repaint();
    }, [repaint]);
    const redo = useCallback(() => {
        if (activeRef.current) return;
        const stroke = redoRef.current.pop();
        if (stroke) strokesRef.current.push(stroke);
        repaint();
    }, [repaint]);
    useEffect(() => {
        if (!open) return;
        const key = (event: KeyboardEvent) => {
            if ((event.target as Element | null)?.closest?.("input,textarea,[contenteditable='true']")) return;
            const name = event.key.toLowerCase();
            if (!(event.ctrlKey || event.metaKey) || event.altKey || !["z", "y"].includes(name)) return;
            event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
            if (name === "y" || event.shiftKey) redo(); else undo();
        };
        window.addEventListener("keydown", key, true);
        return () => window.removeEventListener("keydown", key, true);
    }, [open, undo, redo]);
    const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const canvas = event.currentTarget, box = canvas.getBoundingClientRect();
        return { x: Math.max(0, Math.min(canvas.width, (event.clientX - box.left) * canvas.width / Math.max(1, box.width))), y: Math.max(0, Math.min(canvas.height, (event.clientY - box.top) * canvas.height / Math.max(1, box.height))) };
    };
    const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        if (event.button !== 0 || viewport.spacePressed || saving) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        activeRef.current = { pointerId: event.pointerId, stroke: { mode, color, textColor, size, opacity, number, points: [point(event)] } };
        setError(""); repaint();
    };
    const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const active = activeRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (active.stroke.mode === "number") return;
        if (["draw", "erase"].includes(active.stroke.mode)) active.stroke.points.push(point(event));
        else active.stroke.points = [active.stroke.points[0], point(event)];
        repaint();
    };
    const stop = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const active = activeRef.current;
        if (!active || active.pointerId !== event.pointerId) return;
        if (event.type !== "pointercancel") {
            move(event);
            strokesRef.current.push(active.stroke); redoRef.current = [];
            if (active.stroke.mode === "number") setNumber(active.stroke.number + 1);
        }
        activeRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        repaint();
    };
    const save = async () => {
        if (!imageRef.current || !layerRef.current || !counts.undo || activeRef.current) return;
        setSaving(true); setError("");
        try { await onConfirm(mergeImagePaint(imageRef.current, layerRef.current)); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "保存画笔图片失败"); }
        finally { setSaving(false); }
    };
    return <Modal title="画笔" open={open} onCancel={saving ? undefined : onClose} closable={!saving} maskClosable={!saving} footer={null} width={1000} centered destroyOnHidden transitionName="" maskTransitionName="">
        <div data-canvas-no-zoom data-canvas-shortcuts-ignore className="space-y-4">
            <p className="text-sm opacity-60">自由绘画、箭头、序号和图形标注。保存为新图片，保留原图；橡皮仅擦除绘制内容。</p>
            {error ? <Alert type="error" title={error} /> : null}
            <div className="grid gap-5 md:grid-cols-[minmax(260px,1fr)_240px]">
                <div>
                    <div ref={viewport.viewportRef} {...viewport.panHandlers} className={`relative h-[440px] rounded-xl bg-black/5 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}>
                        <div className="relative" style={viewport.contentStyle}>
                            <div ref={viewport.stageRef} className="absolute" style={viewport.stageStyle}>
                                <img ref={imageRef} src={dataUrl} crossOrigin={/^https?:/i.test(dataUrl) ? "anonymous" : undefined} alt="画笔原图" draggable={false} className="absolute inset-0 h-full w-full object-contain" onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setError("图片加载失败，请重新导入原图")} />
                                {image ? <canvas ref={layerRef} width={image.width} height={image.height} aria-label="画笔绘制区域" className="absolute inset-0 h-full w-full touch-none" style={{ cursor: viewport.spacePressed ? "grab" : "crosshair" }} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={() => { if (activeRef.current) { activeRef.current = null; repaint(); } }} /> : null}
                            </div>
                        </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                            <Button type="text" aria-label="撤销绘制" icon={<Undo2 size={16} />} disabled={!counts.undo || saving} onClick={undo} />
                            <Button type="text" aria-label="重做绘制" icon={<Redo2 size={16} />} disabled={!counts.redo || saving} onClick={redo} />
                            <Button type="text" aria-label="缩小画笔视图" icon={<ZoomOut size={16} />} disabled={!viewport.canZoomOut} onClick={viewport.zoomOut} />
                            <button type="button" onClick={viewport.resetZoom}>{Math.round(viewport.zoom * 100)}%</button>
                            <Button type="text" aria-label="放大画笔视图" icon={<ZoomIn size={16} />} disabled={!viewport.canZoomIn} onClick={viewport.zoomIn} />
                        </div>
                        <span className="text-xs opacity-60">{image ? `${image.width} × ${image.height} px` : "加载中…"}</span>
                    </div>
                    <p className="mt-2 text-xs opacity-55">空格 + 左键平移，滚轮以指针为中心缩放；Ctrl/Cmd + Z 撤销，Shift + Z 重做。</p>
                </div>
                <div className="space-y-4">
                    <Segmented block value={mode} onChange={(value) => setMode(value as ImagePaintMode)} options={[{ label: "自由画笔", value: "draw" }, { label: "箭头", value: "arrow" }, { label: "序号", value: "number" }]} />
                    <Segmented block value={mode} onChange={(value) => setMode(value as ImagePaintMode)} options={[{ label: "矩形", value: "rectangle" }, { label: "圆形", value: "ellipse" }, { label: "橡皮", value: "erase" }]} />
                    <label className="flex items-center justify-between text-sm">画笔颜色<input aria-label="画笔颜色" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
                    <label className="block text-sm">画笔粗细：{size} px<Slider min={2} max={120} value={size} onChange={setSize} /></label>
                    <label className="block text-sm">不透明度：{opacity}%<Slider min={5} max={100} value={opacity} onChange={setOpacity} /></label>
                    {mode === "number" ? <>
                        <label className="flex items-center justify-between text-sm">当前序号<InputNumber aria-label="当前序号" min={0} precision={0} value={number} onChange={(value) => setNumber(value ?? 1)} /></label>
                        <label className="flex items-center justify-between text-sm">序号文字颜色<input aria-label="序号文字颜色" type="color" value={textColor} onChange={(event) => setTextColor(event.target.value)} /></label>
                    </> : null}
                    <Button type="text" icon={<RotateCcw size={16} />} disabled={!counts.undo || saving} onClick={() => { strokesRef.current = []; redoRef.current = []; repaint(); }}>清除全部绘制</Button>
                    <div className="flex gap-2 pt-4"><Button disabled={saving} onClick={onClose}>取消</Button><Button type="primary" loading={saving} disabled={!image || !counts.undo} onClick={() => void save()}>保存为新图片</Button></div>
                </div>
            </div>
        </div>
    </Modal>;
}
