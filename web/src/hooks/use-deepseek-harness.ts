import { useEffect } from "react";
import { executeHarnessCanvasTool, harnessModelsState } from "@/services/api/deepseek-harness";
import { recordDiagnostic } from "@/services/diagnostics";
import { useCanvasAssistantStore } from "@/stores/use-canvas-assistant-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useHarnessModelStore } from "@/stores/use-harness-model-store";

/** Listen outside the canvas route so a closed canvas returns an error instead of hanging. */
export function useDeepSeekHarness() {
    useEffect(() => {
        const harness = window.blinkflowHarness;
        if (!harness) return;
        let lastModels = "";
        const publishModels = () => {
            const state = harnessModelsState(), serialized = JSON.stringify(state);
            if (serialized !== lastModels) { lastModels = serialized; harness.publishModels(state.projectId ? state : null); }
        };
        const configChanged = useConfigStore.subscribe((state, previous) => { if (state.config !== previous.config) publishModels(); });
        const preferenceChanged = useHarnessModelStore.subscribe(publishModels);
        const selectedModel = harness.onImageModel(({ projectId, imageModel }) => {
            if (projectId !== useCanvasAssistantStore.getState().context?.getSnapshot().projectId || typeof imageModel !== "string") return;
            useHarnessModelStore.getState().setImageModel(imageModel);
        });
        publishModels();
        const requests = new Map<string, { projectId: string; controller: AbortController }>();
        const unsubscribe = harness.onTool((request) => {
            if (requests.has(request.id)) return;
            const controller = new AbortController();
            requests.set(request.id, { projectId: request.projectId, controller });
            void (async () => {
                try {
                    const context = useCanvasAssistantStore.getState().context;
                    if (!context || context.getSnapshot().projectId !== request.projectId) throw new DOMException("此 Harness 绑定的画布已关闭，请从当前画布重新打开", "AbortError");
                    harness.respond(request.id, await executeHarnessCanvasTool(request, controller.signal));
                } catch (error) {
                    if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) recordDiagnostic("DeepSeek Harness 画布工具", error, { projectId: request.projectId });
                    harness.respond(request.id, { error: error instanceof Error ? error.message : String(error) });
                } finally { requests.delete(request.id); }
            })();
        });
        const cancel = harness.onCancel?.((id) => requests.get(id)?.controller.abort());
        let lastProjectId = useCanvasAssistantStore.getState().context?.getSnapshot().projectId;
        const contextChanged = useCanvasAssistantStore.subscribe((state) => {
            const projectId = state.context?.getSnapshot().projectId;
            if (projectId !== lastProjectId) { lastProjectId = projectId; publishModels(); }
            for (const [id, request] of requests) if (request.projectId !== projectId) {
                request.controller.abort();
                harness.respond(id, { error: "画布已切换，旧画布工具已停止" });
                requests.delete(id);
            }
        });
        return () => {
            unsubscribe(); cancel?.(); contextChanged(); configChanged(); preferenceChanged(); selectedModel();
            for (const [id, request] of requests) {
                request.controller.abort();
                harness.respond(id, { error: "画布页面已关闭，工具请求已停止" });
            }
        };
    }, []);
}
