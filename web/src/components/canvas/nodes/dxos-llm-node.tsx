import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { BrainCircuit, FileText } from "lucide-react";
import { decodeChannelModel, useEffectiveConfig } from "@/stores/use-config-store";
import { collectLlmInputs, LLM_TYPE } from "@/lib/canvas/dxos-llm";
import { isWorkflowNodeRunning, runWorkflowNode, stopWorkflowNode } from "@/lib/canvas/canvas-workflow-runner";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import { stopWorkflowControlDrag } from "@/components/canvas/workflow-node-interactions";
import { getImagePreviewRevision, previewUrlFor, subscribeImagePreviews } from "@/services/image-storage";

const button = "rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40";
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

function readLlmInputs(ctx: CanvasNodeContext) {
    const nodes = ctx.getNodes(), connections = ctx.getConnections(), snapshot = { node: ctx.node, nodes, connections };
    try { return { ...snapshot, inputs: collectLlmInputs(ctx.node, nodes, connections, true), error: "" }; }
    catch (reason) { return { ...snapshot, inputs: null, error: reason instanceof Error ? reason.message : String(reason) }; }
}

export function LlmContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx, meta = node.metadata || {}, config = useEffectiveConfig();
    const current = useRef(ctx); current.current = ctx;
    const [incoming, setIncoming] = useState(() => readLlmInputs(ctx));
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    // Subscribe independently of CanvasNode memoization, after host graph refs are committed.
    useEffect(() => {
        const refresh = () => setIncoming((previous) => {
            const latest = current.current;
            return previous.node === latest.node && previous.nodes === latest.getNodes() && previous.connections === latest.getConnections() ? previous : readLlmInputs(latest);
        });
        const unsubscribe = ctx.on("canvas:graph-changed", refresh);
        refresh();
        return unsubscribe;
    }, [ctx]);
    const controller = useRef<AbortController | null>(null), mounted = useRef(true);
    const [localRunning, setRunning] = useState(false), [error, setError] = useState("");
    const running = localRunning || (meta.status === "loading" && isWorkflowNodeRunning(node.id));
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, [node.id]);
    const mode = meta.llmOutputMode === "list" ? "list" : "text";
    const models = ctx.ai.listModels("text"), model = meta.model ?? ctx.ai.defaultModel("text"), decoded = decodeChannelModel(model);
    const channelId = meta.llmChannelId ?? decoded?.channelId ?? "";
    const channelModels = models.filter((option) => decodeChannelModel(option.value)?.channelId === channelId);
    const input: CSSProperties = { background: theme.node.panel, color: theme.node.text, border: "1px solid " + theme.node.stroke, borderRadius: 6, padding: 6 };
    const summary = incoming.error || (incoming.inputs ? incoming.inputs.references.length + " 张图片 · " + (incoming.inputs.text ? "含文本输入" : "无文本输入") : "连接图片、图片组或文本到左侧输入");
    const images = incoming.inputs?.previews?.filter((item) => item.type === "image") || [], textInputs = incoming.inputs?.previews?.filter((item) => item.type === "text") || [];

    const run = async () => {
        if (controller.current || isWorkflowNodeRunning(node.id)) return;
        const abort = new AbortController(); controller.current = abort; setRunning(true); setError("");
        try {
            await runWorkflowNode(node.id, { getNode: (id) => current.current.getNode(id), getNodes: () => current.current.getNodes(), getConnections: () => current.current.getConnections(), applyOps: (ops) => current.current.applyOps(ops), ai: current.current.ai, getConfig: () => config, isActive: () => mounted.current }, { signal: abort.signal });
        } catch (reason) { if (mounted.current && controller.current === abort && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (controller.current === abort) { controller.current = null; if (mounted.current) setRunning(false); } }
    };
    const cancel = () => { controller.current?.abort(); stopWorkflowNode(node.id); controller.current = null; setRunning(false); if (current.current.getNode(node.id)) current.current.updateMetadata({ status: "idle", errorDetails: undefined }); };
    return <div className="flex h-full min-h-0 w-full flex-col gap-2 p-4 text-xs" style={{ background: theme.node.panel, color: theme.node.text }} onMouseDown={stopWorkflowControlDrag} onPointerDown={stop} onKeyDown={stop}>
        <strong className="cursor-grab" data-node-drag-handle>LLM 多模态分析</strong>
        <div className="grid grid-cols-2 gap-2">
            <label>平台<select aria-label="LLM 平台" disabled={running} className="mt-1 w-full" style={input} value={channelId} onChange={(event) => ctx.updateMetadata({ llmChannelId: event.target.value, model: "" })}>
                <option value="">请选择平台</option>{channelId && !config.channels.some((channel) => channel.id === channelId) && <option value={channelId}>缺失平台</option>}{config.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select></label>
            <label>模型<select aria-label="LLM 模型" disabled={running} className="mt-1 w-full" style={input} value={model} onChange={(event) => ctx.updateMetadata({ model: event.target.value })}>
                <option value="">请选择文本模型</option>{model && !channelModels.some((option) => option.value === model) && <option value={model}>模型不属于当前平台或已缺失</option>}{channelModels.map((option) => <option key={option.value} value={option.value}>{decodeChannelModel(option.value)?.model || option.label}</option>)}
            </select></label>
        </div>
        <label>输出方式<select aria-label="LLM 输出模式" disabled={running} className="mt-1 w-full" style={input} value={mode} onChange={(event) => ctx.updateMetadata({ llmOutputMode: event.target.value as "text" | "list" })}><option value="text">文本</option><option value="list">列表 / 多维表格</option></select></label>
        <p data-node-no-drag className="select-text break-words" style={{ color: theme.node.muted }}>已连接输入：{summary}</p>
        {!!incoming.inputs?.previews?.length && <div data-node-scroll data-node-no-drag aria-label="LLM 输入素材" className="max-h-24 shrink-0 overflow-auto rounded p-2" style={{ border: "1px solid " + theme.node.stroke }}>
            {!!images.length && <div className="flex flex-wrap gap-2">{images.map((item, index) => <div key={item.id} className="w-16 min-w-0" title={item.title}>
                <img src={previewUrlFor(item.storageKey) || item.content} alt={item.title} className="h-12 w-full rounded object-contain" loading="lazy" decoding="async" draggable={false} />
                <span className="mt-1 block truncate" style={{ color: theme.node.muted }}>{index + 1}. {item.title}</span>
            </div>)}</div>}
            {textInputs.map((item) => <div key={item.id} className="mt-1 min-w-0 select-text">
                <div className="flex min-w-0 items-center gap-1"><FileText className="size-3 shrink-0" /><span className="truncate" title={item.title}>{item.title}</span></div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words" style={{ color: theme.node.muted }}>{item.content || "文本节点暂无内容"}</p>
            </div>)}
        </div>}
        <textarea aria-label="LLM 提示词" rows={4} disabled={running} className="min-h-20 resize-none" style={input} placeholder="输入分析要求；图片和文本从连线读取" value={meta.prompt || ""} onChange={(event) => ctx.updateMetadata({ prompt: event.target.value })} />
        <div data-node-scroll className="min-h-0 flex-1 overflow-auto rounded p-2 whitespace-pre-wrap break-words" style={{ border: "1px solid " + theme.node.stroke, color: theme.node.muted }}><span data-node-no-drag className="select-text">{running ? "正在分析…" : meta.content || "分析完成后自动创建并连接文本或可编辑表格，表格可继续连接并发生成节点。"}</span></div>
        {(error || meta.errorDetails) && <p role="alert" className="break-words">{error || meta.errorDetails}</p>}
        <div className="flex justify-between gap-2"><span style={{ color: theme.node.faint }}>{running ? "运行中" : meta.status === "loading" ? "上次运行已中断" : meta.status === "success" ? "已完成" : "就绪"}</span>{running ? <button className={button} onClick={cancel}>停止</button> : <button className={button} onClick={() => void run()}>开始分析</button>}</div>
    </div>;
}

export const llmNodeDefinition: CanvasNodeDefinition = {
    type: LLM_TYPE, title: "LLM 多模态分析", icon: <BrainCircuit className="size-4" />,
    defaultSize: { width: 430, height: 540 }, defaultMetadata: { llmOutputMode: "text" },
    hidePanel: true, hasSourceHandle: true, Content: LlmContent,
};
