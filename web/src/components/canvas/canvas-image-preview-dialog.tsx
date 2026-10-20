import { wheelZoomFactor } from "@/stores/use-canvas-navigation-store";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal } from "antd";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type View = { x: number; y: number; k: number };
const fitted: View = { x: 0, y: 0, k: 1 };

export function CanvasImagePreviewDialog({ dataUrl, title, open, onClose }: { dataUrl: string; title: string; open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [image, setImage] = useState({ width: 0, height: 0 });
    const [failed, setFailed] = useState(false);
    const [view, setView] = useState(fitted);
    const viewRef = useRef(view);
    const pan = useRef<{ id: number; x: number; y: number } | null>(null);
    const [panning, setPanning] = useState(false);
    const change = useCallback((next: View) => { viewRef.current = next; setView(next); }, []);
    const endPan = useCallback(() => {
        const pointer = pan.current;
        pan.current = null;
        if (pointer && viewport?.hasPointerCapture(pointer.id)) viewport.releasePointerCapture(pointer.id);
        setPanning(false);
    }, [viewport]);
    const reset = useCallback(() => { endPan(); change(fitted); }, [change, endPan]);

    useLayoutEffect(() => {
        change(fitted); pan.current = null; setPanning(false); setFailed(false);
        const img = imageRef.current;
        setImage({ width: img?.complete ? img.naturalWidth : 0, height: img?.complete ? img.naturalHeight : 0 });
    }, [dataUrl, open, change]);
    useLayoutEffect(() => {
        if (!open || !viewport) return;
        const measure = () => {
            setSize({ width: viewport.clientWidth, height: viewport.clientHeight });
            reset();
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [open, viewport, reset]);
    useEffect(() => {
        if (!open) return;
        window.addEventListener("blur", endPan);
        return () => { window.removeEventListener("blur", endPan); endPan(); };
    }, [open, endPan]);

    const ready = image.width > 0 && image.height > 0 && size.width > 0 && size.height > 0;
    const fit = ready ? Math.min(size.width / image.width, size.height / image.height, 1) : 0;
    const zoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
        if (!viewport || !ready) return;
        const current = viewRef.current;
        // Same scale bounds and wheel curve as the main canvas.
        const k = Math.min(5, Math.max(0.05, current.k * factor));
        const rect = viewport.getBoundingClientRect();
        const x = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
        const y = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
        change({ x: x - (x - current.x) * k / current.k, y: y - (y - current.y) * k / current.k, k });
    }, [viewport, ready, change]);
    useEffect(() => {
        if (!open || !viewport) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault(); event.stopPropagation();
            if (event.deltaY) zoom(wheelZoomFactor(event.deltaY), event.clientX, event.clientY);
        };
        viewport.addEventListener("wheel", wheel, { passive: false });
        return () => viewport.removeEventListener("wheel", wheel);
    }, [open, viewport, zoom]);

    const start = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || !ready) return;
        event.preventDefault(); event.stopPropagation();
        pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId); setPanning(true);
    };
    const move = (event: ReactPointerEvent<HTMLDivElement>) => {
        const previous = pan.current;
        if (!previous || previous.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        const current = viewRef.current;
        change({ ...current, x: current.x + event.clientX - previous.x, y: current.y + event.clientY - previous.y });
        pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    return <Modal title={t("canvas.projectPage.imageDetails")} open={open} onCancel={onClose} footer={null} centered width="min(960px, calc(100vw - 32px))" destroyOnHidden
        modalRender={(modal) => <div data-canvas-overlay data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>{modal}</div>}>
        <div ref={setViewport} data-image-preview-viewport className="relative h-[min(70vh,760px)] w-full overflow-hidden select-none" style={{ background: theme.canvas.background, touchAction: "none", cursor: panning ? "grabbing" : "grab" }}
            onPointerDown={start} onPointerMove={move} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} onDragStart={(event) => event.preventDefault()}>
            <img ref={imageRef} src={dataUrl} alt={title} draggable={false} data-image-preview-media className="pointer-events-none absolute max-w-none" onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} onError={() => setFailed(true)}
                style={{ left: "50%", top: "50%", width: image.width * fit, height: image.height * fit, visibility: ready && !failed ? "visible" : "hidden", transform: `translate(${view.x}px, ${view.y}px) translate(-50%, -50%) scale(${view.k})`, transformOrigin: "center" }} />
            {failed ? <div role="alert" className="absolute inset-0 flex items-center justify-center text-sm">图片加载失败，请关闭后重试</div> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button type="text" aria-label="缩小预览图片" disabled={!ready || view.k <= 0.05} icon={<ZoomOut size={16} />} onClick={() => zoom(1 / 1.1)} />
            <span data-image-preview-scale className="min-w-14 text-center text-xs tabular-nums">{Math.round(fit * view.k * 100)}%</span>
            <Button type="text" aria-label="放大预览图片" disabled={!ready || view.k >= 5} icon={<ZoomIn size={16} />} onClick={() => zoom(1.1)} />
            <Button type="text" icon={<Maximize size={16} />} onClick={reset}>适应窗口</Button>
            <span data-image-resolution className="text-xs tabular-nums">{image.width > 0 && image.height > 0 ? `${image.width} × ${image.height} px` : ""}</span>
            <span className="text-xs opacity-60">滚轮缩放 · 左键拖动</span>
        </div>
    </Modal>;
}
