const mediaExtensions: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/tiff": "tif",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/opus": "opus", "audio/flac": "flac", "audio/pcm": "pcm",
};
const extensionPattern = /\.(png|jpe?g|webp|gif|avif|svg|bmp|tiff?|mp4|webm|mov|mp3|m4a|aac|wav|ogg|opus|flac|pcm)$/i;

export function canvasTitleWithoutExtension(title: string) { return title.replace(extensionPattern, ""); }

export async function canvasDownloadMimeType(content: string, mimeType?: string) {
    if (mimeType || !content.startsWith("blob:")) return mimeType;
    try { return (await (await fetch(content)).blob()).type || mimeType; }
    catch { return mimeType; }
}

export function canvasDownloadName(title: string, content: string, mimeType: string | undefined, fallbackExtension: string, index?: number) {
    const mime = (mimeType || content.match(/^data:([^;,]+)/i)?.[1] || "").split(";")[0].trim().toLowerCase();
    const extension = mediaExtensions[mime] || content.split(/[?#]/, 1)[0].match(extensionPattern)?.[1].toLowerCase().replace(/^jpeg$/, "jpg") || fallbackExtension;
    let name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "").replace(extensionPattern, "").replace(/[. ]+$/, "") || "image";
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    return `${name}${index === undefined ? "" : `-${index}`}.${extension}`;
}
