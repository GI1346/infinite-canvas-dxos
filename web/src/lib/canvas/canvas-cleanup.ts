import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import type { Asset } from "@/stores/use-asset-store";

export type CleanupOptions = { images: boolean; history: boolean; logs: boolean; assets: boolean; allProjects: boolean };

// Explicit fields only: never traverse or rewrite model, provider or plugin configuration.
export function cleanProject(project: CanvasProject, options: CleanupOptions): CanvasProject {
    return {
        ...project,
        updatedAt: new Date().toISOString(),
        nodes: project.nodes.map((node) => {
            const metadata = { ...node.metadata };
            if (options.images) {
                delete metadata.references;
                if (node.type === "image" || node.type === "blinkflow:fusion") {
                    delete metadata.content;
                    delete metadata.storageKey;
                    delete metadata.images;
                    delete metadata.primaryImageId;
                    delete metadata.cropContext;
                    delete metadata.bytes;
                    delete metadata.mimeType;
                    metadata.status = "idle";
                }
            }
            if (options.history || (options.images && node.type === "image")) {
                delete metadata.errorDetails;
                delete metadata.durationMs;
            }
            if (options.history || options.images) delete metadata.tableBatchRun;
            return { ...node, metadata };
        }),
        chatSessions: options.history ? [] : options.images ? project.chatSessions.map((session) => ({
            ...session,
            messages: session.messages.map((message) => ({ ...message, references: message.references?.filter((ref) => ref.type !== "image") })),
        })) : project.chatSessions,
        activeChatId: options.history ? null : project.activeChatId,
    };
}

export function cleanAssets(assets: Asset[], options: CleanupOptions): Asset[] {
    return options.images && options.assets ? assets.filter((asset) => asset.kind !== "image") : assets;
}
