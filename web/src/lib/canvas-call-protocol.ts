export type CallCapability = "image" | "video" | "text" | "audio";
export type CanvasCallProtocol = { format: "canvas-call/v1"; id: string; label: string; capability: CallCapability; script: string };
export const PROTOCOL_SCRIPT_PREFIX = "canvas-protocol:";

// This is the upstream canvas model-script contract, not a second request engine.
export function validateCallProtocol(value: unknown): CanvasCallProtocol {
    if (!value || typeof value !== "object") throw new Error("协议必须是 JSON 对象");
    const p = value as CanvasCallProtocol;
    if (p.format !== "canvas-call/v1") throw new Error("format 必须是 canvas-call/v1（不是 DX 协议）");
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(p.id)) throw new Error("id 请使用小写字母、数字、下划线或横线");
    if (typeof p.label !== "string" || !p.label.trim()) throw new Error("请填写协议名称 label");
    if (!["image", "video", "text", "audio"].includes(p.capability)) throw new Error("capability 必须是 image/video/text/audio");
    if (typeof p.script !== "string" || !p.script.trim()) throw new Error("script 不能为空");
    // Compile only; saving/importing never executes a request or the script.
    new Function(`return (async () => {\n${p.script}\n});`);
    return { format: "canvas-call/v1", id: p.id, label: p.label.trim(), capability: p.capability, script: p.script.trim() };
}

export function parseCallProtocols(text: string): CanvasCallProtocol[] {
    const raw = JSON.parse(text.replace(/^\uFEFF/, "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const list = Array.isArray(raw) ? raw : raw.format === "canvas-protocol-bundle/v1" ? raw.protocols : [raw];
    if (!Array.isArray(list) || !list.length) throw new Error("协议包不能为空");
    const protocols = list.map(validateCallProtocol);
    if (new Set(protocols.map((p) => p.id)).size !== protocols.length) throw new Error("协议包存在重复 id");
    return protocols;
}
