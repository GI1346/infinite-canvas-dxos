import { isWorkflowNodeRunning, runWorkflowNode, stopWorkflowNode } from "@/lib/canvas/canvas-workflow-runner";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Layers, Table2 } from "lucide-react";
import { nanoid } from "nanoid";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

import { stopWorkflowControlDrag } from "@/components/canvas/workflow-node-interactions";
import { TABLE_TYPE, CONCURRENT_TYPE, channelsFor, channelItems, itemAt, emptyTable, readTable, tableRows, generationRows, selectedGenerationRows, deleteTableRow, type DxTable } from "@/lib/canvas/dxos-table";
import { computeMediaSize, inferMediaRatio, inferMediaScale, mediaRatioOptions, mediaScaleOptions } from "@/lib/media-size";




import { useEffectiveConfig } from "@/stores/use-config-store";

const button = "rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40";
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
function saveJson(value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "table.json"; a.click(); URL.revokeObjectURL(url);
}

function TableContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { node, theme } = ctx, table = readTable(node), channels = channelsFor(node);
    const [error, setError] = useState("");
    const sources = channels.map((channel) => ({ channel, items: channelItems(node, channel.id, ctx.getNodes(), ctx.getConnections()) }));
    const count = tableRows(node, ctx.getNodes(), ctx.getConnections()).length;
    const cell: CSSProperties = { border: `1px solid ${theme.node.stroke}`, minWidth: 135, padding: 8, verticalAlign: "top" };
    const input: CSSProperties = { width: "100%", background: "transparent", color: theme.node.text, outline: "none" };
    const update = (value: DxTable) => ctx.updateMetadata({ table: value });
    const setCell = (row: number, col: number, text: string) => {
        const rows = Array.from({ length: Math.max(count, row + 1) }, (_, i) => [...(table.rows[i] || table.columns.map(() => ""))]);
        rows[row][col] = text; update({ ...table, rows });
    };
    const importTable = async (file: File) => {
        try {
            const t = JSON.parse(await file.text()) as DxTable;
            if (t.kind !== "table" || t.version !== 1 || !Array.isArray(t.columns) || !t.columns.every((c) => typeof c === "string") || !Array.isArray(t.rows) || !t.rows.every((r) => Array.isArray(r) && r.length === t.columns.length && r.every((v) => typeof v === "string"))) throw new Error("需要 table/version 1 的列与字符串单元格数据");
            update({ ...t, selectedRows: Array.isArray(t.selectedRows) ? t.selectedRows : [], mergedGroups: Array.isArray(t.mergedGroups) ? t.mergedGroups : [] }); setError("");
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };
    return <div className="flex h-full w-full min-w-0 flex-col p-3 text-xs" style={{ background: theme.node.panel, color: theme.node.text }} onMouseDown={stopWorkflowControlDrag} onPointerDown={stop} onKeyDown={stop}>
        <div className="mb-2 flex flex-wrap items-center gap-1">
            <strong className="mr-auto cursor-grab" data-node-drag-handle>{count} 行 · {channels.length} 个输入</strong>
            <button className={button} onClick={() => ctx.updateMetadata({ tableInputChannels: [...channels, { id: `input-${nanoid()}` }] })}>＋输入</button>
            <button className={button} onClick={() => update({ ...table, columns: [...table.columns, `字段 ${table.columns.length + 2}`], rows: table.rows.map((r) => [...r, ""]) })}>＋字段</button>
            <button className={button} onClick={() => saveJson(table)}>导出</button>
            <label className={`${button} cursor-pointer`}>导入<input type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importTable(f); e.target.value = ""; }} /></label>
        </div>
        <div data-node-scroll className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse"><thead><tr><th style={{ ...cell, minWidth: 40 }}>行</th>
                {sources.map(({ channel, items }, index) => <th key={channel.id} style={cell}><div className="flex items-center justify-between">输入 {index + 1}<button title="移除输入及其连线" className={button} disabled={channels.length === 1} onClick={() => { ctx.applyOps([{ type: "delete_connections", ids: ctx.getConnections().filter((c) => c.toNodeId === node.id && (c.toPort || channels[0].id) === channel.id).map((c) => c.id) }]); ctx.updateMetadata({ tableInputChannels: channels.filter((c) => c.id !== channel.id) }); }}>×</button></div><select aria-label={`输入 ${index + 1} 配对方式`} style={input} value={channel.mode || "auto"} onChange={(e) => ctx.updateMetadata({ tableInputChannels: channels.map((c) => c.id === channel.id ? { ...c, mode: e.target.value === "auto" ? undefined : e.target.value as "sequence" | "shared" } : c) })}><option value="auto">自动（{items.length > 1 ? "逐行" : "共享"}）</option><option value="sequence">逐行配对</option><option value="shared">共享 / 重复末项</option></select></th>)}
                {table.columns.map((name, col) => <th key={col} style={cell}><div className="flex"><input aria-label={`字段 ${col + 1} 名称`} style={input} value={name} onChange={(e) => update({ ...table, columns: table.columns.map((c, i) => i === col ? e.target.value : c) })} /><button className={button} title="删除字段" onClick={() => update({ ...table, columns: table.columns.filter((_, i) => i !== col), rows: table.rows.map((r) => r.filter((_, i) => i !== col)) })}>×</button></div></th>)}<th style={{ ...cell, minWidth: 35 }} /></tr></thead>
                <tbody>{Array.from({ length: count }, (_, row) => <tr key={row}><td style={{ ...cell, minWidth: 40 }}><label><input aria-label={`选择第 ${row + 1} 行`} type="checkbox" checked={table.selectedRows.includes(row)} onChange={(e) => update({ ...table, selectedRows: e.target.checked ? [...table.selectedRows, row] : table.selectedRows.filter((i) => i !== row) })} /> {row + 1}</label></td>
                    {sources.map(({ channel, items }) => { const item = itemAt(items, { ...channel, mode: channel.mode || (items.length > 1 ? "sequence" : "shared") }, row); return <td key={channel.id} style={cell}>{item?.type === "media" ? item.mediaType === "image" ? <img className="max-h-24 max-w-28 rounded object-contain" src={item.url} alt={item.title} /> : <span>{item.mediaType} · {item.title}</span> : item?.type === "text" ? <span className="whitespace-pre-wrap">{item.text}</span> : <span style={{ color: theme.node.faint }}>连接图片组或文本到左侧端口</span>}</td>; })}
                    {table.columns.map((_, col) => <td key={col} style={cell}><textarea aria-label={`第 ${row + 1} 行第 ${col + 1} 字段`} rows={3} style={input} value={table.rows[row]?.[col] || ""} onChange={(e) => setCell(row, col, e.target.value)} onPaste={(e) => {
                        const text = e.clipboardData.getData("text/plain"); if (!text.includes("\t")) return; e.preventDefault();
                        const pasted = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((r) => r.split("\t"));
                        const width = Math.max(table.columns.length, col + Math.max(...pasted.map((r) => r.length)));
                        const columns = Array.from({ length: width }, (_, i) => table.columns[i] || `字段 ${i + 2}`);
                        const rows = Array.from({ length: Math.max(count, row + pasted.length) }, (_, i) => columns.map((_, j) => table.rows[i]?.[j] || ""));
                        pasted.forEach((r, i) => r.forEach((v, j) => { rows[row + i][col + j] = v; })); update({ ...table, columns, rows });
                    }} /></td>)}<td style={{ ...cell, minWidth: 35 }}><button title="删除数据行（连线输入由上游控制）" className={button} disabled={row >= table.rows.length} onClick={() => update(deleteTableRow(table, row))}>×</button></td></tr>)}</tbody>
            </table>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="mt-2 flex justify-between gap-2"><button className={button} onClick={() => update({ ...table, rows: [...Array.from({ length: count }, (_, i) => table.rows[i] || table.columns.map(() => "")), table.columns.map(() => "")] })}>＋数据行</button><button className={button} onClick={() => {
            const id = nanoid(); ctx.applyOps([{ type: "add_node", id, nodeType: CONCURRENT_TYPE, title: "并发生成", position: { x: node.position.x + node.width + 100, y: node.position.y }, metadata: { tableBatchManualSelection: table.selectedRows.length > 0, tableBatchSelectedRows: table.selectedRows.map((i) => i + 1) } }, { type: "connect_nodes", fromNodeId: node.id, toNodeId: id }]);
        }}>连接并发节点 →</button></div>
    </div>;
}

