import { getDataUrlByteSize } from "@/lib/image-utils";

const MB = 1024 * 1024;
const IMAGE_TARGET_BYTES = MB;
const REQUEST_TARGET_BYTES = 4 * MB;
const MAX_IMAGE_EDGE = 2048;
const isInlineImage = (value: string) => /^data:image\/[^;,]+;base64,/i.test(value);

// Only request-local copies are changed. Never write these values to image storage or nodes.
export async function prepareRelayReferences(references: string[], serialize: (images: string[]) => string, signal?: AbortSignal): Promise<string[]> {
    const prepared = [...references];
    const requestBytes = (images: string[]) => new Blob([serialize(images)]).size;
    const checkCancelled = () => { if (signal?.aborted) throw new DOMException("已取消提交", "AbortError"); };
    checkCancelled();
    if (!references.length || (requestBytes(prepared) <= REQUEST_TARGET_BYTES && prepared.every((image) => !isInlineImage(image) || getDataUrlByteSize(image) <= IMAGE_TARGET_BYTES))) return prepared;

    // Bundle the worker library with the app: compression must not depend on a public CDN.
    const [{ default: imageCompression }, { default: libURL }] = await Promise.all([
        import("browser-image-compression"),
        import("browser-image-compression/dist/browser-image-compression.js?url"),
    ]);
    const compress = async (index: number, targetBytes: number) => {
        checkCancelled();
        const source = references[index];
        const mime = source.slice(5, source.indexOf(";")).toLowerCase();
        if (!/^image\/(jpeg|jpg|png|webp|bmp)$/i.test(mime)) throw new Error(`第 ${index + 1} 张参考图不支持自动压缩，请转成 PNG、JPEG 或 WebP；原图未修改，任务未提交。`);
        const file = await imageCompression.getFilefromDataUrl(source, `reference-${index + 1}`);
        const options = { maxSizeMB: targetBytes / MB, fileType: /^image\/(bmp|jpg)$/i.test(mime) ? (mime.toLowerCase() === "image/bmp" ? "image/png" : "image/jpeg") : mime, useWebWorker: true, libURL: new URL(libURL, location.href).href, signal };
        let result = await imageCompression(file, { ...options, alwaysKeepResolution: true });
        checkCancelled();
        if (result.size > targetBytes) {
            const resized = await imageCompression(file, { ...options, maxWidthOrHeight: MAX_IMAGE_EDGE });
            if (resized.size < result.size) result = resized;
        }
        checkCancelled();
        if (result.size < getDataUrlByteSize(prepared[index])) prepared[index] = await imageCompression.getDataUrlFromFile(result);
        checkCancelled();
    };
    try {
        for (let index = 0; index < prepared.length; index++) {
            if (isInlineImage(prepared[index]) && getDataUrlByteSize(prepared[index]) > IMAGE_TARGET_BYTES) await compress(index, IMAGE_TARGET_BYTES);
        }
        if (requestBytes(prepared) > REQUEST_TARGET_BYTES) {
            // Budget actual JSON/UTF-8 bytes, including Base64 expansion, URI headers and prompt text.
            const fixedBytes = requestBytes(prepared.map((image) => isInlineImage(image) ? image.slice(0, image.indexOf(",") + 1) : image));
            const imageChars = prepared.reduce((sum, image) => sum + (isInlineImage(image) ? image.length - image.indexOf(",") - 1 : 0), 0);
            const available = REQUEST_TARGET_BYTES - fixedBytes;
            if (available > 0 && imageChars > 0) {
                const ratio = available / imageChars;
                for (let index = 0; index < prepared.length; index++) {
                    const image = prepared[index];
                    if (!isInlineImage(image)) continue;
                    const target = Math.min(IMAGE_TARGET_BYTES, Math.floor((image.length - image.indexOf(",") - 1) * ratio / 4) * 3);
                    if (target > 0 && getDataUrlByteSize(image) > target) await compress(index, target);
                }
            }
        }
    } catch (error) {
        checkCancelled();
        throw new Error(`参考图片自动压缩失败：${error instanceof Error ? error.message : String(error)}（原图未修改，任务未提交）`);
    }
    checkCancelled();
    if (requestBytes(prepared) > REQUEST_TARGET_BYTES) throw new Error("参考图片压缩后，请求总量仍超过 4MB，请减少参考图或缩短提示词；原图未修改，任务未提交。");
    if (prepared.some((image) => isInlineImage(image) && getDataUrlByteSize(image) > IMAGE_TARGET_BYTES)) throw new Error("参考图片压缩后，仍有单张超过 1MB，请减少图片尺寸后再试；原图未修改，任务未提交。");
    return prepared;
}
