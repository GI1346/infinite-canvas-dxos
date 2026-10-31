import { fetchImageBlob } from "@/services/image-storage";
import type { ReferenceImage } from "@/types/image";

export type ImageEditMode = "region" | "whole" | "expand" | "angle";
export type EditorRect = { x: number; y: number; width: number; height: number };
export type EditorLayer = {
    id: string;
    name: string;
    url: string;
    width: number;
    height: number;
    visible: boolean;
    prompt?: string;
    model?: string;
};
export type EditorEditParams = {
    mode: ImageEditMode;
    prompt: string;
    rect?: EditorRect;
    outputWidth: number;
    outputHeight: number;
    horizontalAngle: number;
    pitchAngle: number;
};

function surface(width: number, height: number) {
    if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("图片尺寸必须为正整数像素");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context || canvas.width !== width || canvas.height !== height) throw new Error("无法创建图片编辑画布，请缩小图片后重试");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    return { canvas, context };
}

async function readBitmap(url: string) {
    if (!url?.trim()) throw new Error("图片内容为空");
    const bitmap = await createImageBitmap(await fetchImageBlob(url));
    if (!bitmap.width || !bitmap.height) {
        bitmap.close();
        throw new Error("图片尺寸无效");
    }
    return bitmap;
}

async function png(canvas: HTMLCanvasElement) {
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片导出失败，请缩小图片后重试")), "image/png");
    });
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" && reader.result.startsWith("data:image/png") ? resolve(reader.result) : reject(new Error("图片读取失败"));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.onabort = () => reject(new Error("图片读取已取消"));
        reader.readAsDataURL(blob);
    });
}

function validRect(rect: EditorRect | undefined, width: number, height: number): EditorRect {
    if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) throw new Error("请先框选有效的修改区域");
    const x = Math.max(0, Math.round(rect.x));
    const y = Math.max(0, Math.round(rect.y));
    const right = Math.min(width, Math.round(rect.x + rect.width));
    const bottom = Math.min(height, Math.round(rect.y + rect.height));
    if (right <= x || bottom <= y) throw new Error("选区不在图片范围内，请重新框选");
    return { x, y, width: right - x, height: bottom - y };
}

const reference = (dataUrl: string): ReferenceImage => ({ id: "image-editor-source", name: "image-editor-source.png", type: "image/png", dataUrl });
const resultUrl = (url: string) => {
    if (!url?.trim()) throw new Error("模型没有返回图片，请检查模型是否支持图像编辑");
    return url;
};

