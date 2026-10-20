import type { CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export function tableConnectionPort(target: CanvasNodeData, current: ConnectionHandle, world: Position, pointedElement: Element | null) {
    if (target.type !== "dxos:table") return undefined;
    const channels = target.metadata?.tableInputChannels || [{ id: "input-1" }, { id: "input-2" }];
    const pointedPort = pointedElement?.closest<HTMLElement>("[data-table-port]");
    const port = current.handleType === "target" ? current.portId : pointedPort?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId === target.id ? pointedPort.dataset.tablePort : undefined;
    if (port && channels.some((channel) => channel.id === port)) return port;
    const index = Math.max(0, Math.min(channels.length - 1, Math.round((world.y - target.position.y - target.height / 2) / 56 + (channels.length - 1) / 2)));
    return channels[index]?.id || "input-1";
}
