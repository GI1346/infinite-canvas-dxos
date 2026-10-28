import { useEffect, useRef, useState } from "react";
import { Blend, Image as ImageIcon } from "lucide-react";
import { stopWorkflowControlDrag } from "@/components/canvas/workflow-node-interactions";
import { runLocalFusionNode } from "@/lib/canvas/canvas-local-fusion-run";
import { FUSION_PATCH_PORT, LOCAL_FUSION_NODE_TYPE, fusionInputs, resolveFusionCropContext } from "@/lib/canvas/canvas-local-fusion";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

export function LocalFusionContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx, current = useRef(ctx), alive = useRef(true), runningRef = useRef(false);
    current.current = ctx;
    const [running, setRunning] = useState(false), [error, setError] = useState("");
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const nodes = ctx.getNodes(), connections = ctx.getConnections(), inputs = fusionInputs(node.id, nodes, connections);
    const original = inputs.originals[0], invalid = inputs.patches.find((patch) => resolveFusionCropContext(patch.id, original, nodes, connections).kind !== "local");
    const ready = inputs.originals.length === 1 && inputs.patches.length > 0 && !invalid;
    const reason = inputs.originals.length > 1 ? "原图端口只能连接一张完整图片" : !original ? "完整原图连接左侧，局部修改图连接右上方补丁端口" : !inputs.patches.length ? "请将局部修改图连接到右上方补丁端口" : invalid ? `“${invalid.title}”${resolveFusionCropContext(invalid.id, original, nodes, connections).kind === "conflict" ? "有多个回贴位置，请保留目标局部图的选区来源" : "没有选区来源，请使用提取选区的修改结果"}` : `${inputs.patches.length} 张局部修改图 · 本地合成，不调用 API`;
    const run = async () => {
        if (runningRef.current) return;
        const projectId = current.current.getProjectId?.();
        runningRef.current = true; setRunning(true); setError("");
        try {
            await runLocalFusionNode(node.id,
                () => ({ projectId: current.current.getProjectId?.(), nodes: current.current.getNodes(), connections: current.current.getConnections() }),
                (ops) => current.current.applyOps(ops),
                { isCurrent: () => alive.current && current.current.getProjectId?.() === projectId });
        } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { runningRef.current = false; if (alive.current) setRunning(false); }
    };
    const pane = (label: string, url?: string) => <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg" style={{ background: theme.canvas.background, border: `1px solid ${theme.node.stroke}` }}><span className="absolute left-2 top-2 z-10 rounded px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{label}</span>{url ? <img src={url} alt={label} draggable={false} className="h-full w-full object-contain" /> : <ImageIcon className="size-7 opacity-30" />}</div>;
    return <div data-fusion-node className="relative flex h-full w-full flex-col gap-3 p-4 text-xs" style={{ background: theme.node.panel, color: theme.node.text }} onMouseDown={stopWorkflowControlDrag}>
        <strong data-node-drag-handle className="cursor-grab">融合节点</strong>
        <div className="flex min-h-20 flex-1 gap-2">{pane("原图", original?.metadata?.content)}<div data-fusion-patches className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">{inputs.patches.length ? inputs.patches.map((patch, index) => <div className="flex min-h-0 flex-1" key={`${patch.id}-${index}`}>{pane(`局部修改 ${index + 1}`, patch.metadata?.content)}</div>) : pane("局部修改")}</div></div>
        <p style={{ color: theme.node.muted }}>{reason}</p>
        <label className="flex items-center gap-2"><input type="checkbox" disabled={running} checked={node.metadata?.fusionColorMatch !== false} onChange={(event) => ctx.updateMetadata({ fusionColorMatch: event.target.checked })} />颜色匹配</label>
        {error && <p role="alert" className="break-words" style={{ color: theme.node.text }}>{error}</p>}
        <button type="button" className="rounded-lg border px-3 py-2 hover:opacity-80 disabled:opacity-40" style={{ borderColor: theme.node.stroke }} disabled={!ready || running} onClick={() => void run()}>{running ? "正在融合…" : "开始融合"}</button>
    </div>;
}

export const localFusionNodeDefinition: CanvasNodeDefinition = {
    type: LOCAL_FUSION_NODE_TYPE, title: "融合节点", icon: <Blend className="size-4" />,
    defaultSize: { width: 460, height: 380 }, defaultMetadata: { fusionColorMatch: true },
    hidePanel: true, hasSourceHandle: true, Content: LocalFusionContent,
    resource: (node) => node.metadata?.content ? { kind: "image", url: node.metadata.content } : null,
};

export { FUSION_PATCH_PORT };
