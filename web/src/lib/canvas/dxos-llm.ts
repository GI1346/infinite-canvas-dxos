import { nanoid } from "nanoid";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { channelItems, TABLE_TYPE, type DxTable, type DxInputItem } from "@/lib/canvas/dxos-table";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export const LLM_TYPE = "dxos:llm";
export type LlmInputGroup = { id: string; label: string; sourceName: string; sourceNodeId: string; references: string[]; mediaNodeIds: string[] };
export type LlmInputPreview = { id: string; type: "image" | "text"; title: string; content: string; storageKey?: string };
export type LlmInputs = { references: string[]; text: string; imageNodeIds: string[]; groups: LlmInputGroup[]; previews?: LlmInputPreview[] };

export function collectLlmInputs(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], withPreviews = false): LlmInputs {
    const groups: LlmInputGroup[] = [], previews: LlmInputPreview[] = [], texts = new Set<string>(), mediaIds = new Set<string>(), sourceIds = new Set<string>(), previewIds = new Set<string>();
    for (const edge of connections.filter((connection) => connection.toNodeId === node.id)) {
        const source = nodes.find((candidate) => candidate.id === edge.fromNodeId);
        if (!source || sourceIds.has(source.id)) continue;
        sourceIds.add(source.id);
        const acceptsText = !node.metadata?.tableInputChannels?.find((channel) => channel.id === (edge.toPort || "input-1"))?.imagesOnly;
        const visitSource = (candidate: CanvasNodeData, visited = new Set<string>()) => {
            if (visited.has(candidate.id)) return;
            visited.add(candidate.id);
            if (candidate.type === "audio" || candidate.type === "video") throw new Error("LLM 多模态分析当前只接收图片和文本，不支持音频或视频输入；请移除对应连线");
            if (candidate.type === "group") nodes.filter((child) => child.metadata?.groupId === candidate.id).forEach((child) => visitSource(child, visited));
            if (candidate.type === "text" && acceptsText) {
                const meta = candidate.metadata, primaryId = meta?.primaryTextId || meta?.texts?.[0]?.id;
                const primary = meta?.texts?.find((item) => item.id === primaryId);
                const text = primary ? primary.content : meta?.content || meta?.prompt || "";
                if (text.trim()) texts.add(text.trim());
                if (withPreviews && !previewIds.has(candidate.id)) {
                    previewIds.add(candidate.id);
                    previews.push({ id: candidate.id, type: "text", title: candidate.title || "文本", content: text });
                }
            }
        };
        visitSource(source);
        const items = channelItems(node, edge.toPort || "input-1", nodes, [edge]);
        const images = items.filter((item): item is Extract<DxInputItem, { type: "media" }> => item.type === "media" && item.mediaType === "image" && !mediaIds.has(item.nodeId));
        if (!images.length) continue;
        images.forEach((image) => {
            mediaIds.add(image.nodeId);
            if (withPreviews) previews.push({ id: image.nodeId, type: "image", title: image.title || "图片", content: image.url, storageKey: image.storageKey });
        });
        groups.push({ id: "input-" + (groups.length + 1), label: String.fromCharCode(65 + groups.length), sourceName: source.title || (source.type === "group" ? "图片组" : "图片"), sourceNodeId: source.id, references: images.map((image) => image.url), mediaNodeIds: images.map((image) => image.nodeId) });
    }
    return {
        references: groups.flatMap((group) => group.references), text: [...texts].join("\n\n"), groups, ...(withPreviews ? { previews } : {}),
        imageNodeIds: nodes.filter((source) => source.type === "image" && (mediaIds.has(source.id) || source.metadata?.images?.some((image) => mediaIds.has(source.id + ":" + image.id)))).map((source) => source.id),
    };
}

export function buildLlmPrompt(inputs: LlmInputs, prompt = "") {
    const hierarchy = inputs.groups.length ? [
        "输入素材层级（先按来源通道理解，再按通道内顺序理解）：",
        ...inputs.groups.map((group, index) => "输入" + (index + 1) + "（输入" + group.label + "）：" + (group.references.length > 1 ? "图片组，共 " + group.references.length + " 张" : "单图") + "；来源“" + group.sourceName + "”；包含 " + group.references.map((_, image) => "输入" + (index + 1) + "-第" + (image + 1) + "张").join("、")),
        "引用规则：“输入2/图2/第二个输入”指第二个来源通道；“输入1内第2张/组内第2张”才指组内图片，不要按扁平顺序猜测。按用户动词及指代判断目标主体与风格参考，不能仅凭图片数量判断角色。",
    ].join("\n") : "";
    return [inputs.text, prompt.trim(), hierarchy].filter(Boolean).join("\n\n");
}

