import { useCallback, useRef, useState } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import "@/services/desktop-storage";
import { createZip } from "@/lib/zip";
import { collectCanvasImageFiles } from "@/lib/canvas/canvas-batch-download";
import { canvasDownloadName } from "@/lib/canvas/canvas-download-name";
import type { CanvasNodeData } from "@/types/canvas";

export function useCanvasImageDownload() {
    const { message } = App.useApp(), busy = useRef(false), [downloading, setDownloading] = useState(false);
    const downloadImages = useCallback(async (selectedIds: Iterable<string>, nodes: CanvasNodeData[], title = "画布图片") => {
        if (busy.current) return;
        busy.current = true; setDownloading(true);
        try {
            type Directory = { getFileHandle: (name: string, options: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }> }> };
            const picker = (window as unknown as { showDirectoryPicker?: () => Promise<Directory> }).showDirectoryPicker;
            const directory = !window.blinkflowDownloads && picker ? await picker.call(window) : null;
            const result = await collectCanvasImageFiles(selectedIds, nodes);
            if (!result.count) { message.warning(result.skipped ? `没有可下载的图片（${result.skipped} 张图片缺失或读取失败）` : "没有可下载的图片"); return; }
            if (window.blinkflowDownloads) {
                const saved = await window.blinkflowDownloads.saveImages(await Promise.all(result.files.map(async (file) => ({ name: file.name, data: await file.data.arrayBuffer() }))));
                if (saved.canceled) return;
            } else if (directory) {
                for (const file of result.files) { const handle = await directory.getFileHandle(file.name, { create: true }); const writer = await handle.createWritable(); await writer.write(file.data); await writer.close(); }
            } else {
                const blob = await createZip(result.files);
                const savePicker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
                const name = canvasDownloadName(title.replace(/\.zip$/i, ""), "", undefined, "zip");
                if (savePicker) { const handle = await savePicker.call(window, { suggestedName: name }); const writer = await handle.createWritable(); await writer.write(blob); await writer.close(); } else saveAs(blob, name);
            }
            if (result.skipped) message.warning(`已下载 ${result.count} 张图片，${result.skipped} 张缺失或读取失败已跳过`);
            else message.success(`已下载 ${result.count} 张图片`);
        } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; message.error(error instanceof Error ? `图片打包失败：${error.message}` : "图片打包失败，请重试"); }
        finally { busy.current = false; setDownloading(false); }
    }, [message]);
    return { downloading, downloadImages };
}
