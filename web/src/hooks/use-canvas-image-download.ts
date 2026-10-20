import { useCallback, useRef, useState } from "react";
import { App } from "antd";
import { saveAs } from "file-saver";
import { createCanvasImageZip } from "@/lib/canvas/canvas-batch-download";
import { canvasDownloadName } from "@/lib/canvas/canvas-download-name";
import type { CanvasNodeData } from "@/types/canvas";

export function useCanvasImageDownload() {
    const { message } = App.useApp(), busy = useRef(false), [downloading, setDownloading] = useState(false);
    const downloadImages = useCallback(async (selectedIds: Iterable<string>, nodes: CanvasNodeData[], title = "画布图片") => {
        if (busy.current) return;
        busy.current = true; setDownloading(true);
        try {
            const result = await createCanvasImageZip(selectedIds, nodes);
            if (!result.blob) { message.warning(result.skipped ? `没有可下载的图片（${result.skipped} 张图片缺失或读取失败）` : "没有可下载的图片"); return; }
            saveAs(result.blob, canvasDownloadName(title.replace(/\.zip$/i, ""), "", undefined, "zip"));
            if (result.skipped) message.warning(`已下载 ${result.count} 张图片，${result.skipped} 张缺失或读取失败已跳过`);
            else message.success(`已打包下载 ${result.count} 张图片`);
        } catch (error) { message.error(error instanceof Error ? `图片打包失败：${error.message}` : "图片打包失败，请重试"); }
        finally { busy.current = false; setDownloading(false); }
    }, [message]);
    return { downloading, downloadImages };
}