export function parseLlmTable(text: string): DxTable {
    const raw = text.trim(), fence = String.fromCharCode(96).repeat(3);
    const fenced = raw.match(new RegExp("^" + fence + "(?:json)?\\s*([\\s\\S]*?)" + fence + "$", "i"));
    let value: unknown;
    try { value = JSON.parse(fenced ? fenced[1].trim() : raw); }
    catch { throw new Error("模型未返回合法的多维表格 JSON，请调整提示词后重试"); }
    if (!value || typeof value !== "object") throw new Error("模型没有返回统一的多维表格格式");
    const table = value as Partial<DxTable>;
    if (table.kind !== "table" || table.version !== 1 || !Array.isArray(table.columns) || !table.columns.length || !table.columns.every((column) => typeof column === "string" && column.trim()) || !Array.isArray(table.rows) || !table.rows.every((row) => Array.isArray(row) && row.length === table.columns!.length && row.every((cell) => typeof cell === "string"))) throw new Error("需要 kind=table、version=1、非空列名及长度与列数一致的字符串行");
    return { kind: "table", version: 1, columns: [...table.columns], rows: table.rows.map((row) => [...row]), selectedRows: [], mergedGroups: [] };
}

export const llmTableSystemPrompt = [
    '请将分析结果输出为严格的多维表格 JSON，不要解释或 Markdown。格式必须为 {"kind":"table","version":1,"columns":["列名"],"rows":[["内容"]]}。列名为非空字符串，每行单元格数量与 columns 一致，所有单元格必须是字符串。',
    "每行必须是一条完整、独立、可直接用于后续生成的内容，完成真实分析或创作，不写“参考图1”等占位。严格遵守用户指定的数量；未指定时结合输入数量和任务决定。图片组可逐张对应，单图通常应用到所有相关行。",
    "目标主体与风格参考有区分时，每行写清关系，仅迁移用户要求的风格/布局等信息，不自动迁移参考图中的品牌、外观、人物、文案或数据。按任务设计真正有用的文字列，无需多余序号列。",
    "系统会在独立输入通道保留原图，不要输出图片、参考图、生成输入或图片 URL 列，不要以图片列覆盖文字分析。",
].join("\n");

export function buildLlmOutputOps(node: CanvasNodeData, mode: "text" | "list", text: string, inputs: LlmInputs, nodes: CanvasNodeData[], connections: CanvasConnection[], outputId = nanoid()): { outputId: string; ops: CanvasAgentOp[] } {
    const downstreamIds = new Set(connections.filter((edge) => edge.fromNodeId === node.id).map((edge) => edge.toNodeId));
    const y = Math.max(node.position.y, ...nodes.filter((source) => downstreamIds.has(source.id)).map((source) => source.position.y + source.height + 42));
    const table = mode === "list" ? parseLlmTable(text) : null;
    const groups = inputs.groups.filter((group) => nodes.some((source) => source.id === group.sourceNodeId));
    const ops: CanvasAgentOp[] = [
        { type: "add_node", id: outputId, nodeType: table ? TABLE_TYPE : "text", title: table ? "LLM 输出列表" : "LLM 输出文本", position: { x: node.position.x + node.width + 100, y }, width: table ? 700 : 320, height: table ? 600 : 240, metadata: table ? { table, tableRowsFromData: true, tableInputChannels: groups.length ? groups.map((group) => ({ id: group.id, mode: group.references.length > 1 ? "sequence" : "shared", imagesOnly: true, mediaNodeIds: group.mediaNodeIds })) : [{ id: "input-1" }], status: "success" } : { content: text, status: "success" } },
        // Keep flow JSON separate from editable table input channels.
        { type: "connect_nodes", fromNodeId: node.id, toNodeId: outputId, ...(table ? { toPort: "llm-output" } : {}) },
    ];
    if (table) groups.forEach((group) => ops.push({ type: "connect_nodes", fromNodeId: group.sourceNodeId, toNodeId: outputId, toPort: group.id }));
    return { outputId, ops };
}
