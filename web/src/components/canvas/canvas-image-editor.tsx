import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App, Button, Checkbox, Input, Slider, Tooltip } from "antd";
import { ArrowDown, ArrowLeft, ArrowUp, BoxSelect, Copy, Download, Eraser, Eye, EyeOff, Hand, Layers, Maximize, Save, Send, Square, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { ModelPicker } from "@/components/model-picker";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasDownloadName, canvasTitleWithoutExtension } from "@/lib/canvas/canvas-download-name";
import { buildGenerationConfig } from "@/lib/canvas/canvas-generation-helpers";
import { composeEditorLayers, exportEditorPsd, prepareEditorEdit, type EditorLayer, type EditorRect, type ImageEditMode } from "@/lib/canvas/canvas-image-editor";
import { imageSizePresets, inferMediaScale, mediaRatioOptions, mediaScaleOptions, parsePixelSize } from "@/lib/media-size";
import { requestEdit } from "@/services/api/image";
import { fetchImageBlob } from "@/services/image-storage";
import "@/services/desktop-storage";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import { useImageEditorViewport } from "./use-image-editor-viewport";

type ImageSize = { width: number; height: number };
type SaveData = { url: string; name: string; prompt?: string; model?: string };
type Props = { node: CanvasNodeData; onClose: () => void; onSave: (data: SaveData) => Promise<void>; readCopiedImages?: (data: DataTransfer) => ReferenceImage[] };
const modes: Array<{ value: ImageEditMode; label: string }> = [{ value: "region", label: "区域修改" }, { value: "whole", label: "整图编辑" }, { value: "expand", label: "扩图" }, { value: "angle", label: "转角度" }];
const qualities = [{ value: "auto", label: "自动" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }, { value: "xhigh", label: "极高" }, { value: "max", label: "最高" }];
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

async function raster(url: string, width: number, height: number, centered = false) {
    const bitmap = await createImageBitmap(await fetchImageBlob(url));
    try {
        if (!centered && Math.abs(bitmap.width / bitmap.height / (width / height) - 1) > 0.01) throw new Error(`模型输出比例不符（${bitmap.width}×${bitmap.height}），未加入图层，请按工作区比例重新生成`);
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context || canvas.width !== width || canvas.height !== height) throw new Error("无法创建图片编辑画布，请缩小图片后重试");
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
        if (centered) context.drawImage(bitmap, Math.floor((width - bitmap.width) / 2), Math.floor((height - bitmap.height) / 2));
        else context.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片导出失败")), "image/png"));
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败"));
            reader.onerror = () => reject(new Error("图片读取失败")); reader.onabort = () => reject(new Error("图片读取已取消")); reader.readAsDataURL(blob);
        });
    } finally { bitmap.close(); }
}

function requestSize(size: ImageSize, resolution: string) {
    if (resolution === "auto") return `${size.width}x${size.height}`;
    const presets = imageSizePresets[resolution];
    const match = mediaRatioOptions.find((ratio) => ratio.width && Math.abs(size.width / size.height / (ratio.width / ratio.height) - 1) <= 0.01);
    if (match && presets?.[match.value]) return presets[match.value];
    const base = parsePixelSize(presets?.["1:1"] || `${size.width}x${size.height}`)!;
    const scale = Math.max(base.width, base.height) / Math.max(size.width, size.height);
    return `${Math.max(1, Math.round(size.width * scale))}x${Math.max(1, Math.round(size.height * scale))}`;
}

function referenceFile(file: File): Promise<ReferenceImage> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" && reader.result.startsWith("data:image/") ? resolve({ id: nanoid(), name: file.name || "粘贴图片", type: file.type, dataUrl: reader.result }) : reject(new Error("参考图片读取失败"));
        reader.onerror = () => reject(new Error("参考图片读取失败")); reader.onabort = () => reject(new Error("参考图片读取已取消")); reader.readAsDataURL(file);
    });
}

