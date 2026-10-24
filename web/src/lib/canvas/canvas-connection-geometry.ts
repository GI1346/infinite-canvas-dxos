import { LOCAL_FUSION_NODE_TYPE, FUSION_PATCH_PORT, fusionTargetAnchor } from "@/lib/canvas/canvas-fusion-ports";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";

export type ConnectionCurve = [Position, Position, Position, Position];
export function connectionCurve(connection: CanvasConnection, from: CanvasNodeData, to: CanvasNodeData): ConnectionCurve {
    const channels = to.metadata?.tableInputChannels || [{ id: "input-1" }, { id: "input-2" }];
    const port = Math.max(0, channels.findIndex((channel) => channel.id === connection.toPort));
    const start = { x: from.position.x + from.width, y: from.position.y + from.height / 2 };
    const end = to.type === LOCAL_FUSION_NODE_TYPE ? fusionTargetAnchor(to, connection.toPort) : { x: to.position.x, y: to.position.y + to.height / 2 + (to.type === "dxos:table" ? (port - (channels.length - 1) / 2) * 56 : 0) };
    const bend = Math.max(Math.abs(end.x - start.x) * .5, 50);
    return [start, { x: start.x + bend, y: start.y }, { x: end.x + (to.type === LOCAL_FUSION_NODE_TYPE && connection.toPort === FUSION_PATCH_PORT ? bend : -bend), y: end.y }, end];
}
export const curvePath = (curve: ConnectionCurve) => `M ${curve[0].x} ${curve[0].y} C ${curve[1].x} ${curve[1].y}, ${curve[2].x} ${curve[2].y}, ${curve[3].x} ${curve[3].y}`;
const mix = (a: Position, b: Position, t: number): Position => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function splitCurve(curve: ConnectionCurve, t: number): [ConnectionCurve, ConnectionCurve] {
    const [a, b, c, d] = curve, ab = mix(a, b, t), bc = mix(b, c, t), cd = mix(c, d, t), abc = mix(ab, bc, t), bcd = mix(bc, cd, t), point = mix(abc, bcd, t);
    return [[a, ab, abc, point], [point, bcd, cd, d]];
}
const squaredDistance = (a: Position, b: Position) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
function pointSegmentDistance(point: Position, a: Position, b: Position) {
    const length = squaredDistance(a, b), t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / length)) : 0;
    return Math.sqrt(squaredDistance(point, mix(a, b, t)));
}
function segmentDistance(a: Position, b: Position, c: Position, d: Position) {
    const cross = (p: Position, q: Position, r: Position) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return 0;
    return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

// Adaptive flattening uses sub-pixel screen error; every pointer move tests its full swept segment.
export function intersectConnectionSweep(curve: ConnectionCurve, from: Position, to: Position, scale: number): number | null {
    const tolerance = .5 / scale, radius = 3 / scale, stack = [{ curve, low: 0, high: 1 }];
    let closest = radius, result: number | null = null;
    while (stack.length) {
        const entry = stack.pop()!, [a, b, c, d] = entry.curve;
        const flat = Math.max(Math.sqrt(squaredDistance(b, mix(a, d, 1 / 3))), Math.sqrt(squaredDistance(c, mix(a, d, 2 / 3)))) <= tolerance;
        if (flat || entry.high - entry.low < 1e-8) {
            const distance = segmentDistance(from, to, a, d);
            if (distance <= closest) {
                const dx = d.x - a.x, dy = d.y - a.y, sx = to.x - from.x, sy = to.y - from.y, determinant = dx * sy - dy * sx;
                const local = determinant ? ((from.x - a.x) * sy - (from.y - a.y) * sx) / determinant : squaredDistance(a, d) ? ((to.x - a.x) * dx + (to.y - a.y) * dy) / squaredDistance(a, d) : .5;
                closest = distance;
                result = entry.low + Math.max(0, Math.min(1, local)) * (entry.high - entry.low);
                if (distance === 0) return result;
            }
        } else {
            const [left, right] = splitCurve(entry.curve, .5), middle = (entry.low + entry.high) / 2;
            stack.push({ curve: right, low: middle, high: entry.high }, { curve: left, low: entry.low, high: middle });
        }
    }
    return result;
}
