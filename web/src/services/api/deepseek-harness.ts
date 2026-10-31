import { assistantGraphSummary, assistantRunMode, assistantRunTargets, assistantWorkflowWithSources, executeAssistantTool, type AssistantAction, type AssistantToolResult } from "@/services/api/canvas-assistant";
import { explicitAssistantImageRequirements } from "@/lib/canvas/assistant-image-parameters";
import { getNodeDefinition, listNodeDefinitions } from "@/lib/canvas/node-registry";
import { harnessBusyProjects as busyProjects } from "@/lib/canvas/harness-canvas-busy";
import { encodeChannelModel, modelOptionLabel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import type { CanvasAssistantContext } from "@/stores/use-canvas-assistant-store";
import { useCanvasAssistantStore } from "@/stores/use-canvas-assistant-store";
import { useHarnessModelStore } from "@/stores/use-harness-model-store";

export type HarnessModelsState = { projectId: string; selectedImageModel: string; channels: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }> };
export type HarnessCanvasRequest = { id: string; projectId: string; tool: string; args: Record<string, unknown>; imageModel?: string };
export type HarnessCanvasResponse = AssistantToolResult | { error: string };
declare global {
    interface Window {
        blinkflowHarness?: {
            open: (options: { projectId: string; models: HarnessModelsState }) => Promise<{ url: string }>;
            publishModels: (state: HarnessModelsState | null) => void;
            onImageModel: (handler: (selection: { projectId: string; imageModel: string }) => void) => () => void;
            onTool: (handler: (request: HarnessCanvasRequest) => void) => () => void;
            onCancel?: (handler: (id: string) => void) => () => void;
            respond: (id: string, result: HarnessCanvasResponse) => void;
        };
    }
}

const tools = new Set(["read_configuration", "read_assets", "read_results", "apply_workflow", "update_nodes", "edit_canvas", "run_nodes"]);
const readTools = new Set(["read_configuration", "read_assets", "read_results"]);
const createdNodes = new Map<string, Set<string>>();

/** Publish IDs and labels only. URLs / keys remain in the canvas request runner. */
export function harnessModelsState(): HarnessModelsState {
    return {
        projectId: useCanvasAssistantStore.getState().context?.getSnapshot().projectId || "",
        selectedImageModel: useHarnessModelStore.getState().imageModel,
        channels: useConfigStore.getState().config.channels.map((channel) => ({ id: channel.id, name: channel.name, models: channel.models.filter((model) => model.capability === "image").map((model) => ({ id: encodeChannelModel(channel.id, model.name), name: model.name })) })).filter((channel) => channel.models.length > 0),
    };
}

export async function openDeepSeekHarness() {
    const context = useCanvasAssistantStore.getState().context;
    if (!context) throw new Error("请先打开一个画布");
    const harness = window.blinkflowHarness;
    if (!harness) throw new Error("DeepSeek Harness 内置在桌面安装版中，请在新版桌面画布打开");
    const models = harnessModelsState();
    harness.publishModels(models);
    return harness.open({ projectId: context.getSnapshot().projectId, models });
}