export function CanvasImageEditor({ node, onClose, onSave, readCopiedImages }: Props) {
    const { message, modal } = App.useApp();
    const config = useEffectiveConfig();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const initial = buildGenerationConfig(config, node, "image");
    const [model, setModel] = useState(initial.model);
    const [resolution, setResolution] = useState(() => inferMediaScale(initial.size, initial.imageResolution));
    const [quality, setQuality] = useState(initial.quality);
    const [mode, setMode] = useState<ImageEditMode>("region");
    const [tool, setTool] = useState<"move" | "select">("select");
    const [size, setSize] = useState<ImageSize | null>(null);
    const [layers, setLayers] = useState<EditorLayer[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [activeId, setActiveId] = useState("");
    const [preview, setPreview] = useState("");
    const [previewBusy, setPreviewBusy] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [rect, setRect] = useState<EditorRect | undefined>();
    const [ratio, setRatio] = useState("auto");
    const [outputWidth, setOutputWidth] = useState(0);
    const [outputHeight, setOutputHeight] = useState(0);
    const [horizontalAngle, setHorizontalAngle] = useState(0);
    const [pitchAngle, setPitchAngle] = useState(0);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState("");
    const [dirty, setDirty] = useState(false);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const mounted = useRef(true);
    const busyRef = useRef(false);
    const controllerRef = useRef<AbortController | null>(null);
    const viewportElement = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<{ id: number; x: number; y: number; scrollLeft?: number; scrollTop?: number } | null>(null);
    const viewport = useImageEditorViewport(size, true);
    const bindViewport = useCallback((element: HTMLDivElement | null) => { viewportElement.current = element; viewport.viewportRef(element); }, [viewport.viewportRef]);
    const active = layers.find((layer) => layer.id === activeId);
    const generating = Boolean(controllerRef.current);
    const fieldStyle: CSSProperties = { background: theme.node.panel, color: theme.node.text, border: `1px solid ${theme.node.stroke}`, borderRadius: 8, padding: "6px 8px", minWidth: 0, width: "100%" };
    const panelStyle: CSSProperties = { background: theme.node.panel, border: `1px solid ${theme.node.stroke}`, borderRadius: 14, padding: 14 };
    const canGenerate = Boolean(size && layers.some((layer) => layer.visible) && model && (mode !== "region" || rect?.width) && (prompt.trim() || mode === "expand" || mode === "angle"));

    useEffect(() => {
        mounted.current = true;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialogRef.current?.focus();
        return () => { mounted.current = false; controllerRef.current?.abort(); if (previousFocus?.isConnected) previousFocus.focus(); };
    }, []);
    useEffect(() => {
        let canceled = false;
        const content = node.metadata?.content;
        if (!content) { setError("原图内容为空，请重新打开有效图片"); return; }
        void (async () => {
            const bitmap = await createImageBitmap(await fetchImageBlob(content));
            try {
                if (canceled) return;
                const dimensions = { width: bitmap.width, height: bitmap.height };
                const id = nanoid();
                setSize(dimensions); setOutputWidth(dimensions.width); setOutputHeight(dimensions.height);
                setLayers([{ id, name: canvasTitleWithoutExtension(node.title) || "原图", url: content, ...dimensions, visible: true }]);
                setSelected([id]); setActiveId(id); setDirty(false);
            } finally { bitmap.close(); }
        })().catch((failure) => { if (!canceled) setError(failure instanceof Error ? failure.message : "原图读取失败"); });
        return () => { canceled = true; };
    }, [node.id, node.metadata?.content]);
    useEffect(() => {
        if (!size || !layers.length) return;
        let canceled = false; setPreviewBusy(true);
        void composeEditorLayers(layers, size.width, size.height).then((url) => { if (!canceled) setPreview(url); }).catch((failure) => { if (!canceled) setError(failure instanceof Error ? failure.message : "图层预览失败"); }).finally(() => { if (!canceled) setPreviewBusy(false); });
        return () => { canceled = true; };
    }, [layers, size]);

    const exit = () => {
        if (busyRef.current) { void message.info("请先停止生成或等待当前操作完成"); return; }
        if (!dirty) { onClose(); return; }
        modal.confirm({ zIndex: 1300, title: "关闭图像编辑？", content: "未保存到画布的编辑和图层会丢失，原图片不会改变。", okText: "放弃编辑并关闭", cancelText: "继续编辑", onOk: onClose });
    };
    const local = async (label: string, operation: () => Promise<void>) => {
        if (busyRef.current) return;
        busyRef.current = true; setBusy(label); setError("");
        try { await operation(); }
        catch (failure) { if (mounted.current && !(failure instanceof DOMException && failure.name === "AbortError")) setError(failure instanceof Error ? failure.message : `${label}失败`); }
        finally { busyRef.current = false; if (mounted.current) setBusy(""); }
    };
    const pasteReferences = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        if (busyRef.current) return;
        const data = event.clipboardData;
        const files = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
        if (files.length) {
            event.preventDefault();
            void local("读取参考图", async () => {
                const added = await Promise.all(files.map(referenceFile));
                if (mounted.current) { setReferences((value) => [...value, ...added]); setDirty(true); }
            });
            return;
        }
        const copied = readCopiedImages?.(data) || [];
        if (!copied.length) return;
        event.preventDefault();
        setReferences((value) => [...value, ...copied.map((reference) => ({ ...reference, id: nanoid() }))]); setDirty(true);
    };
    const mutateLayers = (next: EditorLayer[]) => { if (busyRef.current) return; setLayers(next); setDirty(true); };
    const saveComposite = () => local("保存到画布", async () => {
        if (!size || !layers.some((layer) => layer.visible)) throw new Error("请至少显示一个图层后再保存");
        const url = await composeEditorLayers(layers, size.width, size.height);
        await onSave({ url, name: `${canvasTitleWithoutExtension(node.title) || "图片"}·编辑结果`, prompt: active?.prompt, model: active?.model });
        if (mounted.current) { setDirty(false); void message.success("已另存到画布，原图片保留"); }
    });
    const saveLayer = (layer: EditorLayer) => local("保存图层", async () => { await onSave({ url: layer.url, name: layer.name, prompt: layer.prompt, model: layer.model }); if (mounted.current) void message.success("图层已另存到画布"); });
    const download = (layer: EditorLayer) => local("下载图层", async () => {
        const blob = await fetchImageBlob(layer.url); const name = canvasDownloadName(layer.name, layer.url, blob.type, "png");
        if (window.blinkflowDownloads) await window.blinkflowDownloads.saveImages([{ name, data: await blob.arrayBuffer() }]);
        else saveAs(blob, name);
    });
    const psd = () => local("导出 PSD", async () => {
        if (!size) return;
        const data = await exportEditorPsd(layers, size.width, size.height);
        const name = canvasDownloadName(`${canvasTitleWithoutExtension(node.title) || "图片"}·编辑图层`, "", undefined, "psd");
        if (window.blinkflowDownloads) {
            const saved = await window.blinkflowDownloads.saveImages([{ name, data }]);
            if (saved.canceled) return;
            if (!saved.count) throw new Error("PSD 未保存，请重试");
            if (mounted.current) void message.success(saved.directory ? `PSD 已保存到 ${saved.directory}` : "PSD 已保存");
        } else {
            saveAs(new Blob([data], { type: "image/vnd.adobe.photoshop" }), name);
            if (mounted.current) void message.success("已发起 PSD 下载");
        }
    });
    const merge = () => local("合并所选图层", async () => {
        if (!size) return;
        const chosen = layers.filter((layer) => selected.includes(layer.id) && layer.visible);
        if (chosen.length < 2) throw new Error("请勾选至少两个可见图层再合并");
        const url = await composeEditorLayers(chosen, size.width, size.height);
        const id = nanoid(); const merged: EditorLayer = { id, name: "合并图层", url, ...size, visible: true };
        const ids = new Set(chosen.map((layer) => layer.id)); const position = layers.findIndex((layer) => ids.has(layer.id));
        const next = layers.filter((layer) => !ids.has(layer.id)); next.splice(position, 0, merged);
        if (mounted.current) { setLayers(next); setSelected([id]); setActiveId(id); setDirty(true); }
    });
    const reorder = (id: string, direction: number) => {
        const index = layers.findIndex((layer) => layer.id === id), target = index + direction;
        if (target < 0 || target >= layers.length) return;
        const next = [...layers]; [next[index], next[target]] = [next[target], next[index]]; mutateLayers(next);
    };
    const remove = (id: string) => {
        if (layers.length <= 1 || busyRef.current) return;
        const next = layers.filter((layer) => layer.id !== id); mutateLayers(next);
        setSelected((value) => value.filter((item) => item !== id)); if (activeId === id) setActiveId(next[0].id);
    };
    const generate = async () => {
        if (busyRef.current || !size || !canGenerate) return;
        const liveConfig = { ...useConfigStore.getState().config, channelMode: "local" as const };
        if (!selectableModelsByCapability(liveConfig, "image").includes(model) || !useConfigStore.getState().isAiConfigReady(liveConfig, model)) { setError("所选模型或渠道已失效，请重新选择可用的生图模型"); return; }
        if (mode === "expand" && (!Number.isSafeInteger(outputWidth) || !Number.isSafeInteger(outputHeight) || outputWidth < size.width || outputHeight < size.height || (outputWidth === size.width && outputHeight === size.height))) { setError(`扩图宽高须为整数且不小于原图 ${size.width}×${size.height}，至少增大一边`); return; }
        const controller = new AbortController(); controllerRef.current = controller; busyRef.current = true; setBusy("正在生成"); setError("");
        const check = () => { if (controller.signal.aborted || !mounted.current) throw new DOMException("已停止生成", "AbortError"); };
        try {
            const source = await composeEditorLayers(layers, size.width, size.height); check();
            const output = mode === "expand" ? { width: outputWidth, height: outputHeight } : size;
            const prepared = await prepareEditorEdit(source, { mode, prompt, rect, outputWidth: output.width, outputHeight: output.height, horizontalAngle, pitchAngle }); check();
            const target = mode === "region" && rect ? rect : output;
            const requestConfig = { ...buildGenerationConfig(liveConfig, node, "image"), model, quality, imageResolution: resolution, size: requestSize(target, resolution), count: "1" };
            const requestPrompt = references.length ? `${prepared.prompt}\n参考图1是本次待编辑的${mode === "region" ? "精确选区" : "底图"}；参考图2起为补充参考素材，仅按修改要求使用，不替换待编辑底图。` : prepared.prompt;
            const results = await requestEdit(requestConfig, requestPrompt, [...prepared.references, ...references], { signal: controller.signal }); check();
            if (!results[0]?.dataUrl) throw new Error("模型没有返回图片，请检查所选模型是否支持图像编辑");
            let url = await prepared.finish(results[0].dataUrl); check();
            if (mode === "whole" || mode === "angle") url = await raster(url, size.width, size.height); check();
            const baseLayers = mode === "expand" ? await Promise.all(layers.map(async (layer) => ({ ...layer, ...output, url: await raster(layer.url, output.width, output.height, true) }))) : layers; check();
            const id = nanoid(); const result: EditorLayer = { id, name: `${modes.find((item) => item.value === mode)!.label}·结果`, url, ...output, visible: true, prompt, model };
            setLayers([result, ...baseLayers.map((layer) => ({ ...layer, visible: false }))]); setSelected([id]); setActiveId(id); setDirty(true);
            if (mode === "expand") { setSize(output); setRect(undefined); }
            void message.success("已生成新图层，点击“保存到画布”另存结果");
        } catch (failure) { if (mounted.current) setError(controller.signal.aborted ? "已停止生成，现有图层和原图未修改。" : failure instanceof Error ? failure.message : "图像编辑失败"); }
        finally { controllerRef.current = null; busyRef.current = false; if (mounted.current) setBusy(""); }
    };

    const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || viewport.spacePressed || viewport.isPanning) return;
        if (tool === "move") {
            const element = viewportElement.current; if (!element) return;
            dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: element.scrollLeft, scrollTop: element.scrollTop };
        } else {
            if (busyRef.current || mode !== "region" || !size) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = clamp(Math.floor((event.clientX - bounds.left) / bounds.width * size.width), 0, size.width - 1);
            const y = clamp(Math.floor((event.clientY - bounds.top) / bounds.height * size.height), 0, size.height - 1);
            dragRef.current = { id: event.pointerId, x, y }; setRect(undefined);
        }
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    };
    const resizeSelection = (event: PointerEvent<HTMLButtonElement>, right: boolean, bottom: boolean) => {
        event.preventDefault(); event.stopPropagation();
        const stage = viewport.stageRef.current;
        if (event.button !== 0 || busyRef.current || mode !== "region" || tool !== "select" || viewport.spacePressed || viewport.isPanning || !rect || !stage) return;
        dragRef.current = { id: event.pointerId, x: right ? rect.x : rect.x + rect.width, y: bottom ? rect.y : rect.y + rect.height };
        stage.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current; if (!drag || drag.id !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (drag.scrollLeft !== undefined && drag.scrollTop !== undefined) {
            const element = viewportElement.current; if (element) { element.scrollLeft = drag.scrollLeft - (event.clientX - drag.x); element.scrollTop = drag.scrollTop - (event.clientY - drag.y); } return;
        }
        if (!size || busyRef.current || mode !== "region") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const pointX = clamp(Math.round((event.clientX - bounds.left) / bounds.width * size.width), 0, size.width);
        const pointY = clamp(Math.round((event.clientY - bounds.top) / bounds.height * size.height), 0, size.height);
        let width = Math.abs(pointX - drag.x), height = Math.abs(pointY - drag.y);
        const aspect = mediaRatioOptions.find((item) => item.value === ratio);
        if (aspect?.width) {
            const r = aspect.width / aspect.height;
            if (width / Math.max(1, height) > r) height = width / r; else width = height * r;
            const maxWidth = pointX >= drag.x ? size.width - drag.x : drag.x;
            const maxHeight = pointY >= drag.y ? size.height - drag.y : drag.y;
            const scale = Math.min(1, maxWidth / Math.max(1, width), maxHeight / Math.max(1, height)); width *= scale; height *= scale;
        }
        width = Math.round(width); height = Math.round(height);
        if (width && height) setRect({ x: pointX >= drag.x ? drag.x : drag.x - width, y: pointY >= drag.y ? drag.y : drag.y - height, width, height });
    };
    const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.id !== event.pointerId) return;
        event.stopPropagation(); dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    const iconButton = (label: string, icon: ReactNode, action: () => void, disabled = false) => <Tooltip title={label} zIndex={1300}><Button aria-label={label} title={label} type="text" size="small" icon={icon} onClick={action} disabled={Boolean(busy) || disabled} /></Tooltip>;

    return createPortal(
        <div ref={dialogRef} tabIndex={-1} data-canvas-image-editor data-canvas-overlay data-canvas-no-zoom role="dialog" aria-modal="true" aria-label="图像编辑" className="fixed inset-0 flex flex-col text-sm" style={{ zIndex: 1100, background: theme.canvas.background, color: theme.node.text }} onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== "Tab") return;
                const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex='0']") || []).filter((element) => element.getClientRects().length);
                const first = controls[0], last = controls[controls.length - 1];
                if (!first) { event.preventDefault(); return; }
                if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
            }} onKeyUp={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                <div className="flex min-w-0 items-center gap-3"><Button icon={<ArrowLeft size={16} />} onClick={exit}>返回画布</Button><div className="min-w-0"><strong>图像编辑</strong><div className="truncate text-xs" style={{ color: theme.node.muted, maxWidth: 260 }}>{canvasTitleWithoutExtension(node.title) || "图片"}{size ? ` · ${size.width} × ${size.height}` : ""}</div></div></div>
                <nav className="flex flex-wrap gap-1">{modes.map((item) => <Button key={item.value} type={mode === item.value ? "primary" : "text"} disabled={Boolean(busy)} onClick={() => { setMode(item.value); setTool(item.value === "region" ? "select" : "move"); }}>{item.label}</Button>)}</nav>
                <div className="flex shrink-0 gap-2"><Button disabled={Boolean(busy) || !layers.length} icon={<Layers size={15} />} onClick={() => void psd()}>导出 PSD</Button><Button type="primary" disabled={Boolean(busy) || !layers.length} icon={<Save size={15} />} onClick={() => void saveComposite()}>保存到画布</Button></div>
            </header>
            <div className="flex min-h-0 flex-1">
                <aside className="flex w-20 shrink-0 flex-col items-center gap-3 border-r py-4" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                    <Button type={tool === "move" ? "primary" : "text"} icon={<Hand size={18} />} onClick={() => setTool("move")}>移动</Button>
                    <Button type={tool === "select" ? "primary" : "text"} disabled={Boolean(busy) || mode !== "region"} icon={<BoxSelect size={18} />} onClick={() => setTool("select")}>框选</Button>
                    <Button type="text" disabled={Boolean(busy) || !rect} icon={<Eraser size={18} />} onClick={() => setRect(undefined)}>清空</Button>
                    <div className="mt-auto flex flex-col items-center gap-3"><Button type="text" aria-label="放大" disabled={!viewport.canZoomIn} icon={<ZoomIn size={18} />} onClick={viewport.zoomIn} /><span className="text-xs">{Math.round(viewport.zoom * 100)}%</span><Button type="text" aria-label="缩小" disabled={!viewport.canZoomOut} icon={<ZoomOut size={18} />} onClick={viewport.zoomOut} /><Button type="text" aria-label="适合工作区" title="适合工作区" icon={<Maximize size={18} />} onClick={viewport.resetZoom} /></div>
                </aside>
                <main className="flex min-w-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 p-3">
                        <div ref={bindViewport} className={`relative h-full w-full rounded-xl ${viewport.scrollClassName}`} style={{ background: theme.node.fill, touchAction: "none" }} {...viewport.panHandlers}>
                            <div className="relative" style={viewport.contentStyle}>
                                <div ref={viewport.stageRef} className="absolute select-none" style={{ ...viewport.stageStyle, cursor: viewport.isPanning || viewport.spacePressed || tool === "move" ? "grab" : "crosshair" }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onLostPointerCapture={(event) => { if (event.target === event.currentTarget) dragRef.current = null; }}>
                                    {preview && <img src={preview} alt="编辑工作区" draggable={false} className="pointer-events-none block h-full w-full" />}
                                    {rect && size && mode === "region" && <div className="pointer-events-none absolute" style={{ left: `${rect.x / size.width * 100}%`, top: `${rect.y / size.height * 100}%`, width: `${rect.width / size.width * 100}%`, height: `${rect.height / size.height * 100}%`, border: "2px solid #2563eb", background: "rgba(37, 99, 235, 0.14)" }}>
                                        <span className="absolute left-0 top-0 whitespace-nowrap px-1 text-xs" style={{ background: theme.node.panel, color: theme.node.text }}>{rect.width} × {rect.height}</span>
                                        {[[false, false], [true, false], [false, true], [true, true]].map(([right, bottom]) => <button key={`${right}-${bottom}`} type="button" tabIndex={-1} aria-label={`调整选区${bottom ? "下" : "上"}${right ? "右" : "左"}角`} disabled={Boolean(busy) || tool !== "select"} onPointerDown={(event) => resizeSelection(event, right, bottom)} style={{ pointerEvents: "auto", position: "absolute", left: right ? "100%" : 0, top: bottom ? "100%" : 0, width: 14, height: 14, padding: 0, border: "2px solid #172554", borderRadius: "50%", background: "#2563eb", transform: "translate(-50%, -50%)", cursor: right === bottom ? "nwse-resize" : "nesw-resize" }} />)}
                                    </div>}
                                </div>
                            </div>
                            {!size && <div className="pointer-events-none absolute inset-0 flex items-center justify-center">正在读取原图…</div>}
                            {previewBusy && size && <div className="pointer-events-none absolute right-3 top-3 rounded px-2 py-1 text-xs" style={{ background: theme.node.panel }}>正在更新预览…</div>}
                        </div>
                    </div>
                    <section className="mx-3 mb-3 shrink-0" style={panelStyle}>
                        {error && <div role="alert" className="mb-2 max-h-24 overflow-auto whitespace-pre-wrap rounded border px-3 py-2" style={{ borderColor: theme.node.activeStroke }}>{error}</div>}
                        {references.length > 0 && <div className="mb-2 flex max-h-24 flex-wrap gap-2 overflow-y-auto" aria-label="补充参考图">{references.map((reference, index) => <div key={reference.id} className="flex items-center gap-2 rounded border p-1" style={{ borderColor: theme.node.stroke }} title={reference.name}>
                            <img src={reference.dataUrl || reference.url} alt={reference.name} draggable={false} className="h-10 w-10 rounded object-contain" /><span className="text-xs">参考图{index + 2}</span><Button type="text" size="small" aria-label={`移除参考图${index + 2}`} disabled={Boolean(busy)} icon={<Trash2 size={13} />} onClick={() => { setReferences((value) => value.filter((item) => item.id !== reference.id)); setDirty(true); }} />
                        </div>)}</div>}
                        <p className="mb-2 mt-0 text-xs" style={{ color: theme.node.muted }}>第一张是待编辑{mode === "region" ? "选区" : "底图"}；可在输入框粘贴图片作为后续补充参考，原图和图层不受影响。</p>
                        <Input.TextArea aria-label="图像编辑要求" value={prompt} disabled={Boolean(busy)} onPaste={pasteReferences} onChange={(event) => { setPrompt(event.target.value); setDirty(true); }} autoSize={{ minRows: 2, maxRows: 5 }} placeholder={mode === "region" ? "先框选需要修改的区域，再输入修改要求；选区外像素保持不变" : mode === "expand" ? "描述需要延展的背景，原图在中央保留" : mode === "angle" ? "可补充视角、背景和主体要求；视角由模型重建" : "描述需要对整张图片进行的修改"} />
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            <fieldset disabled={Boolean(busy)} className="min-w-36 flex-1" style={{ pointerEvents: busy ? "none" : undefined }}><ModelPicker config={config} value={model} onChange={setModel} capability="image" groupByChannel fullWidth /></fieldset>
                            <label className="flex items-center gap-2 text-xs">分辨率<select aria-label="分辨率" style={{ ...fieldStyle, width: 85 }} value={resolution} disabled={Boolean(busy)} onChange={(event) => setResolution(event.target.value as typeof resolution)}>{mediaScaleOptions.map((value) => <option key={value} value={value}>{value === "auto" ? "自动" : value.toUpperCase()}</option>)}</select></label>
                            <label className="flex items-center gap-2 text-xs">质量<select aria-label="质量" style={{ ...fieldStyle, width: 82 }} value={quality} disabled={Boolean(busy)} onChange={(event) => setQuality(event.target.value)}>{qualities.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                            <span className="text-xs" style={{ color: theme.node.muted }}>1 张 · 生成后保持工作区像素尺寸</span>
                            {generating ? <Button danger icon={<Square size={15} />} onClick={() => controllerRef.current?.abort()}>停止生成</Button> : <Button type="primary" icon={<Send size={15} />} disabled={Boolean(busy) || !canGenerate} onClick={() => void generate()}>{busy || "生成新图层"}</Button>}
                        </div>
                    </section>
                </main>
                <aside className="w-80 shrink-0 overflow-y-auto border-l p-3" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                    <section style={panelStyle}>
                        <strong>工具参数</strong>
                        <p className="mt-2 text-xs leading-5" style={{ color: theme.node.muted }}>{mode === "region" ? "框选精确修改范围，结果自动回贴，选区以外保持原像素。" : mode === "whole" ? "整张图片作为参考，生成独立结果图层，不覆盖原图。" : mode === "expand" ? "居中保留原图，只扩展四周；输出宽高均不得小于原图。" : "通过生图模型重建视角，并非平面旋转。未展示的结构仍需核对。"}</p>
                        {mode === "region" && <><label className="mt-3 block text-xs">选区比例<select aria-label="选区比例" className="mt-2" style={fieldStyle} value={ratio} disabled={Boolean(busy)} onChange={(event) => { setRatio(event.target.value); setRect(undefined); }}>{mediaRatioOptions.map((item) => <option key={item.value} value={item.value}>{item.value === "auto" ? "自由框选" : item.value}</option>)}</select></label><div className="mt-2 text-xs" style={{ color: theme.node.muted }}>{rect ? `位置 ${rect.x}, ${rect.y} · ${rect.width} × ${rect.height} 像素` : "尚未选择区域"}</div></>}
                        {mode === "expand" && <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-xs">输出宽度<input aria-label="扩图输出宽度" type="number" step={1} min={size?.width || 1} style={fieldStyle} disabled={Boolean(busy)} value={outputWidth || ""} onChange={(event) => setOutputWidth(Number(event.target.value))} /></label><label className="text-xs">输出高度<input aria-label="扩图输出高度" type="number" step={1} min={size?.height || 1} style={fieldStyle} disabled={Boolean(busy)} value={outputHeight || ""} onChange={(event) => setOutputHeight(Number(event.target.value))} /></label></div>}
                        {mode === "angle" && <div className="mt-3"><label className="text-xs">水平角度 {horizontalAngle}°<Slider min={-60} max={60} value={horizontalAngle} disabled={Boolean(busy)} onChange={setHorizontalAngle} /></label><label className="text-xs">俯仰角度 {pitchAngle}°<Slider min={-45} max={45} value={pitchAngle} disabled={Boolean(busy)} onChange={setPitchAngle} /></label></div>}
                        <Button className="mt-3 w-full" icon={<Maximize size={14} />} onClick={viewport.resetZoom}>适合工作区</Button><p className="mb-0 mt-2 text-xs" style={{ color: theme.node.muted }}>按住空格或鼠标中键可平移；编辑只影响此工作区，保存时新建画布节点。</p>
                    </section>
                    <section className="mt-3" style={panelStyle}>
                        <div className="mb-3 flex items-center justify-between"><strong className="flex items-center gap-2"><Layers size={16} />图层</strong><Button size="small" disabled={Boolean(busy) || layers.filter((layer) => selected.includes(layer.id) && layer.visible).length < 2} onClick={() => void merge()}>合并所选</Button></div>
                        <div className="flex flex-col gap-2">{layers.map((layer, index) => <div key={layer.id} className="rounded-xl border p-2" style={{ borderColor: activeId === layer.id ? theme.node.activeStroke : theme.node.stroke, background: activeId === layer.id ? theme.toolbar.activeBg : theme.node.panel }} onClick={() => { if (!busy) setActiveId(layer.id); }}>
                            <div className="flex items-center gap-2"><Checkbox aria-label={`选中${layer.name}`} checked={selected.includes(layer.id)} disabled={Boolean(busy)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, layer.id] : value.filter((id) => id !== layer.id))} /><img src={layer.url} alt={layer.name} className="h-12 w-12 rounded object-contain" style={{ background: theme.node.fill }} draggable={false} /><div className="min-w-0 flex-1"><div className="break-words text-xs font-medium">{layer.name}</div><div className="text-xs" style={{ color: theme.node.muted }}>{layer.width} × {layer.height}</div></div></div>
                            <div className="mt-2 flex flex-wrap items-center gap-1">
                                {iconButton(layer.visible ? "隐藏图层" : "显示图层", layer.visible ? <Eye size={14} /> : <EyeOff size={14} />, () => mutateLayers(layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item)))}
                                {iconButton("上移图层", <ArrowUp size={14} />, () => reorder(layer.id, -1), index === 0)}
                                {iconButton("下移图层", <ArrowDown size={14} />, () => reorder(layer.id, 1), index === layers.length - 1)}
                                {iconButton("复制图层", <Copy size={14} />, () => { const id = nanoid(); const next = [...layers]; next.splice(index, 0, { ...layer, id, name: `${layer.name}·副本` }); mutateLayers(next); setSelected([id]); setActiveId(id); })}
                                {iconButton("下载图层", <Download size={14} />, () => void download(layer))}
                                {iconButton("另存图层到画布", <Save size={14} />, () => void saveLayer(layer))}
                                {iconButton("删除图层", <Trash2 size={14} />, () => remove(layer.id), layers.length <= 1)}
                            </div>
                        </div>)}</div><p className="mb-0 mt-3 text-xs" style={{ color: theme.node.muted }}>上方图层覆盖下方图层；PSD 保留图层顺序和显隐。关闭后不保留未保存的编辑图层。</p>
                    </section>
                </aside>
            </div>
        </div>, document.body,
    );
}
