import { nanoid } from "nanoid";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import { fitNodeSize } from "./canvas-node-size";

// A result is immutable during a fresh generation; only its new sibling owns the request.
export function createGenerationBranch(source: CanvasNodeData | undefined, nodes: CanvasNodeData[], connections: CanvasConnection[], config: AiConfig, mode: CanvasGenerationMode, prompt: string) {
    if (!source || source.type !== mode || !source.metadata?.content) return null;
    const old = source.metadata;
    const metadata: CanvasNodeMetadata = {
        prompt, composerContent: prompt, status: "idle", generationMode: mode,
        model: config.model, reasoningEffort: config.reasoningEffort,
        size: config.size, imageResolution: config.imageResolution, imageAspectRatio: old.imageAspectRatio,
        quality: config.quality, background: config.background, count: Number(config.count),
        textCount: old.textCount, fontSize: old.fontSize,
        seconds: config.videoSeconds, vquality: config.vquality, generateAudio: config.videoGenerateAudio,
        watermark: config.videoWatermark, videoMode: config.videoMode,
        audioVoice: config.audioVoice, audioFormat: config.audioFormat, audioSpeed: config.audioSpeed, audioInstructions: config.audioInstructions,
        generationType: old.generationType, references: old.references ? [...old.references] : undefined,
        cropContext: old.cropContext ? structuredClone(old.cropContext) : undefined,
        freeResize: old.freeResize, imageSizeManual: old.imageSizeManual,
    };
    const dimensions = mode === "image" && !old.imageSizeManual && !old.freeResize
        ? fitNodeSize(old.naturalWidth || source.width, old.naturalHeight || source.height)
        : { width: source.width, height: source.height };
    const position = { x: source.position.x + source.width + 96, y: source.position.y };
    // Sort once so repeated branches find a free vertical slot without overlapping old results.
    const obstacles = nodes.filter((node) => node.type !== CanvasNodeType.Group && node.position.x < position.x + dimensions.width + 32 && node.position.x + node.width + 32 > position.x).sort((a, b) => a.position.y - b.position.y);
    for (const node of obstacles) if (position.y < node.position.y + node.height + 64 && position.y + dimensions.height + 64 > node.position.y) position.y = node.position.y + node.height + 64;
    const node: CanvasNodeData = { id: nanoid(), type: source.type, title: source.title, position, ...dimensions, metadata };
    const inputs = connections.filter((edge) => edge.toNodeId === source.id).map((edge) => ({ ...edge, id: nanoid(), toNodeId: node.id }));
    // Imported images/text still need their original content for editing. Generated images use saved input references instead of turning into image-to-image requests.
    if ((mode === "image" && !old.generationType) || (mode === "text" && !old.model)) inputs.push({ id: nanoid(), fromNodeId: source.id, toNodeId: node.id });
    return { node, connections: inputs, savedImageInputs: mode === "image" && Boolean(old.generationType) };
}
