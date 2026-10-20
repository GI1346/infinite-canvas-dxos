import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BrainCircuit } from "lucide-react";
import { decodeChannelModel, useEffectiveConfig } from "@/stores/use-config-store";
import { buildLlmOutputOps, buildLlmPrompt, collectLlmInputs, LLM_TYPE, llmTableSystemPrompt } from "@/lib/canvas/dxos-llm";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import { stopWorkflowControlDrag } from "@/components/canvas/workflow-node-interactions";

const button = "rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40";
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

export function LlmContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx, meta = node.metadata || {}, config = useEffectiveConfig();
    const current = useRef(ctx); current.current = ctx;
    const controller = useRef<AbortController | null>(null), mounted = useRef(true);
    const [running, setRunning] = useState(false), [error, setError] = useState("");
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, [node.id]);
    const mode = meta.llmOutputMode === "list" ? "list" : "text";
    const models = ctx.ai.listModels("text"), model = meta.model ?? ctx.ai.defaultModel("text"), decoded = decodeChannelModel(model);
    const channelId = meta.llmChannelId ?? decoded?.channelId ?? "";
    const channelModels = models.filter((option) => decodeChannelModel(option.value)?.channelId === channelId);
    const input: CSSProperties = { background: theme.node.panel, color: theme.node.text, border: "1px solid " + theme.node.stroke, borderRadius: 6, padding: 6 };
    let summary = "连接图片、图片组或文本到左侧输入";
    try { const incoming = collectLlmInputs(node, ctx.getNodes(), ctx.getConnections()); summary = incoming.references.length + " 张图片 · " + (incoming.text ? "含文本输入" : "无文本输入"); }
    catch (reason) { summary = reason instanceof Error ? reason.message : String(reason); }

    const run = async () => {
        if (controller.current) return;
        const host = current.current, source = host.getNode(node.id);
        if (!source) return;
        const abort = new AbortController(); controller.current = abort; setRunning(true); setError("");
        const active = () => mounted.current && controller.current === abort && !abort.signal.aborted && Boolean(current.current.getNode(node.id));
        try {
            if (!decoded || decoded.channelId !== channelId || !config.channels.some((channel) => channel.id === channelId) || !channelModels.some((option) => option.value === model)) throw new Error("请选择当前平台下的文本模型；缺失平台或模型时不会回退到其他渠道");
            const channel = config.channels.find((entry) => entry.id === channelId)!;
            if (!channel.apiKey.trim()) throw new Error("请在配置中填写“" + channel.name + "”的独立 API Key");
            const inputs = collectLlmInputs(source, host.getNodes(), host.getConnections());
            const prompt = buildLlmPrompt(inputs, source.metadata?.prompt);
            if (!prompt && !inputs.references.length) throw new Error("请连接图片或文本，或填写分析提示词");
            host.updateMetadata({ status: "loading", errorDetails: undefined });
            const result = await host.ai.generateText(prompt || "请分析输入图片。", { model, references: inputs.references, signal: abort.signal, ...(mode === "list" ? { system: llmTableSystemPrompt } : {}) });
            if (!active()) return;
            if (!result.text.trim()) throw new Error("模型未返回分析内容");
            const latest = current.current, latestNode = latest.getNode(node.id)!;
            const output = buildLlmOutputOps(latestNode, mode, result.text, inputs, latest.getNodes(), latest.getConnections());
            latest.applyOps(output.ops);
            latest.updateMetadata({ content: result.text, status: "success", errorDetails: undefined, llmOutputNodeId: output.outputId });
        } catch (reason) {
            if (!mounted.current || controller.current !== abort || !current.current.getNode(node.id)) return;
            if (abort.signal.aborted) current.current.updateMetadata({ status: "idle", errorDetails: undefined });
            else { const message = reason instanceof Error ? reason.message : String(reason); setError(message); current.current.updateMetadata({ status: "error", errorDetails: message }); }
        } finally {
            if (controller.current === abort) { controller.current = null; if (mounted.current) setRunning(false); }
        }
    };
    const cancel = () => { controller.current?.abort(); controller.current = null; setRunning(false); if (current.current.getNode(node.id)) current.current.updateMetadata({ status: "idle", errorDetails: undefined }); };
    return <div className="flex h-full w-full flex-col gap-3 p-4 text-xs" style={{ background: theme.node.panel, color: theme.node.text }} onMouseDown={stopWorkflowControlDrag} onPointerDown={stop} onKeyDown={stop}>
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
        <p data-node-no-drag className="select-text break-words" style={{ color: theme.node.muted }}>{summary}</p>
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
