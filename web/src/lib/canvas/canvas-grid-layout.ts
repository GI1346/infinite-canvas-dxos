import type { CanvasNodeData } from "@/types/canvas";

// Align whole groups as units; children retain their offsets and all connections stay intact.
export function arrangeGrid(nodes: CanvasNodeData[], selected: Set<string>, columns: number, gap: number) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const ancestors = (node: CanvasNodeData) => {
        const ids: string[] = [], visited = new Set([node.id]);
        let parent = node.metadata?.groupId;
        while (parent && !visited.has(parent) && byId.has(parent)) {
            visited.add(parent); ids.push(parent); parent = byId.get(parent)?.metadata?.groupId;
        }
        return ids;
    };
    const roots = nodes.filter((n) => selected.has(n.id) && !ancestors(n).some((id) => selected.has(id)));
    if (!roots.length) return nodes;
    columns = Math.max(1, Math.min(roots.length, Math.floor(columns) || 1)); gap = Math.max(0, gap);
    const startX = Math.min(...roots.map((n) => n.position.x)), startY = Math.min(...roots.map((n) => n.position.y));
    const widths = Array.from({ length: columns }, (_, c) => Math.max(...roots.filter((_, i) => i % columns === c).map((n) => n.width)));
    const heights = Array.from({ length: Math.ceil(roots.length / columns) }, (_, r) => Math.max(...roots.slice(r * columns, (r + 1) * columns).map((n) => n.height)));
    const moves = new Map(roots.map((n, i) => [n.id, { x: startX + widths.slice(0, i % columns).reduce((a, b) => a + b + gap, 0) - n.position.x, y: startY + heights.slice(0, Math.floor(i / columns)).reduce((a, b) => a + b + gap + 28, 0) - n.position.y }]));
    return nodes.map((n) => { const root = [n.id, ...ancestors(n)].find((id) => moves.has(id)); const d = root ? moves.get(root) : undefined; return d ? { ...n, position: { x: n.position.x + d.x, y: n.position.y + d.y } } : n; });
}
