import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Checkbox, Input, InputNumber, Modal, Select, Tooltip } from "antd";
import { Check, Redo2, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { fitFrameScene, framePixels, fullImageFrame, resizeImageFrame, sizeImageFrame, type FrameHandle, type ImageFrame } from "@/lib/canvas/canvas-image-frame";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageCropRect = ImageFrame;
const handles: FrameHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const ratios = ["自由", "原图", "1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16"];
type History = { frames: ImageFrame[]; index: number };

export function CanvasNodeCropDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (crop: CanvasImageCropRect) => void }) {
    const theme = canvasThemes[useThemeStore((s) => s.theme)];
    const [history, setHistory] = useState<History>({ frames: [fullImageFrame], index: 0 });
    const [preview, setPreview] = useState<ImageFrame | null>(null);
    const [preset, setPreset] = useState("自由");
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [scene, setScene] = useState(() => fitFrameScene(fullImageFrame));
    const [error, setError] = useState("");
    const dragAbortRef = useRef<AbortController | null>(null);
    const frame = preview || history.frames[history.index];
    const sceneSize = image ? { width: image.width * scene.width, height: image.height * scene.height } : null;
    const viewport = useImageEditorViewport(sceneSize, open);
    const pixels = image ? framePixels(frame, image) : null;
    const ratio = preset === "原图" && image ? image.width / image.height : preset.includes(":") ? Number(preset.split(":")[0]) / Number(preset.split(":")[1]) : null;
    const expanding = frame.x < 0 || frame.y < 0 || frame.x + frame.width > 1.000001 || frame.y + frame.height > 1.000001;
    const commit = (next: ImageFrame) => {
        setHistory((current) => {
            if (JSON.stringify(current.frames[current.index]) === JSON.stringify(next)) return current;
            return { frames: [...current.frames.slice(0, current.index + 1), next], index: current.index + 1 };
        });
        setPreview(null);
    };
    const reset = () => { commit({ ...fullImageFrame }); setPreset("自由"); setScene(fitFrameScene(fullImageFrame)); };
    const fit = (next = frame) => setScene(fitFrameScene(next));

    useEffect(() => {
        if (!open) return;
        setHistory({ frames: [{ ...fullImageFrame }], index: 0 }); setPreview(null); setPreset("自由"); setScene(fitFrameScene(fullImageFrame)); setImage(null); setError("");
        const source = new Image();
        source.onload = () => setImage({ width: source.naturalWidth || source.width, height: source.naturalHeight || source.height });
        source.onerror = () => setError("无法读取图片，请重新载入后再试");
        source.src = dataUrl;
        return () => { source.onload = null; source.onerror = null; dragAbortRef.current?.abort(); };
    }, [dataUrl, open]);

    const startDrag = (event: ReactPointerEvent, handle?: FrameHandle) => {
        if (event.button !== 0 || viewport.spacePressed || !image) return;
        const box = viewport.stageRef.current?.getBoundingClientRect();
        if (!box?.width || !box.height) return;
        event.preventDefault(); event.stopPropagation(); dragAbortRef.current?.abort();
        const controller = new AbortController(); dragAbortRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, frame };
        let next = frame;
        const move = (e: PointerEvent) => {
            const dx = (e.clientX - start.x) / box.width * scene.width, dy = (e.clientY - start.y) / box.height * scene.height;
            next = handle ? resizeImageFrame(start.frame, dx, dy, handle, image, ratio) : { ...start.frame, x: start.frame.x + dx, y: start.frame.y + dy };
            setPreview(next);
        };
        const finish = () => { commit(next); fit(next); controller.abort(); };
        const cancel = () => { setPreview(null); controller.abort(); };
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", finish, { signal: controller.signal });
        document.addEventListener("pointercancel", cancel, { signal: controller.signal });
    };
    const frameStyle = (rect: ImageFrame) => ({ left: `${(rect.x - scene.x) / scene.width * 100}%`, top: `${(rect.y - scene.y) / scene.height * 100}%`, width: `${rect.width / scene.width * 100}%`, height: `${rect.height / scene.height * 100}%` });
    const resizePixels = (axis: "width" | "height", value: number | null) => {
        if (!image || !pixels || value === null || !Number.isFinite(value)) return;
        let width = axis === "width" ? value : pixels.width, height = axis === "height" ? value : pixels.height;
        if (ratio) { if (axis === "width") height = width / ratio; else width = height * ratio; }
        const next = sizeImageFrame(frame, image, width, height); commit(next); fit(next);
    };

    return <Modal title="裁剪 / 扩图" open={open && Boolean(dataUrl)} onCancel={onClose} footer={null} width={880} centered destroyOnHidden transitionName="" maskTransitionName="">
        <div className="space-y-3">
            <p className="text-xs opacity-65">缩小边框裁剪，向原图外拖动边框扩图。扩图区域填充所选背景，不调用 AI 或消耗 API 额度。</p>
            <div ref={viewport.viewportRef} {...viewport.panHandlers} data-crop-viewport className={`relative h-[min(58vh,580px)] min-h-[300px] rounded-lg ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`} style={{ background: theme.canvas.background }}>
                <div className="relative" style={viewport.contentStyle}>
                    <div ref={viewport.stageRef} data-crop-scene className="absolute isolate select-none" style={{ ...viewport.stageStyle, backgroundColor: theme.node.panel, backgroundImage: `repeating-conic-gradient(${theme.node.stroke} 0% 25%, transparent 0% 50%)`, backgroundSize: "16px 16px" }}>
                        <div className="pointer-events-none absolute" style={{ ...frameStyle(frame), background: frame.background || "transparent" }} />
                        <img src={dataUrl} alt="原始图片" draggable={false} className="pointer-events-none absolute" style={frameStyle(fullImageFrame)} />
                        <div data-crop-frame className="absolute cursor-move border-2" style={{ ...frameStyle(frame), borderColor: theme.canvas.selectionStroke, boxShadow: "0 0 0 9999px rgba(0,0,0,.32)" }} onPointerDown={(event) => startDrag(event)}>
                            {[1, 2].map((i) => <div key={i} className="pointer-events-none absolute inset-0"><div className="absolute inset-x-0 border-t" style={{ top: `${i / 3 * 100}%`, borderColor: theme.node.stroke }} /><div className="absolute inset-y-0 border-l" style={{ left: `${i / 3 * 100}%`, borderColor: theme.node.stroke }} /></div>)}
                            {handles.map((handle) => <button key={handle} type="button" data-crop-handle={handle} aria-label={`调整裁剪扩图 ${handle}`} className="absolute size-3 rounded-full border" style={{ background: theme.node.panel, borderColor: theme.canvas.selectionStroke, ...handleStyle(handle) }} onPointerDown={(event) => startDrag(event, handle)} />)}
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1">
                <Tooltip title="缩小"><Button type="text" aria-label="缩小裁剪预览" icon={<ZoomOut className="size-4" />} disabled={!viewport.canZoomOut} onClick={viewport.zoomOut} /></Tooltip>
                <button type="button" className="min-w-14 text-xs tabular-nums" onClick={viewport.resetZoom}>{Math.round(viewport.zoom * 100)}%</button>
                <Tooltip title="放大"><Button type="text" aria-label="放大裁剪预览" icon={<ZoomIn className="size-4" />} disabled={!viewport.canZoomIn} onClick={viewport.zoomIn} /></Tooltip>
                <Button type="text" onClick={() => fit()}>适应选区</Button>
                <span className="ml-2 text-xs opacity-60">滚轮缩放 · 空格 + 左键 / 中键平移</span>
            </div>
            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3" style={{ borderColor: theme.toolbar.border }}>
                <label className="space-y-1"><span className="block text-xs">比例</span><Select aria-label="裁剪扩图比例" className="w-28" value={preset} options={ratios.map((r) => ({ label: r, value: r }))} onChange={(next) => {
                    setPreset(next);
                    if (!image || next === "自由") return;
                    const r = next === "原图" ? image.width / image.height : Number(next.split(":")[0]) / Number(next.split(":")[1]);
                    const nextFrame = sizeImageFrame(frame, image, frame.width * image.width, frame.width * image.width / r); commit(nextFrame); fit(nextFrame);
                }} /></label>
                <label className="space-y-1"><span className="block text-xs">输出宽度 px</span><InputNumber aria-label="裁剪扩图输出宽度" min={1} precision={0} value={pixels?.width} disabled={!image} onChange={(v) => resizePixels("width", v)} /></label>
                <label className="space-y-1"><span className="block text-xs">输出高度 px</span><InputNumber aria-label="裁剪扩图输出高度" min={1} precision={0} value={pixels?.height} disabled={!image} onChange={(v) => resizePixels("height", v)} /></label>
                <label className="space-y-1"><span className="block text-xs">扩图背景</span><Input aria-label="裁剪扩图背景颜色" type="color" className="!w-12" value={frame.background === "transparent" ? "#ffffff" : frame.background || "#ffffff"} onChange={(e) => commit({ ...frame, background: e.target.value })} /></label>
                <Checkbox checked={!frame.background || frame.background === "transparent"} onChange={(e) => commit({ ...frame, background: e.target.checked ? "transparent" : "#ffffff" })}>透明背景</Checkbox>
                <span className="text-xs opacity-60">{image ? `原图 ${image.width} × ${image.height} · ${expanding ? "扩图" : "裁剪"}` : "正在读取图片…"}</span>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1"><Button type="text" aria-label="撤销裁剪扩图" disabled={history.index === 0} icon={<Undo2 className="size-4" />} onClick={() => { const next = history.frames[history.index - 1]; setHistory({ ...history, index: history.index - 1 }); fit(next); }} /><Button type="text" aria-label="重做裁剪扩图" disabled={history.index === history.frames.length - 1} icon={<Redo2 className="size-4" />} onClick={() => { const next = history.frames[history.index + 1]; setHistory({ ...history, index: history.index + 1 }); fit(next); }} /><Button onClick={reset}>恢复原图选区</Button></div>
                <div className="flex gap-2"><Button icon={<X className="size-4" />} onClick={onClose}>取消</Button><Button type="primary" icon={<Check className="size-4" />} disabled={!image || Boolean(error)} onClick={() => onConfirm(frame)}>确认裁剪 / 扩图</Button></div>
            </div>
        </div>
    </Modal>;
}

function handleStyle(handle: FrameHandle) {
    const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    return { top, left, cursor: `${handle}-resize` };
}
