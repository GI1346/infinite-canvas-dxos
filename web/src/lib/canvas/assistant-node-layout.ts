import { getNodeSpec } from "@/lib/canvas/node-registry";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeData, Position } from "@/types/canvas";

/** Place only the new workflow near the live visible center; never move existing nodes. */
export function centerAssistantNodes(ops: CanvasAgentOp[], center: Position, existing: CanvasNodeData[]): CanvasAgentOp[] {
    const additions = ops.filter((op): op is Extract<CanvasAgentOp, { type: "add_node" }> => op.type === "add_node");
    if (!additions.length) return ops;
    const gap = 80, columns = Math.ceil(Math.sqrt(additions.length));
    const placed = new Map<string, { x: number; y: number }>();
    let width = 0, height = 0;
    for (let row = 0; row < additions.length; row += columns) {
        let x = 0, rowHeight = 0;
        for (const op of additions.slice(row, row + columns)) {
            const spec = getNodeSpec(op.nodeType || "text"), w = op.width || spec.width, h = op.height || spec.height;
            placed.set(op.id!, { x, y: height });
            x += w + gap; rowHeight = Math.max(rowHeight, h);
        }
        width = Math.max(width, x - gap); height += rowHeight + gap;
    }
    height -= gap;
    const origin = { x: center.x - width / 2, y: center.y - height / 2 };
    const blockers = existing.filter((node) => node.type !== "group");
    const shifts = [{ x: 0, y: 0 }, ...blockers.flatMap((node) => [
        { x: node.position.x + node.width + gap - origin.x, y: 0 },
        { x: node.position.x - width - gap - origin.x, y: 0 },
        { x: 0, y: node.position.y + node.height + gap - origin.y },
        { x: 0, y: node.position.y - height - gap - origin.y },
    ])].sort((a, b) => a.x * a.x + a.y * a.y - b.x * b.x - b.y * b.y);
    const shift = shifts.find((offset) => blockers.every((node) => {
        const x = origin.x + offset.x, y = origin.y + offset.y;
        return x + width + gap <= node.position.x || x >= node.position.x + node.width + gap || y + height + gap <= node.position.y || y >= node.position.y + node.height + gap;
    }))!;
    return ops.map((op) => op.type === "add_node" ? { ...op, position: { x: origin.x + shift.x + placed.get(op.id!)!.x, y: origin.y + shift.y + placed.get(op.id!)!.y } } : op);
}