/** Prepare only the outgoing reference; never replace the canvas's original image. */
export async function prepareEditorEdit(source: string, params: EditorEditParams): Promise<{ references: ReferenceImage[]; prompt: string; finish: (generated: string) => Promise<string> }> {
    const bitmap = await readBitmap(source);
    try {
        const { width, height } = bitmap;
        const original = surface(width, height);
        original.context.drawImage(bitmap, 0, 0);
        const instruction = params.prompt.trim();
        if (params.mode === "region") {
            if (!instruction) throw new Error("请填写选区修改要求");
            const rect = validRect(params.rect, width, height);
            const crop = surface(rect.width, rect.height);
            crop.context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            return {
                references: [reference(await png(crop.canvas))],
                prompt: `对参考图片中这一精确选区进行局部修改。只编辑所给区域，不扩大画面，不添加边框，不裁剪或拉伸；保留与修改无关的结构、文字、材质和光影，输出保持 ${rect.width}:${rect.height} 比例。修改要求：${instruction}`,
                finish: async (generated) => {
                    const edited = await readBitmap(resultUrl(generated));
                    try {
                        if (Math.abs(edited.width / edited.height / (rect.width / rect.height) - 1) > 0.01) throw new Error(`模型返回的局部图比例不符合选区（选区 ${rect.width}×${rect.height}，结果 ${edited.width}×${edited.height}），未回贴，请按选区比例重新生成`);
                        const patch = surface(rect.width, rect.height);
                        patch.context.drawImage(edited, 0, 0, rect.width, rect.height);
                        const output = surface(width, height);
                        output.context.putImageData(original.context.getImageData(0, 0, width, height), 0, 0);
                        output.context.putImageData(patch.context.getImageData(0, 0, rect.width, rect.height), rect.x, rect.y);
                        return await png(output.canvas);
                    } finally {
                        edited.close();
                    }
                },
            };
        }
        if (params.mode === "expand") {
            const expanded = surface(params.outputWidth, params.outputHeight);
            if (params.outputWidth < width || params.outputHeight < height) throw new Error(`扩图尺寸不能小于原图 ${width}×${height}，扩图不裁剪原图`);
            if (params.outputWidth === width && params.outputHeight === height) throw new Error("请增大输出宽度或高度后再扩图");
            const x = Math.floor((params.outputWidth - width) / 2);
            const y = Math.floor((params.outputHeight - height) / 2);
            expanded.context.drawImage(bitmap, x, y);
            return {
                references: [reference(await png(expanded.canvas))],
                prompt: `将参考图向透明的四周自然延展，输出画幅 ${params.outputWidth}:${params.outputHeight}。原始图片位于新画布的 (${x}, ${y})，原图尺寸 ${width}×${height}，不得改变、裁切、移动或重绘原图内容，只补全周围新出现的区域，延续透视、光线、材质和场景。${instruction ? `扩图要求：${instruction}` : "自然延续已有背景，不添加无关主体和文字。"}`,
                finish: async (generated) => {
                    const edited = await readBitmap(resultUrl(generated));
                    try {
                        if (Math.abs(edited.width / edited.height / (params.outputWidth / params.outputHeight) - 1) > 0.01) throw new Error(`模型返回的扩图比例不符（期望 ${params.outputWidth}×${params.outputHeight}，结果 ${edited.width}×${edited.height}），原图和现有图层未修改`);
                        const output = surface(params.outputWidth, params.outputHeight);
                        output.context.drawImage(edited, 0, 0, output.canvas.width, output.canvas.height);
                        // Preserve even transparent source pixels instead of alpha-blending a regenerated original.
                        output.context.putImageData(original.context.getImageData(0, 0, width, height), x, y);
                        return await png(output.canvas);
                    } finally {
                        edited.close();
                    }
                },
            };
        }
        if (params.mode === "angle") {
            if (![params.horizontalAngle, params.pitchAngle].every(Number.isFinite)) throw new Error("相机角度无效");
            return {
                references: [reference(await png(original.canvas))],
                prompt: `基于参考图进行真实的相机视角重建：相机绕主体水平旋转 ${params.horizontalAngle}°，俯仰角 ${params.pitchAngle}°。正水平角为从主体正面向右侧观察，正俯仰角为从上方向下观察，0°表示相应方向保持参考视角。保持同一主体的真实外形、结构、颜色、材质和零部件关系；不是将整张照片做平面旋转、倾斜或透视拉伸。无法确认的结构不得凭空添加。${instruction ? `其他要求：${instruction}` : "保持背景和光影一致，突出真实自然的产品视角。"}`,
                finish: async (generated) => resultUrl(generated),
            };
        }
        if (params.mode !== "whole") throw new Error("不支持的图像编辑模式");
        if (!instruction) throw new Error("请填写整图编辑要求");
        return {
            references: [reference(await png(original.canvas))],
            prompt: `根据参考图进行整图编辑，严格保持未要求改变的主体、产品结构、颜色、材质和可见细节，避免无关改动。编辑要求：${instruction}`,
            finish: async (generated) => resultUrl(generated),
        };
    } finally {
        bitmap.close();
    }
}

/** Layers are topmost-first; every layer is a full-document raster snapshot. */
export async function composeEditorLayers(layers: EditorLayer[], width: number, height: number): Promise<string> {
    const output = surface(width, height);
    for (const layer of [...layers].reverse()) {
        if (!layer.visible) continue;
        const bitmap = await readBitmap(layer.url);
        try {
            output.context.drawImage(bitmap, 0, 0, width, height);
        } finally {
            bitmap.close();
        }
    }
    return png(output.canvas);
}

/** PSD retains raster layer names, order and visibility, with an explicitly rendered composite. */
export async function exportEditorPsd(layers: EditorLayer[], width: number, height: number): Promise<ArrayBuffer> {
    const { writePsd } = await import("ag-psd");
    const output = surface(width, height);
    const children: Array<{ name: string; canvas: HTMLCanvasElement; hidden: boolean }> = [];
    try {
        for (const layer of layers) {
            const bitmap = await readBitmap(layer.url);
            try {
                const raster = surface(width, height);
                raster.context.drawImage(bitmap, 0, 0, width, height);
                children.push({ name: layer.name, canvas: raster.canvas, hidden: !layer.visible });
            } finally {
                bitmap.close();
            }
        }
        for (const layer of [...children].reverse()) if (!layer.hidden) output.context.drawImage(layer.canvas, 0, 0);
        return writePsd({ width, height, canvas: output.canvas, children });
    } finally {
        for (const layer of children) layer.canvas.width = layer.canvas.height = 0;
        output.canvas.width = output.canvas.height = 0;
    }
}