function ConcurrentContent({ ctx }: { ctx: CanvasNodeContext }) {
    const config = useEffectiveConfig();
    const { node, theme } = ctx, meta = node.metadata || {}, rows = generationRows(node, ctx.getNodes(), ctx.getConnections());
    const current = useRef(ctx); current.current = ctx;
    const controller = useRef<AbortController | null>(null);
    const mounted = useRef(true);
    const [localRunning, setRunning] = useState(false), [error, setError] = useState("");
    const running = localRunning || (meta.status === "loading" && isWorkflowNodeRunning(node.id));
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, [node.id]);
    const mode = meta.generationMode === "text" || meta.generationMode === "video" ? meta.generationMode : "image";
    const size = meta.size || (mode === "image" ? config.size : "auto");
    const input: CSSProperties = { background: theme.node.panel, color: theme.node.text, border: `1px solid ${theme.node.stroke}`, borderRadius: 6, padding: 6 };
    const run = async (retry = false) => {
        if (controller.current || isWorkflowNodeRunning(node.id)) return;
        const abort = new AbortController(); controller.current = abort; setRunning(true); setError("");
        try {
            await runWorkflowNode(node.id, { getNode: (id) => current.current.getNode(id), getNodes: () => current.current.getNodes(), getConnections: () => current.current.getConnections(), applyOps: (ops) => current.current.applyOps(ops), ai: current.current.ai, getConfig: () => config, isActive: () => mounted.current }, { signal: abort.signal, retry });
        } catch (reason) { if (mounted.current && controller.current === abort && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { if (controller.current === abort) { controller.current = null; if (mounted.current) setRunning(false); } }
    };
    return <div className="flex h-full flex-col gap-3 p-4 text-xs" style={{ background: theme.node.panel, color: theme.node.text }} onMouseDown={stopWorkflowControlDrag} onPointerDown={stop} onKeyDown={stop}>
        <div className="flex items-center justify-between"><strong className="cursor-grab" data-node-drag-handle>生成输入 · {rows.length} 行</strong><select aria-label="生成类型" disabled={running} style={input} value={mode} onChange={(e) => ctx.updateMetadata({ generationMode: e.target.value as "image" | "video" | "text", model: undefined })}><option value="image">图像生成</option><option value="video">视频生成</option><option value="text">文本生成</option></select></div>
        <select aria-label="模型与中转站" disabled={running} style={input} value={meta.model || ""} onChange={(e) => ctx.updateMetadata({ model: e.target.value || undefined })}><option value="">使用画布默认模型</option>{meta.model && !ctx.ai.listModels(mode).some((m) => m.value === meta.model) && <option value={meta.model}>缺失模型：{meta.model}</option>}{ctx.ai.listModels(mode).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        {mode !== "text" && <div className="grid grid-cols-2 gap-2">
            <label>比例<select aria-label="生成比例" disabled={running} className="w-full" style={input} value={meta.imageAspectRatio || inferMediaRatio(size)} onChange={(e) => ctx.updateMetadata({ imageAspectRatio: e.target.value, ...(mode === "image" ? { imageResolution: meta.imageResolution || inferMediaScale(size) } : {}), size: computeMediaSize(meta.imageResolution || inferMediaScale(size), e.target.value) })}>{mediaRatioOptions.map((r) => <option key={r.value} value={r.value}>{r.value}</option>)}</select></label>
            {mode === "image" ? <label>分辨率<select aria-label="生成分辨率" disabled={running} className="w-full" style={input} value={meta.imageResolution || inferMediaScale(size)} onChange={(e) => ctx.updateMetadata({ imageResolution: e.target.value, size: computeMediaSize(e.target.value, meta.imageAspectRatio || inferMediaRatio(size)) })}>{mediaScaleOptions.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}</select></label> : <label>时长（秒）<input aria-label="视频时长" className="w-full" type="number" min={4} max={30} disabled={running} style={input} value={meta.seconds || "6"} onChange={(e) => ctx.updateMetadata({ seconds: e.target.value })} /></label>}
            {mode === "image" && <label className="col-span-2">质量<select aria-label="生成质量" className="w-full" disabled={running} style={input} value={meta.quality || "auto"} onChange={(e) => ctx.updateMetadata({ quality: e.target.value })}>{["auto", "low", "medium", "high", "xhigh", "max"].map((q) => <option key={q} value={q}>{q}</option>)}</select></label>}
        </div>}
        <div data-node-scroll className="min-h-0 flex-1 space-y-2 overflow-auto">{!rows.length && <p data-node-no-drag className="select-text" style={{ color: theme.node.muted }}>将多维表格的右侧输出连接到这里。图片组和文本在表格中按行配对。</p>}{rows.map((row) => {
            const task = meta.tableBatchRun?.tasks.find((t) => t.rowNumber === row.rowNumber);
            return <label key={row.rowNumber} className="flex items-center gap-2 rounded-lg border p-2" style={{ borderColor: theme.node.stroke }}><input type="checkbox" disabled={running || !meta.tableBatchManualSelection} checked={meta.tableBatchManualSelection ? Boolean(meta.tableBatchSelectedRows?.includes(row.rowNumber)) : row.rowNumber >= (meta.tableBatchStartRow || 1)} onChange={(e) => ctx.updateMetadata({ tableBatchSelectedRows: e.target.checked ? [...(meta.tableBatchSelectedRows || []), row.rowNumber] : meta.tableBatchSelectedRows?.filter((i) => i !== row.rowNumber) })} /><b>{row.rowNumber}</b>{row.media.filter((m) => m.mediaType === "image").map((m) => <img key={m.nodeId} alt={m.title} src={m.url} className="size-12 rounded object-contain" />)}<span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{row.text}</span>{task && <span title={task.error} style={{ color: theme.node.muted }}>{({ queued: "等待", running: running ? "运行中" : "已中断", success: "成功", error: "失败", stopped: "停止" })[task.status]}</span>}</label>;
        })}</div>
        <div className="flex flex-wrap items-center gap-2"><label>并发数 <input aria-label="并发数" disabled={running} type="number" min={1} className="w-14" style={input} value={meta.tableBatchConcurrency || 1} onChange={(e) => ctx.updateMetadata({ tableBatchConcurrency: Math.max(1, Number(e.target.value) || 1) })} /></label><label>起始行 <input aria-label="起始行" type="number" min={1} disabled={running || meta.tableBatchManualSelection} className="w-14" style={input} value={meta.tableBatchStartRow || 1} onChange={(e) => ctx.updateMetadata({ tableBatchStartRow: Math.max(1, Number(e.target.value) || 1) })} /></label><label><input type="checkbox" disabled={running} checked={Boolean(meta.tableBatchManualSelection)} onChange={(e) => ctx.updateMetadata({ tableBatchManualSelection: e.target.checked })} /> 独立选择</label></div>
        <textarea aria-label="附加提示词" disabled={running} rows={2} style={input} placeholder="附加提示词（可空）" value={meta.prompt || ""} onChange={(e) => ctx.updateMetadata({ prompt: e.target.value })} />
        {(error || meta.errorDetails) && <p role="alert">{error || meta.errorDetails}</p>}
        <div className="flex justify-end gap-2"><button className={button} disabled={running || !meta.tableBatchRun} onClick={() => void run(true)}>重试未完成行</button>{running ? <button className={button} onClick={() => { controller.current?.abort(); stopWorkflowNode(node.id); controller.current = null; setRunning(false); }}>停止</button> : <button className={button} onClick={() => void run()}>▶ 运行 {selectedGenerationRows(node, rows).length} 行</button>}</div>
    </div>;
}

export const dxosNodeDefinitions: CanvasNodeDefinition[] = [
    { type: TABLE_TYPE, title: "多维表格", icon: <Table2 className="size-4" />, defaultSize: { width: 700, height: 600 }, defaultMetadata: { table: emptyTable(), tableInputChannels: [{ id: "input-1" }, { id: "input-2" }] }, hidePanel: true, Content: TableContent },
    { type: CONCURRENT_TYPE, title: "并发生成", icon: <Layers className="size-4" />, defaultSize: { width: 420, height: 600 }, defaultMetadata: { tableBatchConcurrency: 1, tableBatchStartRow: 1, generationMode: "image" }, hidePanel: true, Content: ConcurrentContent },
];
