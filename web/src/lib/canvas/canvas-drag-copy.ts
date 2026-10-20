import { nanoid } from "nanoid";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function expandDragNodeIds(selectedIds: ReadonlySet<string>, nodes: CanvasNodeData[]): Set<string> {
    const byId = new Map(nodes.map((node) => [node.id, node])), children = new Map<string, string[]>(), expanded = new Set<string>();
    for (const node of nodes) if (node.metadata?.groupId) children.set(node.metadata.groupId, [...(children.get(node.metadata.groupId) || []), node.id]);
    const visit = (id: string) => {
        if (expanded.has(id)) return;
        const node = byId.get(id);
        if (!node) return;
        expanded.add(id);
        if (node.type === CanvasNodeType.Group) for (const child of children.get(id) || []) visit(child);
    };
    for (const id of selectedIds) visit(id);
    return expanded;
}

export function cloneDragSelection(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds: ReadonlySet<string>): { nodes: CanvasNodeData[]; connections: CanvasConnection[]; selectedIds: Set<string> } {
    const expanded = expandDragNodeIds(selectedIds, nodes), idMap = new Map<string, string>(), used = new Set([...nodes.map((node) => node.id), ...connections.map((connection) => connection.id)]);
    const freshId = () => { let id = nanoid(); while (used.has(id)) id = nanoid(); used.add(id); return id; };
    for (const node of nodes) if (expanded.has(node.id)) idMap.set(node.id, freshId());
    const mediaPrefixes = [...idMap.keys()].sort((a, b) => b.length - a.length);
    const remapMedia = (id: string) => idMap.get(id) || (() => { const source = mediaPrefixes.find((old) => id.startsWith(`${old}:`)); return source ? idMap.get(source)! + id.slice(source.length) : id; })();
    const copies = nodes.filter((node) => expanded.has(node.id)).map((node) => {
        const metadata = node.metadata ? structuredClone(node.metadata) : undefined;
        if (metadata) {
            if (metadata.groupId) metadata.groupId = idMap.get(metadata.groupId);
            if (metadata.llmOutputNodeId) metadata.llmOutputNodeId = idMap.get(metadata.llmOutputNodeId) || metadata.llmOutputNodeId;
            metadata.tableInputChannels?.forEach((channel) => { if (channel.mediaNodeIds) channel.mediaNodeIds = channel.mediaNodeIds.map(remapMedia); });
            if (metadata.status === "loading") { metadata.status = "idle"; delete metadata.errorDetails; }
            delete metadata.videoTaskId; delete metadata.videoTaskProvider; delete metadata.tableBatchRun;
            for (const item of [...(metadata.images || []), ...(metadata.texts || [])]) if (item.status === "loading") { item.status = "error"; item.errorDetails = "复制副本未继承正在执行的任务"; }
        }
        return { ...node, id: idMap.get(node.id)!, position: { ...node.position }, metadata };
    });
    return {
        nodes: copies,
        connections: connections.filter((connection) => expanded.has(connection.fromNodeId) || expanded.has(connection.toNodeId)).map((connection) => ({ ...connection, id: freshId(), fromNodeId: idMap.get(connection.fromNodeId) || connection.fromNodeId, toNodeId: idMap.get(connection.toNodeId) || connection.toNodeId })),
        selectedIds: new Set([...selectedIds].flatMap((id) => idMap.has(id) ? [idMap.get(id)!] : [])),
    };
}
