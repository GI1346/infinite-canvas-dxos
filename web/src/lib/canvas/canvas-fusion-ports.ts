import type { CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export const LOCAL_FUSION_NODE_TYPE = "blinkflow:fusion";
export const FUSION_PATCH_PORT = "patch";
export function fusionTargetAnchor(node: CanvasNodeData, port?: string): Position {
    return port === FUSION_PATCH_PORT ? { x: node.position.x + node.width, y: node.position.y + 40 } : { x: node.position.x, y: node.position.y + node.height / 2 };
}
export function fusionConnectionPort(target: CanvasNodeData, current: ConnectionHandle, world: Position, pointedElement: Element | null) {
    if (target.type !== LOCAL_FUSION_NODE_TYPE) return undefined;
    if (current.handleType === "target") return current.portId === FUSION_PATCH_PORT ? FUSION_PATCH_PORT : undefined;
    const pointed = pointedElement?.closest<HTMLElement>("[data-fusion-port]");
    if (pointed?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId === target.id) return pointed.dataset.fusionPort === FUSION_PATCH_PORT ? FUSION_PATCH_PORT : undefined;
    const original = fusionTargetAnchor(target), patch = fusionTargetAnchor(target, FUSION_PATCH_PORT);
    return (world.x - patch.x) ** 2 + (world.y - patch.y) ** 2 < (world.x - original.x) ** 2 + (world.y - original.y) ** 2 ? FUSION_PATCH_PORT : undefined;
}
