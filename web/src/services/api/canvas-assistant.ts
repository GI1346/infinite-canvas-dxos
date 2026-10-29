import { assistantImageParameters } from "@/lib/canvas/assistant-image-parameters";
import { editAssistantCanvas } from "@/services/api/canvas-assistant-edit";
import { nanoid } from "nanoid";

import { getNodeDefinition, getNodeSpec, isRegisteredNodeType, listNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { imageToDataUrl } from "@/services/image-storage";
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { modelCapabilityOf, modelOptionLabel, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import type { CanvasAssistantContext } from "@/stores/use-canvas-assistant-store";
import { channelsFor, CONCURRENT_TYPE, TABLE_TYPE } from "@/lib/canvas/dxos-table";
import { FUSION_PATCH_PORT, LOCAL_FUSION_NODE_TYPE } from "@/lib/canvas/canvas-fusion-ports";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export type AssistantAction = { tool: "read_canvas" | "read_assets" | "read_results" | "apply_workflow" | "update_nodes" | "edit_canvas" | "run_nodes" | "final"; args: Record<string, unknown> };
export type AssistantToolResult = { value: unknown; images?: Array<{ nodeId: string; url: string }> };
const toolNames = new Set(["read_canvas", "read_assets", "read_results", "apply_workflow", "update_nodes", "edit_canvas", "run_nodes", "final"]);
const parameterNames = ["size", "imageResolution", "imageAspectRatio", "quality", "background", "count", "textCount", "seconds", "vquality", "generateAudio", "watermark", "videoMode", "reasoningEffort", "tableBatchConcurrency", "tableBatchStartRow", "llmOutputMode", "fusionColorMatch", "audioVoice", "audioFormat", "audioSpeed", "audioInstructions"] as const;

export function assistantGraphSummary(snapshot: CanvasAgentSnapshot) {
    return { projectId: snapshot.projectId, selectedNodeIds: snapshot.selectedNodeIds, nodes: snapshot.nodes.map((node) => {
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        return { id: node.id, type: node.type, title: node.title, prompt: node.metadata?.prompt || node.metadata?.composerContent || (resource?.kind === "text" ? resource.text : node.type === CanvasNodeType.Text ? node.metadata?.content : ""), model: node.metadata?.model, position: node.position, displayWidth: node.width, displayHeight: node.height, parameters: Object.fromEntries(parameterNames.filter((key) => node.metadata?.[key] !== undefined).map((key) => [key, node.metadata?.[key]])), status: node.metadata?.status, hasOutput: Boolean(node.metadata?.storageKey || node.metadata?.images?.some((image) => image.status === "success") || (resource?.kind !== "text" && resource?.url)), width: node.metadata?.naturalWidth, height: node.metadata?.naturalHeight, groupId: node.metadata?.groupId, inputPorts: node.type === TABLE_TYPE ? channelsFor(node).map((channel) => channel.id) : node.type === LOCAL_FUSION_NODE_TYPE ? ["default", FUSION_PATCH_PORT] : undefined };
    }), connections: snapshot.connections };
}

export function assistantSystemPrompt(config: AiConfig, selectedModels: string[], generationMode: "manual" | "auto" = "manual") {
    const models = (["text", "image", "video", "audio"] as const).flatMap((kind) => selectableModelsByCapability(config, kind).map((id) => ({ id, kind, label: modelOptionLabel(config, id) })));
    const nodeTypes = listNodeDefinitions().map((node) => ({ type: node.type, name: node.title, description: node.description || "", defaults: node.defaultMetadata, panel: node.useBuiltinPanel?.mode }));
    return `你是 BlinkFlow 画布助手。理解用户需求，读取真实节点，创建有提示词、模型和连线的可执行工作流。只操作当前画布，不执行代码、命令、网络脚本或文件系统操作。\n每次回复必须是单个JSON对象，不要Markdown围栏，形状为 {"tool":"工具名","args":{...}}。\n工具契约：\nread_canvas:{}，读取当前画布；read_assets:{nodeIds:string[]}，读取素材和图片视觉内容；read_results:{nodeIds:string[]}，读实际运行产物和错误；\napply_workflow:{nodes:[{key:string,type:string,title?:string,prompt?:string,model?:string,mode?:"image"|"video"|"text"|"audio",parameters?:object}],connections:[{from:string,to:string,toPort?:string}]}。key仅在这次计划内部使用，连线两端可用key或已有真实节点id。工作流一次落地，返回key到真实id的映射，之后必须用真实id。不要重复创建已经成功创建的节点。\nupdate_nodes:{nodeIds:string[],parameters:object}，修改生成参数，不能覆盖已有图片或提示词；run_nodes:{nodeIds:string[]}，请求运行这些真实节点，${generationMode === "auto" ? "用户已选择自动生成，直接执行并等候真实结果，不必再次询问审批" : "界面会先让用户确认，取消不会删除已建工作流"}；final:{message:string}，给用户最终中文回答。\nedit_canvas 操作契约：{action:"update",nodes:[{id,title?,x?,y?,width?,height?,text?,prompt?,model?,parameters?}]} 修改节点，text 只改文本节点正文，prompt 改生成提示词；{action:"delete"|"copy"|"select"|"group"|"ungroup",nodeIds:string[],dx?:number,dy?:number}，复制保留连线与参数；{action:"grid",nodeIds:string[],columns:number,gap:number} 宫格；{action:"disconnect",connectionIds:string[]} 断线；{action:"viewport",x:number,y:number,zoom:number} 平移缩放；{action:"extract_region",nodeIds:[原图ID],x:number,y:number,width:number,height:number,ratio?:string} 按原图像素提取；{action:"undo"} 撤销最近 Agent 编辑。建节点和连接仍用 apply_workflow（nodes可以为空以连接已有节点）；融合先建 blinkflow:fusion、连接原图及patch再run_nodes。不要求用户手工操作已有工具能够完成的画布操作。用户指令不明确或缺少选区坐标等必要参数时先 final 提问，不猜测删除对象。只在用户要求时删除或改已有产物；任何生成都必须走run_nodes，保留手动确认和自动执行两模式。\n图片尺寸契约：用户明确的比例、分辨率必须在首次 run_nodes 之前写入节点 parameters，不能只写进提示词。优先 imageAspectRatio（如2:3、9:16）+ imageResolution（1k/2k/4k/auto），系统将换算真实size；精确像素用size（宽x高），不得与比例冲突。没有明确要求才沿用默认。不要用图片显示宽高代替生成尺寸，不为修正尺寸自动重复付费生成；实际不符要如实报告，不能声称已达标。\n合法生成参数键：${parameterNames.join(",")}。文本正文放prompt，图片/视频节点的prompt是生成要求，text节点的prompt是正文。模型id必须逐字使用下列真实id，包含渠道编码；不自行发明模型、不跨渠道回退。没有所需图片/视频/对话模型时明确说明应配置哪类模型。多枚用户模型引用表示用这些模型组成流程，不是只挑其中一枚忽略其他。图片和视频模型用于生成，text模型只用于分析/对话。融合节点 blinkflow:fusion 本地回贴，不需要模型；完整原图连默认端口（不写toPort），局部修改图连toPort="patch"；不要为融合节点指定生成模式。多维表格不是普通图片生成器；run_nodes 只可直接运行text/image/video/audio、blinkflow:fusion、dxos:llm与dxos:concurrent，其他节点仅用于数据/连接或手工操作。当前用户指定的生成模型：${JSON.stringify(selectedModels)}。没有指定时可用对应全局默认：${JSON.stringify({ image: config.imageModel, video: config.videoModel, audio: config.audioModel, text: config.textModel })}。\n可用模型：${JSON.stringify(models)}\n已注册节点：${JSON.stringify(nodeTypes)}\n保留已有节点、产物及连线；除非用户明确要求改动它们。先看输入素材再描述它；不要声称已生成而没有运行结果。run_nodes返回后检查真实结果。用户提到选中的图就是消息附带的nodeIds，可连接为新生成节点的上游。你可以分多步读取、建图、运行和回读结果。`;
}

export async function requestAssistantAction(config: AiConfig, model: string, messages: AiTextMessage[], signal: AbortSignal): Promise<AssistantAction> {
    if (!selectableModelsByCapability(config, "text").includes(model)) throw new Error("请选择已配置的对话模型，Agent 不使用绘画密钥作为对话密钥");
    const requestConfig = resolveModelRequestConfig(config, model);
    if (!requestConfig.baseUrl.trim() || !requestConfig.apiKey.trim()) throw new Error("所选对话渠道尚未配置 URL 或 API Key");
    const raw = await requestImageQuestion({ ...config, model, systemPrompt: "" }, messages, () => undefined, { signal });
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let value: unknown;
    try { value = JSON.parse(trimmed); } catch { throw new Error("对话模型未返回有效的 Agent JSON 指令，请重试或更换对话模型。原回答：" + raw); }
    if (!value || typeof value !== "object" || !toolNames.has(String((value as AssistantAction).tool))) throw new Error("对话模型返回未知的 Agent 工具");
    const action = value as AssistantAction;
    if (!action.args || typeof action.args !== "object" || Array.isArray(action.args)) throw new Error("Agent 工具 args 必须是对象");
    return action;
}

function idsOf(value: unknown): string[] {
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) throw new Error("nodeIds 必须是节点 ID 数组");
    return [...new Set(value)];
}
function existingNodes(snapshot: CanvasAgentSnapshot, ids: string[]) {
    return ids.map((id) => { const node = snapshot.nodes.find((item) => item.id === id); if (!node) throw new Error(`节点不存在：${id}`); return node; });
}
function parametersOf(value: unknown): CanvasNodeMetadata {
    if (!value) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("parameters 必须是对象");
    const source = value as Record<string, unknown>, result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(source)) {
        if (!(parameterNames as readonly string[]).includes(key)) throw new Error(`不支持的生成参数：${key}`);
        if (key === "count" || key === "textCount" || key === "tableBatchConcurrency" || key === "tableBatchStartRow") { if (typeof field !== "number" || !Number.isInteger(field) || field < 1) throw new Error(`${key} 必须是正整数`); }
        else if (key === "fusionColorMatch") { if (typeof field !== "boolean") throw new Error("fusionColorMatch 必须是布尔值"); }
        else if ((key === "generateAudio" || key === "watermark") && typeof field === "boolean") { result[key] = String(field); continue; }
        else if (typeof field !== "string") throw new Error(`${key} 必须是字符串`);
        result[key] = field;
    }
    return result as CanvasNodeMetadata;
}
export function assistantRunTargets(action: AssistantAction, context: CanvasAssistantContext) {
    return existingNodes(context.getSnapshot(), idsOf(action.args.nodeIds));
}
export function assistantRunMode(node: CanvasNodeData): CanvasGenerationMode {
    if (node.type === "dxos:llm") return "text";
    if (node.type === LOCAL_FUSION_NODE_TYPE) return "image"; // The canvas bridge executes this locally, never as an API image request.
    if (node.type === CONCURRENT_TYPE || ["image", "video", "text", "audio"].includes(node.type)) return node.metadata?.generationMode || (node.type === "video" ? "video" : node.type === "text" ? "text" : node.type === "audio" ? "audio" : "image");
    throw new Error(`Agent 尚不支持直接运行节点类型：${node.type}`);
}

