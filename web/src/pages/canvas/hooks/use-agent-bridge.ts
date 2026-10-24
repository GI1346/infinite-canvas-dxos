import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { flushSync } from "react-dom";

import { runLocalFusionNode } from "@/lib/canvas/canvas-local-fusion-run";
import { LOCAL_FUSION_NODE_TYPE } from "@/lib/canvas/canvas-fusion-ports";
import { runWorkflowNode } from "@/lib/canvas/canvas-workflow-runner";
import { useConfigStore } from "@/stores/use-config-store";
import type { CanvasPluginHost } from "@/types/canvas-plugin";
import i18n from "@/i18n";
import { useCanvasAssistantStore } from "@/stores/use-canvas-assistant-store";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, signal?: AbortSignal) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    pluginHostRef: MutableRefObject<CanvasPluginHost | null>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge the canvas to its floating channel-backed assistant. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, pluginHostRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setContext = useCanvasAssistantStore((state) => state.setContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle };
        },
        [projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    const getSnapshot = useCallback((): CanvasAgentSnapshot => ({ projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: [...selectedNodeIdsRef.current], viewport: viewportRef.current }), [projectId, projectTitle]);
    const runNode = useCallback(async (nodeId: string, mode?: CanvasNodeGenerationMode, prompt?: string, signal?: AbortSignal) => {
        const isActive = () => !signal?.aborted && useCanvasAssistantStore.getState().context?.snapshot.projectId === projectId;
        const assertActive = () => { if (!isActive()) throw new DOMException("Agent 任务已停止或画布已切换", "AbortError"); };
        assertActive();
        const before = getSnapshot(), source = before.nodes.find((node) => node.id === nodeId);
        if (!source) throw new Error("节点不存在");
        if (source.type === LOCAL_FUSION_NODE_TYPE) return runLocalFusionNode(nodeId, getSnapshot, applyAgentOps, { signal, isCurrent: isActive });
        if (source.type === "dxos:llm" || source.type === "dxos:concurrent") {
            const host = pluginHostRef.current;
            if (!host) throw new Error("工作流运行器尚未就绪");
            return runWorkflowNode(nodeId, { ...host, applyOps: applyAgentOps, getConfig: () => useConfigStore.getState().config, isActive }, { signal, prompt });
        }
        if (!["text", "image", "video", "audio"].includes(source.type)) throw new Error(`该节点没有专用运行器：${source.type}`);
        if (!generateNodeRef.current) throw new Error("生成器尚未就绪");
        if (source.metadata?.status === "loading") throw new Error("节点正在运行，请等待完成");
        const ids = new Set(before.nodes.map((node) => node.id));
        // Stop the Agent immediately even if a provider ignores abort; the native runner also guards its writes.
        await new Promise<void>((resolve, reject) => {
            const abort = () => reject(new DOMException("Agent 任务已停止", "AbortError"));
            signal?.addEventListener("abort", abort, { once: true });
            Promise.resolve().then(() => {
                assertActive();
                return generateNodeRef.current!(nodeId, mode || source.metadata?.generationMode || (source.type === "video" ? "video" : source.type === "text" ? "text" : "image"), prompt ?? source.metadata?.composerContent ?? source.metadata?.prompt ?? "", signal);
            }).then(resolve, reject).finally(() => signal?.removeEventListener("abort", abort));
        });
        assertActive();
        // Commit final React state before the tool reads the outcome; never report the input as a generated result.
        flushSync(() => { setNodes((current) => { nodesRef.current = current; return current; }); setConnections((current) => { connectionsRef.current = current; return current; }); });
        const after = getSnapshot();
        const output = after.nodes.find((node) => !ids.has(node.id) && after.connections.some((edge) => edge.fromNodeId === nodeId && edge.toNodeId === node.id));
        const current = after.nodes.find((node) => node.id === nodeId);
        if (!output && !current) throw new Error("生成节点已删除，未导入结果");
        if (!output && current === source) throw new Error("生成未启动，请检查模型、渠道及提示词");
        return output || current;
    }, [getSnapshot, applyAgentOps, projectId]);
    useEffect(() => { setContext({ snapshot: agentSnapshot, getSnapshot, applyOps: applyAgentOps, runNode }); }, [agentSnapshot, getSnapshot, applyAgentOps, runNode, setContext]);
    useEffect(() => () => setContext(null), [projectId, setContext]);

    return { applyAgentOps };
}
