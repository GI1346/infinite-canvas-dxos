import { nanoid } from "nanoid";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { LOCAL_FUSION_NODE_TYPE, fuseImageNodes, fusionInputs, resolveFusionCropContext } from "@/lib/canvas/canvas-local-fusion";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type LocalFusionSnapshot = { projectId?: string; nodes: CanvasNodeData[]; connections: CanvasConnection[] };
export type LocalFusionRunOptions = { signal?: AbortSignal; isCurrent?: () => boolean };
const running = new Set<string>();

// Share the operation lock with cleanup; component-local busy state cannot guard storage writes.
export function isLocalFusionRunning() { return running.size > 0; }

function signature(nodeId: string, snapshot: LocalFusionSnapshot) {
    const source = snapshot.nodes.find((node) => node.id === nodeId);
    const inputs = fusionInputs(nodeId, snapshot.nodes, snapshot.connections);
    const input = (node: CanvasNodeData) => [node.id, node.type, node.metadata?.storageKey, node.metadata?.content, node.metadata?.naturalWidth, node.metadata?.naturalHeight, node.metadata?.cropContext, resolveFusionCropContext(node.id, inputs.originals[0], snapshot.nodes, snapshot.connections)];
    return JSON.stringify([snapshot.projectId, source?.type, source?.metadata?.fusionColorMatch !== false, inputs.originals.map(input), inputs.patches.map(input)]);
}

// UI and Agent share one awaitable, one-shot local operation; no model or credential is involved.
export async function runLocalFusionNode(nodeId: string, getSnapshot: () => LocalFusionSnapshot, applyOps: (ops: CanvasAgentOp[]) => unknown, options: LocalFusionRunOptions = {}): Promise<CanvasNodeData> {
    const assertCurrent = () => {
        if (options.signal?.aborted || options.isCurrent?.() === false) throw new DOMException("已停止融合，未向画布写入结果", "AbortError");
    };
    assertCurrent();
    if (running.has(nodeId)) throw new Error("该融合节点正在运行，请等待完成");
    running.add(nodeId);
    try {
        const initial = getSnapshot(), source = initial.nodes.find((node) => node.id === nodeId);
        if (!source || source.type !== LOCAL_FUSION_NODE_TYPE) throw new Error("融合节点不存在");
        const initialSignature = signature(nodeId, initial);
        // Freeze inputs before any image decoding so later metadata mutations cannot alter the in-flight plan.
        const graph = structuredClone(initial), incoming = fusionInputs(nodeId, graph.nodes, graph.connections);
        if (incoming.originals.length !== 1) throw new Error("请在左侧连接且只连接一张完整原图");
        const image = await fuseImageNodes(incoming.originals[0], incoming.patches, graph.nodes, graph.connections, source.metadata?.fusionColorMatch !== false);
        assertCurrent();
        const latest = getSnapshot(), latestNode = latest.nodes.find((node) => node.id === nodeId);
        if (!latestNode || signature(nodeId, latest) !== initialSignature) throw new Error("融合期间画布或输入发生变化，请重新融合");
        const id = nanoid(), size = fitNodeSize(image.width, image.height);
        const siblings = latest.connections.filter((edge) => edge.fromNodeId === nodeId).map((edge) => latest.nodes.find((node) => node.id === edge.toNodeId)).filter((node) => node?.type === CanvasNodeType.Image);
        const y = Math.max(latestNode.position.y, ...siblings.map((node) => node!.position.y + node!.height + 24));
        const output: CanvasNodeData = {
            id, type: CanvasNodeType.Image, title: "融合结果",
            position: { x: latestNode.position.x + latestNode.width + 80, y }, ...size,
            metadata: { ...imageMetadata(image), cropContext: { full: true } },
        };
        assertCurrent();
        applyOps([
            { type: "add_node", id, nodeType: output.type, title: output.title, position: output.position, ...size, metadata: output.metadata },
            { type: "connect_nodes", fromNodeId: nodeId, toNodeId: id },
            { type: "update_node", id: nodeId, metadata: output.metadata },
            { type: "select_nodes", ids: [id] },
        ]);
        return output;
    } finally { running.delete(nodeId); }
}