/** Use the same validated operations and generation runner as the original canvas Agent. */
export async function executeHarnessCanvasTool(request: HarnessCanvasRequest, signal: AbortSignal): Promise<AssistantToolResult> {
    if (!request || !tools.has(request.tool) || !request.args || typeof request.args !== "object" || Array.isArray(request.args)) throw new Error("无效的 Harness 画布工具请求");
    const sourceContext = useCanvasAssistantStore.getState().context;
    const known = createdNodes.get(request.projectId) || new Set<string>();
    createdNodes.set(request.projectId, known);
    // Only nodes created by this Harness and deliberately selected input can be inspected.
    const context: CanvasAssistantContext | null = sourceContext && { ...sourceContext, applyOps: (ops) => {
        const beforeIds = new Set(sourceContext.getSnapshot().nodes.map((node) => node.id)), after = sourceContext.applyOps(ops);
        after.nodes.forEach((node) => { if (!beforeIds.has(node.id)) known.add(node.id); });
        return after;
    } };
    const assertCurrent = () => {
        if (signal.aborted || !context || useCanvasAssistantStore.getState().context?.getSnapshot().projectId !== request.projectId || context.getSnapshot().projectId !== request.projectId) throw new DOMException("画布已切换或任务已停止，请重新打开当前画布的 Harness", "AbortError");
    };
    assertCurrent();
    if (!context) throw new Error("画布尚未就绪");
    const mutate = !readTools.has(request.tool);
    if (mutate && (busyProjects.has(request.projectId) || useCanvasAssistantStore.getState().sessions.some((session) => session.running || Boolean(session.pending)))) throw new Error("画布助手正在执行任务，请等待完成后再修改同一画布");
    if (mutate) busyProjects.add(request.projectId);
    try {
        const config = useConfigStore.getState().config;
        const selectedImageModel = request.imageModel ?? "";
        const requireImageModel = (model: unknown): string => {
            if (typeof model !== "string" || !model || !selectableModelsByCapability(useConfigStore.getState().config, "image").includes(model)) throw new Error("所选生图模型或渠道不存在，或不支持图片生成，请重新选择；不会改用默认模型或其他渠道");
            return model;
        };
        const snapshot = context.getSnapshot(), selectedIds = snapshot.selectedNodeIds;
        selectedIds.forEach((id) => known.add(id));
        if (request.tool === "read_configuration") {
            return { value: {
                selectedNodeIds: selectedIds,
                references: assistantGraphSummary({ ...snapshot, nodes: snapshot.nodes.filter((node) => selectedIds.includes(node.id)), connections: [], selectedNodeIds: selectedIds }).nodes.map(({ prompt: _prompt, ...node }) => node),
                models: (["text", "image", "video", "audio"] as const).flatMap((kind) => selectableModelsByCapability(config, kind).map((id) => ({ id, kind, label: modelOptionLabel(config, id) }))),
                selectedImageModel,
                defaults: { image: config.imageModel, video: config.videoModel, text: config.textModel, audio: config.audioModel },
                nodeTypes: listNodeDefinitions().map((node) => ({ type: node.type, name: node.title, description: node.description || "", mode: node.useBuiltinPanel?.mode })),
                note: "这里只提供模型配置、节点类型和用户主动选中的引用，不提供整张画布索引。read_assets/read_results 只能使用主动选中或本 Harness 创建、运行的节点，不能遍历画布；需要其他节点请用户先选择。模型 id 必须逐字使用。selectedImageModel 是用户在 Harness 选择的生图默认：未明确指定其他模型时省略工具 model，执行器会使用它；用户明确指定其他生图模型时，apply_workflow.nodes[].model 或 run_nodes.model 填真实完整ID。选中模型失效会报错，不会跨渠道回退。新节点会布局到当前视图中心。生成尺寸用 parameters.imageAspectRatio、imageResolution(1k/2k/4k/auto) 或精确 size(宽x高)，不是显示宽高。文本正文放 apply_workflow.nodes[].prompt；已有提示词须用 connections 连接到图片节点。run_nodes 才会实际生成。",
            } };
        }
        let action = { tool: request.tool, args: request.args } as AssistantAction;
        if (action.tool === "apply_workflow") {
            const sourceIds = request.args.sourceNodeIds;
            if (sourceIds !== undefined && (!Array.isArray(sourceIds) || !sourceIds.every((id) => typeof id === "string"))) throw new Error("sourceNodeIds 必须是已有文本节点 ID 数组");
            if (Array.isArray(sourceIds) && sourceIds.some((id) => !context.getSnapshot().nodes.some((node) => node.id === id && node.type === "text"))) throw new Error("sourceNodeIds 引用的文本节点不存在");
            if (Array.isArray(action.args.nodes)) action = { ...action, args: { ...action.args, nodes: action.args.nodes.map((raw) => {
                if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
                const item = raw as Record<string, unknown>, type = String(item.type || "");
                const mode = item.mode ?? (type === "image" || type === "dxos:concurrent" ? "image" : getNodeDefinition(type)?.useBuiltinPanel?.mode);
                if (mode !== "image" || type === "blinkflow:fusion") return raw;
                if (selectedImageModel) requireImageModel(selectedImageModel);
                const model = item.model === undefined || item.model === "" ? selectedImageModel : requireImageModel(item.model);
                return model ? { ...item, model } : raw;
            }) } };
            action = assistantWorkflowWithSources(action, context.getSnapshot(), (sourceIds || []) as string[]);
        }
        if (action.tool !== "run_nodes") {
            const result = await executeAssistantTool(action, context, config, [], signal, [...known]);
            assertCurrent();
            if (action.tool === "read_assets" || action.tool === "read_results") ((result.value as { nodes?: Array<{ id: string }> })?.nodes || []).forEach((node) => known.add(node.id));
            if (action.tool === "read_results") {
                const value = result.value as { nodes: Array<Record<string, unknown>> };
                return { ...result, value: { ...value, nodes: value.nodes.map((node) => {
                    const model = context.getSnapshot().nodes.find((item) => item.id === node.id)?.metadata?.model;
                    return { ...node, model, modelLabel: model ? modelOptionLabel(useConfigStore.getState().config, model) : undefined };
                }) } };
            }
            return result;
        }
        let targets = assistantRunTargets(action, context);
        if (!targets.length) throw new Error("请指定需要运行的真实节点 ID");
        const modes = targets.map(assistantRunMode);
        const imageIds = targets.filter((node, index) => modes[index] === "image" && node.type !== "blinkflow:fusion").map((node) => node.id);
        const model = request.args.model === undefined ? selectedImageModel : requireImageModel(request.args.model);
        if (request.args.model !== undefined && !imageIds.length) throw new Error("run_nodes.model 只用于图片 API 生成节点，融合或其他类型不使用生图模型");
        if (imageIds.length && selectedImageModel) requireImageModel(selectedImageModel);
        const imageModels = targets.filter((node) => imageIds.includes(node.id)).map((node) => ({ id: node.id, model: requireImageModel(model || node.metadata?.model || config.imageModel) }));
        const parameters = request.args.parameters;
        if (parameters !== undefined && (!parameters || typeof parameters !== "object" || Array.isArray(parameters))) throw new Error("parameters 必须是对象");
        if (request.args.requirements !== undefined && typeof request.args.requirements !== "string") throw new Error("requirements 必须是用户的尺寸要求文字");
        if (request.args.prompt !== undefined && typeof request.args.prompt !== "string") throw new Error("prompt 必须是文字");
        const explicit = explicitAssistantImageRequirements(typeof request.args.requirements === "string" ? request.args.requirements : "");
        // Validate every model before changing any parameters or making the first paid call.
        if (imageModels.length) await executeAssistantTool({ tool: "edit_canvas", args: { action: "update", nodes: imageModels } }, context, config, [], signal);
        assertCurrent();
        if (parameters && Object.keys(parameters).length) await executeAssistantTool({ tool: "update_nodes", args: { nodeIds: targets.map((node) => node.id), parameters } }, context, config, [], signal);
        if (imageIds.length && Object.keys(explicit).length) await executeAssistantTool({ tool: "update_nodes", args: { nodeIds: imageIds, parameters: explicit } }, context, config, [], signal);
        targets = assistantRunTargets(action, context);
        const outcomes = [];
        for (const [index, node] of targets.entries()) {
            assertCurrent();
            const expectedModel = imageModels.find((item) => item.id === node.id)?.model;
            if (expectedModel && (requireImageModel(expectedModel) !== context.getSnapshot().nodes.find((item) => item.id === node.id)?.metadata?.model)) throw new Error("运行前节点模型已改变，本次未使用其他模型生成，请重新确认");
            const output = await context.runNode(node.id, modes[index], typeof request.args.prompt === "string" ? request.args.prompt : node.metadata?.composerContent || node.metadata?.prompt || "", signal);
            assertCurrent();
            const current = output || context.getSnapshot().nodes.find((item) => item.id === node.id);
            if (current) known.add(current.id);
            const outputModel = current?.metadata?.model;
            outcomes.push({ id: current?.id || node.id, sourceNodeId: node.id, model: outputModel, modelLabel: outputModel ? modelOptionLabel(useConfigStore.getState().config, outputModel) : undefined, status: current?.metadata?.status || "idle", error: current?.metadata?.errorDetails, width: current?.metadata?.naturalWidth, height: current?.metadata?.naturalHeight, parameters: { size: current?.metadata?.size, imageResolution: current?.metadata?.imageResolution, imageAspectRatio: current?.metadata?.imageAspectRatio }, hasOutput: Boolean(current?.metadata?.storageKey || current?.metadata?.content || current?.metadata?.images?.some((image) => image.status === "success")), images: current?.metadata?.images?.map((image) => ({ id: image.id, status: image.status, error: image.errorDetails, width: image.naturalWidth, height: image.naturalHeight })) });
        }
        return { value: { outcomes, note: "id 是实际产物节点 ID；sourceNodeId 是运行输入；model/modelLabel 是实际产物节点绑定的请求模型，不代表服务端底层模型身份已核验。以真实 status / width / height 判断结果，不能把请求参数当作实际像素。需要视觉验证时 read_assets，文本结果用 read_results。不要为了修正尺寸擅自再次付费生成。" } };
    } finally { if (mutate) busyProjects.delete(request.projectId); }
}
