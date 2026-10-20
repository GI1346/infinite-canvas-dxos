import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { connectionCurve, curvePath, intersectConnectionSweep, splitCurve, type ConnectionCurve } from "@/lib/canvas/canvas-connection-geometry";
import type { CanvasConnection, CanvasNodeData, Position, ViewportTransform } from "@/types/canvas";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type Severed = { id: string; curve: ConnectionCurve; t: number; scale: number; time: number };
type Options = { containerRef: RefObject<HTMLDivElement | null>; nodes: CanvasNodeData[]; connections: CanvasConnection[]; viewport: ViewportTransform; onCommit: (ids: Set<string>) => void };
export function useConnectionCutter(options: Options) {
    const latest = useRef(options); latest.current = options;
    const gesture = useRef<{ pointerId: number; last: Position; ids: Set<string> } | null>(null);
    const [cutting, setCutting] = useState(false), [pendingIds, setPendingIds] = useState(new Set<string>()), [trail, setTrail] = useState<Position[]>([]), [severed, setSevered] = useState<Severed[]>([]);
    const toWorld = (event: { clientX: number; clientY: number }) => {
        const { viewport, containerRef } = latest.current, box = containerRef.current!.getBoundingClientRect();
        return { x: (event.clientX - box.left - viewport.x) / viewport.k, y: (event.clientY - box.top - viewport.y) / viewport.k };
    };
    const sweep = useCallback((event: PointerEvent) => {
        const active = gesture.current;
        if (!active || event.pointerId !== active.pointerId || !latest.current.containerRef.current) return;
        const points = event.getCoalescedEvents?.() || [];
        for (const sample of [...points, event]) {
            const next = toWorld(sample), { nodes, connections, viewport } = latest.current, byId = new Map(nodes.map((node) => [node.id, node]));
            if (next.x === active.last.x && next.y === active.last.y) continue;
            const removed: Severed[] = [];
            for (const connection of connections) {
                if (active.ids.has(connection.id)) continue;
                const from = byId.get(connection.fromNodeId), to = byId.get(connection.toNodeId);
                if (!from || !to) continue;
                const curve = connectionCurve(connection, from, to), t = intersectConnectionSweep(curve, active.last, next, viewport.k);
                if (t !== null) { active.ids.add(connection.id); removed.push({ id: connection.id, curve, t, scale: viewport.k, time: Date.now() }); }
            }
            if (removed.length) { setPendingIds(new Set(active.ids)); setSevered((current) => [...current, ...removed]); }
            active.last = next;
            setTrail((current) => [...current, next]);
        }
    }, []);
    const finish = useCallback(() => {
        const active = gesture.current;
        if (!active) return;
        gesture.current = null;
        const element = latest.current.containerRef.current;
        if (element?.hasPointerCapture(active.pointerId)) element.releasePointerCapture(active.pointerId);
        if (active.ids.size) latest.current.onCommit(active.ids);
        setCutting(false); setPendingIds(new Set()); setTrail([]);
    }, []);
    useEffect(() => {
        const move = (event: PointerEvent) => { if (gesture.current) { event.preventDefault(); sweep(event); } };
        const end = (event: PointerEvent) => { if (event.pointerId === gesture.current?.pointerId) { if (event.type === "pointerup") sweep(event); finish(); } };
        const mouseUp = (event: MouseEvent) => { if (event.button === 0 && gesture.current) { sweep({ pointerId: gesture.current.pointerId, clientX: event.clientX, clientY: event.clientY } as PointerEvent); finish(); } };
        const undo = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") finish(); };
        window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end); window.addEventListener("lostpointercapture", end); window.addEventListener("mouseup", mouseUp); window.addEventListener("blur", finish); window.addEventListener("keydown", undo, true);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); window.removeEventListener("lostpointercapture", end); window.removeEventListener("mouseup", mouseUp); window.removeEventListener("blur", finish); window.removeEventListener("keydown", undo, true); gesture.current = null; };
    }, [finish, sweep]);
    useEffect(() => {
        if (!severed.length) return;
        const timer = setTimeout(() => setSevered((current) => current.filter((item) => Date.now() - item.time < 240)), 240);
        return () => clearTimeout(timer);
    }, [severed]);
    const start = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (gesture.current || !latest.current.containerRef.current) return false;
        const point = toWorld(event);
        gesture.current = { pointerId: event.pointerId, last: point, ids: new Set() };
        setCutting(true); setTrail([point]); return true;
    }, []);
    return { start, cutting, pendingIds, trail, severed };
}

export function ConnectionCutEffects({ trail, severed, scale }: { trail: Position[]; severed: Severed[]; scale: number }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <g pointerEvents="none" data-connection-cut-effects>
        <style>{`@keyframes canvas-connection-sever{to{opacity:0;transform:translate(var(--cut-x),var(--cut-y))}}@media(prefers-reduced-motion:reduce){.canvas-connection-sever{animation:none!important;opacity:0}}`}</style>
        {trail.length > 1 && <polyline data-cut-trail points={trail.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={theme.node.activeStroke} strokeWidth={1.5 / scale} strokeDasharray={`${5 / scale} ${4 / scale}`} strokeLinecap="round" />}
        {severed.map((item) => splitCurve(item.curve, item.t).map((half, index) => <path key={`${item.id}:${item.time}:${index}`} data-severed-connection={item.id} className="canvas-connection-sever" d={curvePath(half)} fill="none" stroke={theme.node.activeStroke} strokeWidth={2 / item.scale} style={{ animation: "canvas-connection-sever 220ms ease-out forwards", "--cut-x": `${(index ? 8 : -8) / item.scale}px`, "--cut-y": `${(index ? -6 : 6) / item.scale}px` } as React.CSSProperties} />))}
    </g>;
}
