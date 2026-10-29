import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, parsePixelSize } from "@/lib/media-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

// Agent and UI use the same presets. A ratio is not a request size by itself.
export function assistantImageParameters(patch: CanvasNodeMetadata, current: CanvasNodeMetadata, config: AiConfig): CanvasNodeMetadata {
    if (patch.size === undefined && patch.imageAspectRatio === undefined && patch.imageResolution === undefined) return patch;
    const resolution = patch.imageResolution?.trim().toLowerCase();
    if (resolution && !["auto", "1k", "2k", "4k"].includes(resolution)) throw new Error("imageResolution 必须是 auto、1k、2k 或 4k");
    const size = patch.size?.trim().toLowerCase().replace("×", "x");
    const pixels = size && parsePixelSize(size);
    if (pixels && (pixels.width <= 0 || pixels.height <= 0)) throw new Error("图片像素宽高必须大于零");
    if (size && size !== "auto" && !parsePixelSize(size) && !mediaRatioOptions.some((item) => item.value === size)) throw new Error("size 必须是像素宽x高、支持的比例或 auto");
    const ratio = patch.imageAspectRatio?.trim() || (size ? inferMediaRatio(size) : current.size ? inferMediaRatio(current.size) : current.imageAspectRatio || inferMediaRatio(config.size));
    if (!mediaRatioOptions.some((item) => item.value === ratio)) throw new Error(`不支持的图片比例：${ratio}`);
    const scale = resolution || (size && parsePixelSize(size) ? inferMediaScale(size) : current.imageResolution || config.imageResolution || inferMediaScale(current.size || config.size));
    if (size && parsePixelSize(size) && patch.imageAspectRatio && inferMediaRatio(size) !== ratio) throw new Error("size 与 imageAspectRatio 冲突，请先明确一致的生成尺寸");
    return { ...patch, imageResolution: scale.toLowerCase(), imageAspectRatio: ratio, size: size && parsePixelSize(size) ? size : computeMediaSize(scale, ratio) };
}

// Only unambiguous, explicit single-size requirements can override a tool plan.
// Mixed page ratios (e.g. 5 square + 9 portrait images) remain per-node plans.
export function explicitAssistantImageRequirements(text: string): CanvasNodeMetadata {
    const plain = text.replace(/@\[(?:node|model):[^\]]+\]/g, "");
    const positive = (index: number) => !/(不要|不是|别用|不用|参考)[^，。,；;\n]*$/.test(plain.slice(0, index));
    const unique = (pattern: RegExp) => [...new Set([...plain.matchAll(pattern)].filter((match) => positive(match.index!)).map((match) => match[1].replace(/\s/g, "").replace("：", ":").replace(/[×X]/g, "x").toLowerCase()))];
    const ratios = unique(/(?<![\d:：])(\d+\s*[:：]\s*\d+)(?![\d:：])/g), scales = unique(/(?<![\da-z])(1\s*k|2\s*k|4\s*k)(?![\da-z])/gi), sizes = unique(/(?<!\d)(\d{3,5}\s*[xX×]\s*\d{3,5})(?!\d)/g);
    return { ...(ratios.length === 1 && mediaRatioOptions.some((item) => item.value === ratios[0]) ? { imageAspectRatio: ratios[0] } : {}), ...(scales.length === 1 ? { imageResolution: scales[0] } : {}), ...(sizes.length === 1 ? { size: sizes[0] } : {}) };
}
