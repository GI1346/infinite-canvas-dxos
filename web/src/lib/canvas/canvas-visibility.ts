import type { CanvasNodeData } from "@/types/canvas";
import { runningTableBatches } from "./dxos-table";
export function isCanvasNodeVisible(node: CanvasNodeData, bounds: { left: number; top: number; right: number; bottom: number }) {
 return runningTableBatches.has(node.id) || (node.type.startsWith("dxos:") && (node.metadata?.status === "loading" || node.metadata?.tableBatchRun?.state === "running")) || (node.position.x + node.width > bounds.left && node.position.x < bounds.right && node.position.y + node.height > bounds.top && node.position.y < bounds.bottom);
}
