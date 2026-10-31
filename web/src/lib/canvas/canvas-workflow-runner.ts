import { nanoid } from "nanoid";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { imageOutputCropContext } from "@/lib/canvas/canvas-local-fusion";
import { arrangeGrid } from "@/lib/canvas/canvas-grid-layout";
import { getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";
import { parseAspectRatio, parsePixelSize } from "@/lib/media-size";
import { fitNodeSize, IMAGE_NODE_MAX_EDGE } from "@/lib/canvas/canvas-node-size";
import { imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { buildLlmOutputOps, buildLlmPrompt, collectLlmInputs, LLM_TYPE, llmTableSystemPrompt } from "@/lib/canvas/dxos-llm";
import { CONCURRENT_TYPE, generationRows, selectedGenerationRows, runRowPool, runningTableBatches, type DxBatchRun } from "@/lib/canvas/dxos-table";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { decodeChannelModel, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasPluginAi, PluginModelCapability } from "@/types/canvas-plugin";

export type CanvasWorkflowHost = {
    getNode: (id: string) => CanvasNodeData | null | undefined;
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    applyOps: (ops: CanvasAgentOp[]) => unknown;
    ai: CanvasPluginAi;
    getConfig: () => AiConfig;
    isActive?: () => boolean;
};
export type CanvasWorkflowRunOptions = { signal?: AbortSignal; prompt?: string; retry?: boolean };
type WorkflowRun = { controller: AbortController; host: CanvasWorkflowHost; onStop?: () => void };
const activeRuns = new Map<string, WorkflowRun>();
export function isWorkflowNodeRunning(id: string) { return activeRuns.has(id) || runningTableBatches.has(id); }
function write(host: CanvasWorkflowHost, id: string, patch: CanvasNodeMetadata) { host.applyOps([{ type: "update_node", id, metadata: patch }]); }
function visible(host: CanvasWorkflowHost, id: string) { return host.isActive?.() !== false && Boolean(host.getNode(id)); }
function owns(id: string, run: WorkflowRun) { return activeRuns.get(id) === run; }
function stopRun(id: string, run: WorkflowRun) {
    if (!owns(id, run)) return;
    run.controller.abort();
    // Release synchronously: an uncooperative transport must not lock the next run.
    // Its later catch/finally paths all check this same run identity before writing.
    try {
        if (visible(run.host, id)) {
            run.onStop?.();
            write(run.host, id, { status: "idle", errorDetails: undefined });
        }
    } finally { if (owns(id, run)) { activeRuns.delete(id); runningTableBatches.delete(id); } }
}
export function stopWorkflowNode(id: string) { const run = activeRuns.get(id); if (run) stopRun(id, run); }
function assertActive(host: CanvasWorkflowHost, id: string, signal?: AbortSignal) {
    if (signal?.aborted || !visible(host, id)) throw new DOMException("节点已停止或画布已切换", "AbortError");
}
function assertRun(host: CanvasWorkflowHost, id: string, run: WorkflowRun) {
    assertActive(host, id, run.controller.signal);
    if (!owns(id, run)) throw new DOMException("节点已停止或画布已切换", "AbortError");
}
function checkedModel(host: CanvasWorkflowHost, model: string, mode: PluginModelCapability) {
    const config = host.getConfig();
    if (!selectableModelsByCapability(config, mode).includes(model) || !host.ai.listModels(mode).some((option) => option.value === model)) throw new Error("请选择当前已配置渠道下的对应模型；模型缺失时不会回退其他渠道");
    // Resolving verifies that this exact channel has its own URL/Key before any paid request starts.
    const resolved = resolveModelRequestConfig(config, model);
    if (!resolved.baseUrl.trim()) throw new Error("请配置所选渠道的 URL");
    return model;
}

async function runLlm(node: CanvasNodeData, host: CanvasWorkflowHost, options: CanvasWorkflowRunOptions, run: WorkflowRun) {
    const model = checkedModel(host, node.metadata?.model ?? host.ai.defaultModel("text"), "text");
    const decoded = decodeChannelModel(model), channelId = node.metadata?.llmChannelId ?? decoded?.channelId;
    if (!decoded || decoded.channelId !== channelId) throw new Error("请选择当前平台下的文本模型；不会回退其他渠道");
    const inputs = collectLlmInputs(node, host.getNodes(), host.getConnections());
    const prompt = buildLlmPrompt(inputs, options.prompt ?? node.metadata?.prompt);
    if (!prompt && !inputs.references.length) throw new Error("请连接图片或文本，或填写分析提示词");
    const mode = node.metadata?.llmOutputMode === "list" ? "list" : "text";
    const signature = () => { const source = host.getNode(node.id); return source ? JSON.stringify({ model: source.metadata?.model, channel: source.metadata?.llmChannelId, mode: source.metadata?.llmOutputMode, prompt: source.metadata?.prompt, inputs: collectLlmInputs(source, host.getNodes(), host.getConnections()) }) : ""; };
    const initialSignature = signature();
    write(host, node.id, { status: "loading", errorDetails: undefined });
    const result = await host.ai.generateText(prompt || "请分析输入图片。", { model, references: inputs.references, signal: run.controller.signal, ...(mode === "list" ? { system: llmTableSystemPrompt } : {}) });
    assertRun(host, node.id, run);
    if (signature() !== initialSignature) throw new Error("分析期间输入或模型设置发生变化，请重新运行");
    if (!result.text.trim()) throw new Error("模型未返回分析内容");
    const current = host.getNode(node.id)!;
    const output = buildLlmOutputOps(current, mode, result.text, inputs, host.getNodes(), host.getConnections());
    host.applyOps([...output.ops, { type: "update_node", id: node.id, metadata: { content: result.text, status: "success", errorDetails: undefined, llmOutputNodeId: output.outputId, model, llmChannelId: channelId } }]);
    return host.getNode(output.outputId) || undefined;
}

async function runConcurrent(node: CanvasNodeData, host: CanvasWorkflowHost, options: CanvasWorkflowRunOptions, run: WorkflowRun) {
    const meta = node.metadata || {}, mode = meta.generationMode === "text" || meta.generationMode === "video" ? meta.generationMode : "image";
    const rows = generationRows(node, host.getNodes(), host.getConnections());
    const chosen = selectedGenerationRows(node, rows).filter((row) => !options.retry || meta.tableBatchRun?.tasks.some((task) => task.rowNumber === row.rowNumber && task.status !== "success"));
    if (!chosen.length) throw new Error("没有可运行的行，请连接表格并检查起始行或独立选择");
    const model = checkedModel(host, meta.model || host.ai.defaultModel(mode), mode);
    const controller = run.controller, signal = controller.signal;
    const signature = () => { const source = host.getNode(node.id); return source ? JSON.stringify({ mode: source.metadata?.generationMode, model: source.metadata?.model, prompt: source.metadata?.prompt, size: source.metadata?.size, resolution: source.metadata?.imageResolution, ratio: source.metadata?.imageAspectRatio, quality: source.metadata?.quality, seconds: source.metadata?.seconds, rows: generationRows(source, host.getNodes(), host.getConnections()) }) : ""; };
    const initialSignature = signature();
    const state: DxBatchRun = { id: nanoid(), state: "running", tasks: chosen.map((row) => ({ rowNumber: row.rowNumber, status: "queued", outputIds: [nanoid()] })) };
    const active = () => owns(node.id, run) && !signal.aborted && visible(host, node.id);
    const publish = () => { if (owns(node.id, run) && visible(host, node.id)) write(host, node.id, { tableBatchRun: structuredClone(state) }); };
    run.onStop = () => {
        state.tasks.forEach((task) => {
            if (task.status !== "queued" && task.status !== "running") return;
            task.status = "stopped"; task.error = "已停止";
            task.outputIds.forEach((id) => { if (host.getNode(id)) host.applyOps([{ type: "update_node", id, metadata: { status: "error", errorDetails: task.error } }]); });
        });
        state.state = "stopped"; publish();
    };
    runningTableBatches.add(node.id);
    write(host, node.id, { status: "loading", errorDetails: undefined }); publish();
    const group = nanoid(), origin = { x: node.position.x + node.width + 100, y: node.position.y };
    const requestedSize = meta.imageAspectRatio === "auto" ? null : parsePixelSize(meta.size || host.getConfig().size) || parseAspectRatio(meta.imageAspectRatio || meta.size || host.getConfig().size);
    const placeholderSize = mode === "image" ? requestedSize ? fitNodeSize(requestedSize.width * IMAGE_NODE_MAX_EDGE, requestedSize.height * IMAGE_NODE_MAX_EDGE) : { width: IMAGE_NODE_MAX_EDGE, height: IMAGE_NODE_MAX_EDGE } : { width: 300, height: 280 };
    const columns = Math.ceil(Math.sqrt(chosen.length));
    const placeholders: CanvasNodeData[] = chosen.map((row, index) => ({ id: state.tasks[index].outputIds[0], type: mode, title: `第 ${row.rowNumber} 行`, position: origin, ...placeholderSize, metadata: { groupId: group, status: "idle", prompt: [row.text, options.prompt ?? meta.prompt].filter(Boolean).join("\n"), model } }));
    const placed = arrangeGrid(placeholders, new Set(placeholders.map((item) => item.id)), columns, 40);
    const rect = getGroupWrapRect(placed);
    const geometry = (item: CanvasNodeData) => JSON.stringify([item.position, item.width, item.height, item.metadata?.groupId]);
    const expected = new Map<string, string>();
    let autoLayout = true;
    const remember = () => { for (const id of [group, ...placeholders.map((item) => item.id)]) { const current = host.getNode(id); if (current) expected.set(id, geometry(current)); } };
    host.applyOps([{ type: "add_node", id: group, nodeType: "group", title: "批量生成结果", position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height }, ...placed.flatMap((item): CanvasAgentOp[] => [{ type: "add_node", id: item.id, nodeType: mode, title: item.title, position: item.position, width: item.width, height: item.height, metadata: item.metadata }, { type: "connect_nodes", fromNodeId: node.id, toNodeId: item.id }])]);
    remember();
    // Only this run's untouched results may move; preserve manual moves, resizing and regrouping.
    const updateOutput = (id: string, output: CanvasNodeMetadata, size?: { width: number; height: number }) => {
        const members = placeholders.map((item) => host.getNode(item.id)).filter((item): item is CanvasNodeData => Boolean(item));
        const currentGroup = host.getNode(group);
        autoLayout = autoLayout && Boolean(currentGroup) && [currentGroup!, ...members].every((item) => expected.get(item.id) === geometry(item));
        const ops: CanvasAgentOp[] = [{ type: "update_node", id, ...(size ? { patch: size } : {}), metadata: output }];
        if (autoLayout && members.length) {
            const arranged = arrangeGrid(members.map((item) => item.id === id ? { ...item, ...size } : item), new Set(members.map((item) => item.id)), columns, 40);
            const bounds = getGroupWrapRect(arranged);
            ops.push(...arranged.map((item): CanvasAgentOp => ({ type: "update_node", id: item.id, patch: { position: item.position } })), { type: "update_node", id: group, patch: { position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height } });
        }
        host.applyOps(ops); remember();
    };
    try {
        await runRowPool(chosen, Math.max(1, meta.tableBatchConcurrency || 1), signal, async (row) => {
            assertRun(host, node.id, run);
            if (signature() !== initialSignature) { controller.abort(); throw new Error("生成期间表格输入或模型设置发生变化，请重新运行"); }
            const task = state.tasks.find((item) => item.rowNumber === row.rowNumber)!;
            const id = task.outputIds[0]; task.status = "running"; publish();
            const cropContext = imageOutputCropContext(row.media, host.getNodes(), host.getConnections());
            const prompt = [row.text, options.prompt ?? meta.prompt].filter(Boolean).join("\n"), references = row.media.map((media) => media.url);
            try {
                if (!host.getNode(id)) throw new Error("生成结果节点已删除，未重新创建");
                write(host, id, { status: "loading", ...(mode === "image" ? { cropContext } : {}) });
                if (row.media.some((media) => media.mediaType !== "image")) throw new Error("此批量入口当前只接收图片参考；视频或音频素材请使用画布原生对应节点");
                let output: CanvasNodeMetadata;
                if (mode === "image") {
                    const result = await host.ai.generateImage(prompt, { model, references, count: 1, size: meta.imageAspectRatio === "auto" ? "auto" : meta.size, resolution: meta.imageResolution, quality: meta.quality, signal });
                    assertRun(host, node.id, run);
                    if (!result.images.length) throw new Error("中转站未返回图片");
                    output = { ...imageMetadata(await uploadImage(result.images[0], { signal })), cropContext };
                } else if (mode === "video") {
                    const result = await host.ai.generateVideo(prompt, { model, references, size: meta.size, seconds: meta.seconds, signal });
                    assertRun(host, node.id, run);
                    output = videoMetadata(await uploadMediaFile(result.url, "video"));
                } else { output = { status: "success", content: (await host.ai.generateText(prompt, { model, references, signal })).text }; if (!output.content?.trim()) throw new Error("模型未返回内容"); }
                assertRun(host, node.id, run);
                if (signature() !== initialSignature) { controller.abort(); throw new Error("生成期间表格输入或模型设置发生变化，请重新运行"); }
                if (!host.getNode(id)) throw new Error("生成结果节点已删除，未重新创建");
                const current = host.getNode(id)!;
                const size = mode === "image" && current.width === placeholderSize.width && current.height === placeholderSize.height && !current.metadata?.imageSizeManual && !current.metadata?.freeResize
                    ? fitNodeSize(output.naturalWidth!, output.naturalHeight!) : undefined;
                updateOutput(id, output, size); task.status = "success";
            } catch (error) {
                task.status = !active() || (error instanceof DOMException && error.name === "AbortError") ? "stopped" : "error"; task.error = error instanceof Error ? error.message : String(error);
                if (owns(node.id, run) && visible(host, node.id) && host.getNode(id)) host.applyOps([{ type: "update_node", id, metadata: { status: "error", errorDetails: task.error } }]);
            } finally { publish(); }
        });
    } finally {
        // Never let an older stopped pool publish over a replacement pool or release its lock.
        if (owns(node.id, run)) {
            state.tasks.forEach((task) => {
                if (task.status !== "queued" && task.status !== "running") return;
                task.status = "stopped"; task.error = "已停止";
                if (visible(host, node.id)) task.outputIds.forEach((id) => { if (host.getNode(id)) write(host, id, { status: "error", errorDetails: task.error }); });
            });
            state.state = active() ? "completed" : "stopped";
            publish();
            if (visible(host, node.id)) write(host, node.id, { status: state.tasks.every((task) => task.status === "success") ? "success" : "error", errorDetails: state.tasks.filter((task) => task.status !== "success").map((task) => `第 ${task.rowNumber} 行：${task.error || "已停止"}`).join("\n") || undefined });
        }
    }
    assertRun(host, node.id, run);
    const failures = state.tasks.filter((task) => task.status !== "success");
    if (failures.length) throw new Error(failures.map((task) => `第 ${task.rowNumber} 行：${task.error || "已停止"}`).join("\n"));
    return host.getNode(state.tasks[0]?.outputIds[0]) || undefined;
}

/** Dedicated, awaitable plugin workflow execution. Never falls back to an ordinary image node. */
export async function runWorkflowNode(nodeId: string, host: CanvasWorkflowHost, options: CanvasWorkflowRunOptions = {}): Promise<CanvasNodeData | undefined> {
    assertActive(host, nodeId, options.signal);
    const node = host.getNode(nodeId)!;
    if (node.type !== LLM_TYPE && node.type !== CONCURRENT_TYPE) throw new Error(`没有专用运行器的工作流节点：${node.type}`);
    if (isWorkflowNodeRunning(nodeId)) throw new Error("节点正在运行，请等待完成");
    const run: WorkflowRun = { controller: new AbortController(), host };
    activeRuns.set(nodeId, run);
    const forwardAbort = () => stopRun(nodeId, run);
    options.signal?.addEventListener("abort", forwardAbort, { once: true });
    try {
        assertRun(host, nodeId, run);
        // Preflight validation belongs to this run too; persist its errors like transport errors.
        if (node.type === LLM_TYPE) return await runLlm(node, host, options, run);
        return await runConcurrent(node, host, options, run);
    } catch (error) {
        if (owns(nodeId, run) && visible(host, nodeId)) {
            const aborted = run.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
            write(host, nodeId, { status: aborted ? "idle" : "error", errorDetails: aborted ? undefined : error instanceof Error ? error.message : String(error) });
        }
        throw error;
    } finally {
        options.signal?.removeEventListener("abort", forwardAbort);
        if (owns(nodeId, run)) { activeRuns.delete(nodeId); runningTableBatches.delete(nodeId); }
    }
}
