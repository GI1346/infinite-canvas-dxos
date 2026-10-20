import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "@/types/canvas";

export const TABLE_TYPE = "dxos:table";
export const CONCURRENT_TYPE = "dxos:concurrent";
export const runningTableBatches = new Set<string>();
export type DxTable = { kind: "table"; version: 1; columns: string[]; rows: string[][]; selectedRows: number[]; mergedGroups: number[][] };
export type DxInputChannel = { id: string; mode?: "sequence" | "shared" };
export type DxInputItem = { type: "media"; nodeId: string; url: string; storageKey?: string; mediaType: string; title: string } | { type: "text"; text: string };
export type DxRow = { rowNumber: number; media: Extract<DxInputItem, { type: "media" }>[]; text: string };
export type DxBatchRun = { id: string; state: "running" | "completed" | "stopped"; tasks: { rowNumber: number; status: "queued" | "running" | "success" | "error" | "stopped"; outputIds: string[]; error?: string }[] };

// DXOS table v1: input channels are separate from editable data columns.
export function emptyTable(): DxTable { return { kind: "table", version: 1, columns: ["字段 2", "字段 3"], rows: [["", ""], ["", ""], ["", ""]], selectedRows: [], mergedGroups: [] }; }
export function readTable(node: CanvasNodeData): DxTable { return node.metadata?.table || emptyTable(); }
export function channelsFor(node: CanvasNodeData): DxInputChannel[] { return node.metadata?.tableInputChannels || [{ id: "input-1" }, { id: "input-2" }]; }
export function channelItems(node: CanvasNodeData, channelId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): DxInputItem[] {
    const result: DxInputItem[] = [], mediaIds = new Set<string>(), texts = new Set<string>();
    const visit = (source: CanvasNodeData, visited = new Set<string>()) => {
        if (visited.has(source.id)) return;
        visited.add(source.id);
        if (source.type === CanvasNodeType.Group) { nodes.filter((n) => n.metadata?.groupId === source.id).forEach((n) => visit(n, visited)); return; }
        if (source.type === CanvasNodeType.Text) {
            const text = source.metadata?.content || source.metadata?.prompt || "";
            if (text && !texts.has(text)) { texts.add(text); result.push({ type: "text", text }); }
            return;
        }
        if (source.type === CanvasNodeType.Image && source.metadata?.images?.length) {
            source.metadata.images.filter((i) => i.content && i.status === "success").forEach((i) => {
                const id = `${source.id}:${i.id}`;
                if (!mediaIds.has(id)) { mediaIds.add(id); result.push({ type: "media", nodeId: id, url: i.content, storageKey: i.storageKey, mediaType: "image", title: source.title }); }
            });
        } else if (["image", "video", "audio"].includes(source.type) && source.metadata?.content && !mediaIds.has(source.id)) {
            mediaIds.add(source.id); result.push({ type: "media", nodeId: source.id, url: source.metadata.content, storageKey: source.metadata.storageKey, mediaType: source.type, title: source.title });
        }
    };
    for (const edge of connections.filter((e) => e.toNodeId === node.id && (e.toPort || "input-1") === channelId)) { const source = nodes.find((n) => n.id === edge.fromNodeId); if (source) visit(source); }
    return result;
}
export function itemAt(items: DxInputItem[], channel: DxInputChannel, row: number) {
    if (!items.length) return null;
    return channel.mode === "shared" ? items[Math.min(row, items.length - 1)] || null : items[row] || null;
}
export function tableRows(table: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): DxRow[] {
    const data = readTable(table), channels = channelsFor(table).map((channel) => ({ channel, items: channelItems(table, channel.id, nodes, connections) }));
    const count = Math.max(data.rows.length, ...channels.map((c) => c.items.length));
    return Array.from({ length: count }, (_, index) => {
        const media: DxRow["media"] = [], texts: string[] = [];
        channels.forEach(({ channel, items }) => {
            const input = itemAt(items, { ...channel, mode: channel.mode || (items.length > 1 ? "sequence" : "shared") }, index);
            if (input?.type === "media" && !media.some((i) => i.nodeId === input.nodeId)) media.push(input);
            if (input?.type === "text" && input.text.trim()) texts.push(input.text.trim());
        });
        (data.rows[index] || []).forEach((value) => { if (value.trim()) texts.push(value.trim()); });
        return { rowNumber: index + 1, media, text: texts.join("\n") };
    });
}
export function generationRows(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]): DxRow[] {
    const tables = connections.filter((c) => c.toNodeId === node.id).map((c) => nodes.find((n) => n.id === c.fromNodeId)).filter((n): n is CanvasNodeData => n?.type === TABLE_TYPE);
    const rows = tables.map((table) => tableRows(table, nodes, connections));
    return Array.from({ length: Math.max(0, ...rows.map((r) => r.length)) }, (_, index) => {
        const media: DxRow["media"] = [], texts: string[] = [];
        rows.forEach((r) => { const row = r[index]; if (!row) return; row.media.forEach((m) => { if (!media.some((i) => i.nodeId === m.nodeId)) media.push(m); }); if (row.text) texts.push(row.text); });
        return { rowNumber: index + 1, media, text: texts.join("\n") };
    }).filter((row) => row.media.length || row.text.trim());
}
export function selectedGenerationRows(node: CanvasNodeData, rows: DxRow[]) { return rows.filter((row) => node.metadata?.tableBatchManualSelection ? node.metadata.tableBatchSelectedRows?.includes(row.rowNumber) : row.rowNumber >= (node.metadata?.tableBatchStartRow || 1)); }
export function deleteTableRow(table: DxTable, index: number): DxTable { return { ...table, rows: table.rows.filter((_, i) => i !== index), selectedRows: table.selectedRows.filter((i) => i !== index).map((i) => i > index ? i - 1 : i), mergedGroups: table.mergedGroups.map((g) => g.filter((i) => i !== index).map((i) => i > index ? i - 1 : i)).filter((g) => g.length > 1) }; }
export async function runRowPool<T>(rows: T[], concurrency: number, signal: AbortSignal, work: (row: T) => Promise<void>) {
    let cursor = 0;
    const errors: unknown[] = [];
    await Promise.all(Array.from({ length: Math.min(rows.length, Math.max(1, Math.floor(concurrency) || 1)) }, async () => {
        while (!signal.aborted && cursor < rows.length) { const row = rows[cursor++]; try { await work(row); } catch (error) { errors.push(error); } }
    }));
    return errors;
}