export async function executeAssistantTool(action: AssistantAction, context: CanvasAssistantContext, config: AiConfig, selectedModels: string[], signal: AbortSignal): Promise<AssistantToolResult> {
    if (signal.aborted) throw new DOMException("已停止", "AbortError");
    const snapshot = context.getSnapshot();
    if (action.tool === "edit_canvas") return { value: await editAssistantCanvas(action.args, context, config, signal, parametersOf) };
    if (action.tool === "read_canvas") return { value: assistantGraphSummary(snapshot) };
    if (action.tool === "read_assets" || action.tool === "read_results") {
        const ids = idsOf(action.args.nodeIds), selected = existingNodes(snapshot, ids);
        const nodesById = new Map(selected.map((node) => [node.id, node]));
        const addChildren = (parent: CanvasNodeData) => { if (parent.type !== "group") return; for (const child of snapshot.nodes.filter((node) => node.metadata?.groupId === parent.id)) { if (nodesById.has(child.id)) continue; nodesById.set(child.id, child); addChildren(child); } };
        selected.forEach(addChildren);
        const nodes = [...nodesById.values()];
        const images: Array<{ nodeId: string; url: string }> = [];
        const results = [];
        for (const node of nodes) {
            const resource = getNodeDefinition(node.type)?.resource?.(node);
            const primary = node.metadata?.images?.find((image) => image.id === node.metadata?.primaryImageId) || node.metadata?.images?.find((image) => image.status === "success");
            const isImage = node.type === "image" || resource?.kind === "image";
            const url = primary?.content || resource?.url || (node.type !== "text" ? node.metadata?.content : undefined);
            if (action.tool === "read_assets" && isImage && (url || primary?.storageKey || node.metadata?.storageKey)) {
                const dataUrl = await imageToDataUrl({ url, storageKey: primary?.storageKey || node.metadata?.storageKey }, { signal });
                images.push({ nodeId: node.id, url: dataUrl });
            }
            results.push({ id: node.id, title: node.title, type: node.type, status: node.metadata?.status || "idle", error: node.metadata?.errorDetails, text: resource?.text || (node.type === "text" ? node.metadata?.content : undefined), width: node.metadata?.naturalWidth, height: node.metadata?.naturalHeight, hasOutput: Boolean(url || node.metadata?.storageKey), images: node.metadata?.images?.map((image) => ({ id: image.id, status: image.status, error: image.errorDetails, width: image.naturalWidth, height: image.naturalHeight })) });
        }
        return { value: { nodes: results }, ...(images.length ? { images } : {}) };
    }
    if (action.tool === "update_nodes") {
        const nodes = existingNodes(snapshot, idsOf(action.args.nodeIds)), metadata = parametersOf(action.args.parameters);
        context.applyOps(nodes.map((node) => ({ type: "update_node", id: node.id, metadata: assistantRunMode(node) === "image" && node.type !== LOCAL_FUSION_NODE_TYPE ? assistantImageParameters(metadata, node.metadata || {}, config) : metadata })));
        return { value: { updatedNodeIds: nodes.map((node) => node.id), canvas: assistantGraphSummary(context.getSnapshot()) } };
    }
    if (action.tool !== "apply_workflow") throw new Error("该工具需要由 Agent 界面执行");
    const rawNodes = action.args.nodes, rawConnections = action.args.connections;
    if (!Array.isArray(rawNodes) || !Array.isArray(rawConnections)) throw new Error("工作流必须提供 nodes 和 connections 数组");
    const idMap = new Map<string, string>(), newTypes = new Map<string, string>();
    const anchor = snapshot.nodes.find((node) => snapshot.selectedNodeIds.includes(node.id));
    const origin = anchor ? { x: anchor.position.x + anchor.width + 100, y: anchor.position.y } : { x: (-snapshot.viewport.x + 100) / snapshot.viewport.k, y: (-snapshot.viewport.y + 100) / snapshot.viewport.k };
    const ops: CanvasAgentOp[] = [];
    for (const [index, raw] of rawNodes.entries()) {
        if (!raw || typeof raw !== "object") throw new Error("工作流节点必须是对象");
        const item = raw as Record<string, unknown>, key = String(item.key || ""), type = String(item.type || "");
        if (!key || idMap.has(key) || snapshot.nodes.some((node) => node.id === key)) throw new Error("计划 key 必须非空、唯一且与已有节点 ID 不重复");
        if (!isRegisteredNodeType(type)) throw new Error(`未注册的节点类型：${type}`);
        const id = nanoid(); idMap.set(key, id); newTypes.set(id, type);
        const prompt = typeof item.prompt === "string" ? item.prompt : "";
        if (item.mode !== undefined && item.mode !== "image" && item.mode !== "video" && item.mode !== "text" && item.mode !== "audio") throw new Error("生成模式必须是 image、video、text 或 audio");
        const explicitMode = item.mode === "image" || item.mode === "video" || item.mode === "text" || item.mode === "audio" ? item.mode : undefined;
        if (explicitMode && !["image", "video", "audio", "text", "dxos:llm", CONCURRENT_TYPE].includes(type) && !getNodeDefinition(type)?.useBuiltinPanel) throw new Error("该节点不是 API 生成节点，不能指定生成模式");
        const mode = explicitMode || (type === "image" ? "image" : type === "video" ? "video" : type === "audio" ? "audio" : type === "dxos:llm" ? "text" : type === "dxos:concurrent" ? "image" : getNodeDefinition(type)?.useBuiltinPanel?.mode);
        if ((type === "image" && mode !== "image") || (type === "video" && mode !== "video") || (type === "audio" && mode !== "audio") || (type === "dxos:llm" && mode !== "text")) throw new Error("生成节点类型和模型能力不匹配");
        let model = typeof item.model === "string" ? item.model : "";
        if (mode) {
            if (!model) model = selectedModels.find((value) => modelCapabilityOf(config, value) === mode) || (mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : mode === "audio" ? config.audioModel : config.textModel);
            if (!selectableModelsByCapability(config, mode).includes(model)) throw new Error(`工作流中的${mode === "image" ? "图片" : mode === "video" ? "视频" : mode === "audio" ? "音频" : "文本"}节点没有可用模型，请配置并选择对应模型`);
        } else if (model && !(["image", "video", "text", "audio"] as const).some((kind) => selectableModelsByCapability(config, kind).includes(model))) throw new Error("计划引用了不存在的模型");
        const spec = getNodeSpec(type);
        const metadata: CanvasNodeMetadata = { ...(mode === "image" ? assistantImageParameters(parametersOf(item.parameters), spec.metadata || {}, config) : parametersOf(item.parameters)), ...(model ? { model } : {}), ...(mode ? { generationMode: mode } : {}), ...(prompt ? { prompt, composerContent: prompt, ...(type === "text" ? { content: prompt } : {}) } : {}) };
        ops.push({ type: "add_node", id, nodeType: type, title: typeof item.title === "string" ? item.title : spec.title, position: { x: origin.x + index * (spec.width + 80), y: origin.y }, metadata });
    }
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    for (const raw of rawConnections) {
        if (!raw || typeof raw !== "object") throw new Error("连线必须是对象");
        const edge = raw as Record<string, unknown>, from = idMap.get(String(edge.from)) || String(edge.from), to = idMap.get(String(edge.to)) || String(edge.to);
        if ((!nodeById.has(from) && !newTypes.has(from)) || (!nodeById.has(to) && !newTypes.has(to)) || from === to) throw new Error("计划连线引用不存在节点或连接自身");
        const targetType = newTypes.get(to) || nodeById.get(to)?.type;
        const targetNode: CanvasNodeData = nodeById.get(to) || { id: to, type: targetType || "", title: "", position: { x: 0, y: 0 }, width: 0, height: 0 };
        if (targetType === TABLE_TYPE && typeof edge.toPort === "string" && !channelsFor(targetNode).some((channel) => channel.id === edge.toPort)) throw new Error("表格输入端口不存在，请按 read_canvas 返回的 inputPorts 连接");
        if (targetType === LOCAL_FUSION_NODE_TYPE && edge.toPort !== undefined && edge.toPort !== FUSION_PATCH_PORT) throw new Error("融合节点补丁端口必须是 patch，完整原图使用默认端口");
        ops.push({ type: "connect_nodes", fromNodeId: from, toNodeId: to, ...(typeof edge.toPort === "string" ? { toPort: edge.toPort } : {}) });
    }
    if (signal.aborted) throw new DOMException("已停止", "AbortError");
    context.applyOps(ops);
    const after = context.getSnapshot();
    const resolvedNodes = [...idMap].map(([key, id]) => ({ key, id }));
    if (resolvedNodes.some(({ id }) => !after.nodes.some((node) => node.id === id)) || ops.some((op) => op.type === "connect_nodes" && !after.connections.some((edge) => edge.fromNodeId === op.fromNodeId && edge.toNodeId === op.toNodeId && edge.toPort === op.toPort))) throw new Error("工作流节点或连线落地回读失败，请检查画布");
    return { value: { resolvedNodes, canvas: assistantGraphSummary(after), connections: ops.filter((op) => op.type === "connect_nodes").length, note: "工作流已建好，生成尚未运行。请调用 run_nodes，界面将按当前生成模式执行或请求确认。" } };
}
