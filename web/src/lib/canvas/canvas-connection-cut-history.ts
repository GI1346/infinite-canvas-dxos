import type { CanvasConnection } from "@/types/canvas";

export function connectionCutHistory<T extends { connections: CanvasConnection[] }>(before: T, last: T | null, past: T[], ids: Set<string>) {
    const connections = before.connections.filter((connection) => !ids.has(connection.id));
    if (connections.length === before.connections.length) return null;
    const uncommitted = last && Object.keys(before).some((key) => last[key as keyof T] !== before[key as keyof T]);
    return { current: { ...before, connections }, past: [...past, ...(uncommitted ? [last] : []), before].slice(-50), future: [] as T[] };
}
