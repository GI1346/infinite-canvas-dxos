import { nanoid } from "nanoid";
import { applyCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { arrangeGrid } from "@/lib/canvas/canvas-grid-layout";
import { cloneDragSelection, expandDragNodeIds } from "@/lib/canvas/canvas-drag-copy";
import { applyGroupSelection, applyUngroupSelection, collectGroupMemberNodes, getGroupWrapRect } from "@/lib/canvas/canvas-node-geometry";
import { createCanvasNode, imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { extractImageSelection } from "@/lib/canvas/canvas-local-fusion";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { uploadImage } from "@/services/image-storage";
import { assistantImageParameters } from "@/lib/canvas/assistant-image-parameters";
import { decodeChannelModel, modelCapabilityOf, type AiConfig } from "@/stores/use-config-store";
import type { CanvasAssistantContext } from "@/stores/use-canvas-assistant-store";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";

export async function editAssistantCanvas(args: Record<string, unknown>, context: CanvasAssistantContext, config: AiConfig, signal: AbortSignal, parameters: (value: unknown) => CanvasNodeMetadata) {
    const before = context.getSnapshot(), ops: CanvasAgentOp[] = [];
    const ids = (value: unknown) => {
        if (!Array.isArray(value) || !value.length || !value.every((id) => typeof id === "string" && before.nodes.some((node) => node.id === id))) throw new Error("请提供存在于当前画布的 nodeIds");
        return new Set(value as string[]);
    };
    const number = (value: unknown, positive = false) => { if (typeof value !== "number" || !Number.isFinite(value) || (positive && value <= 0)) throw new Error("坐标和尺寸必须是有效数字，宽高必须大于零"); return value; };
    if (args.action === "undo") {
        if (!context.undoOps) throw new Error("画布撤销尚未就绪");
        if (!context.undoOps()) throw new Error("没有可撤销的 Agent 操作");
        return { undone: true };
    }
    if (args.action === "update") {
        if (!Array.isArray(args.nodes) || !args.nodes.length) throw new Error("nodes 必须是非空修改列表");
        for (const raw of args.nodes) {
            if (!raw || typeof raw !== "object") throw new Error("节点修改必须是对象");
            const item = raw as Record<string, unknown>, id = String(item.id), source = before.nodes.find((node) => node.id === id);
            if (!source) throw new Error(`节点不存在：${id}`);
            if (source.metadata?.status === "loading") throw new Error("请先停止节点生成再修改该节点");
            let metadata = parameters(item.parameters);
            const mode = source.metadata?.generationMode || (source.type === "video" ? "video" : source.type === "audio" ? "audio" : source.type === "text" || source.type === "dxos:llm" ? "text" : "image");
            if (item.model !== undefined) { if (typeof item.model !== "string" || modelCapabilityOf(config, item.model) !== mode) throw new Error("模型不存在或与节点能力不匹配"); metadata.model = item.model; if (source.type === "dxos:llm") metadata.llmChannelId = decodeChannelModel(item.model)?.channelId; }
            if (item.prompt !== undefined) { if (typeof item.prompt !== "string") throw new Error("prompt 必须是文字"); metadata.prompt = item.prompt; metadata.composerContent = item.prompt; }
            if (item.text !== undefined) { if (source.type !== "text" || typeof item.text !== "string") throw new Error("text 只适用于文本节点"); metadata.content = item.text; metadata.texts = []; metadata.primaryTextId = undefined; }
            if (mode === "image") metadata = assistantImageParameters(metadata, source.metadata || {}, config);
            const patch: Partial<typeof source> = {};
            if (item.title !== undefined) { if (typeof item.title !== "string" || !item.title.trim()) throw new Error("名称不能为空"); patch.title = item.title.trim(); }
            if (item.x !== undefined || item.y !== undefined) patch.position = { x: item.x === undefined ? source.position.x : number(item.x), y: item.y === undefined ? source.position.y : number(item.y) };
            // Keep image proportions, exactly like the canvas resize handle.
            if (item.width !== undefined || item.height !== undefined) {
                const width = item.width === undefined ? undefined : number(item.width, true), height = item.height === undefined ? undefined : number(item.height, true);
                const ratio = (source.metadata?.naturalWidth || source.width) / (source.metadata?.naturalHeight || source.height);
                patch.width = width ?? (source.type === "image" ? height! * ratio : source.width); patch.height = source.type === "image" ? patch.width / ratio : height ?? source.height;
                if (source.type === "image") metadata.imageSizeManual = true;
            }
            if (source.type === "group" && patch.position) {
                const expanded = expandDragNodeIds(new Set([id]), before.nodes);
                for (const node of before.nodes.filter((node) => expanded.has(node.id) && node.id !== id)) ops.push({ type: "update_node", id: node.id, patch: { position: { x: node.position.x + patch.position.x - source.position.x, y: node.position.y + patch.position.y - source.position.y } } });
            }
            ops.push({ type: "update_node", id, patch, metadata });
        }
    } else if (args.action === "disconnect") {
        if (!Array.isArray(args.connectionIds) || !args.connectionIds.length || !args.connectionIds.every((id) => typeof id === "string" && before.connections.some((edge) => edge.id === id))) throw new Error("请提供存在的 connectionIds");
        ops.push({ type: "delete_connections", ids: args.connectionIds as string[] });
    } else if (args.action === "viewport") {
        ops.push({ type: "set_viewport", viewport: { x: number(args.x), y: number(args.y), k: number(args.zoom, true) } });
    } else if (args.action === "extract_region") {
        const selected = ids(args.nodeIds);
        if (selected.size !== 1) throw new Error("每次提取选区需要一张原图");
        const source = before.nodes.find((node) => selected.has(node.id))!;
        if (source.type !== "image" || !source.metadata?.content) throw new Error("选区必须来自已有图片");
        const rect = { x: number(args.x), y: number(args.y), width: number(args.width, true), height: number(args.height, true) };
        if (args.ratio !== undefined && typeof args.ratio !== "string") throw new Error("ratio 必须是比例字符串");
        const extracted = await extractImageSelection(source, rect, args.ratio as string | undefined);
        const image = await uploadImage(extracted.dataUrl, { signal });
        const latest = context.getSnapshot(), current = latest.nodes.find((node) => node.id === source.id);
        if (latest.projectId !== before.projectId || current?.metadata?.storageKey !== source.metadata?.storageKey || current?.metadata?.content !== source.metadata?.content) throw new Error("提取期间原图或画布变化，未写入节点");
        const id = nanoid();
        ops.push({ type: "add_node", id, nodeType: "image", title: `${source.title}-局部图`, position: { x: source.position.x + source.width + 40, y: source.position.y }, ...fitNodeSize(image.width, image.height, 320, 360), metadata: { ...imageMetadata(image), cropContext: extracted.context } });
    } else {
        const selected = ids(args.nodeIds), expanded = expandDragNodeIds(selected, before.nodes);
        if (["delete", "copy", "group", "ungroup", "grid"].includes(String(args.action)) && before.nodes.some((node) => expanded.has(node.id) && node.metadata?.status === "loading")) throw new Error("所选节点正在生成，请先停止再操作");
        if (args.action === "delete") {
            ops.push({ type: "delete_node", ids: [...expanded] });
        } else if (args.action === "copy") {
            const copy = cloneDragSelection(before.nodes, before.connections, selected), dx = number(args.dx ?? 80), dy = number(args.dy ?? 80);
            ops.push(...copy.nodes.map((node): CanvasAgentOp => ({ type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: { x: node.position.x + dx, y: node.position.y + dy }, width: node.width, height: node.height, metadata: node.metadata })), ...copy.connections.map((edge): CanvasAgentOp => ({ type: "connect_nodes", ...edge })), { type: "select_nodes", ids: [...copy.selectedIds] });
        } else if (args.action === "select") ops.push({ type: "select_nodes", ids: [...selected] });
        else {
            let next;
            if (args.action === "grid") {
                const columns = number(args.columns, true), gap = number(args.gap);
                if (!Number.isInteger(columns) || gap < 0) throw new Error("列数必须是正整数，间距不能为负数");
                next = { ...before, nodes: arrangeGrid(before.nodes, selected, columns, gap), selectedIds: before.selectedNodeIds };
            } else if (args.action === "group") {
                const members = collectGroupMemberNodes(selected, before.nodes);
                if (members.length < 2) throw new Error("打组需要至少两个节点");
                const rect = getGroupWrapRect(members), group = createCanvasNode(CanvasNodeType.Group, { x: 0, y: 0 });
                next = applyGroupSelection(selected, before.nodes, before.connections, { ...group, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height });
            } else if (args.action === "ungroup") next = applyUngroupSelection(selected, before.nodes, before.connections);
            else throw new Error(`未知画布操作：${args.action}`);
            if (!next) throw new Error("当前选择不能执行该操作");
            const afterIds = new Set(next.nodes.map((node) => node.id));
            ops.push({ type: "delete_node", ids: before.nodes.filter((node) => !afterIds.has(node.id)).map((node) => node.id) });
            for (const node of next.nodes) ops.push(before.nodes.some((old) => old.id === node.id) ? { type: "update_node", id: node.id, patch: node } : { type: "add_node", id: node.id, nodeType: node.type, title: node.title, position: node.position, width: node.width, height: node.height, metadata: node.metadata });
            ops.push({ type: "select_nodes", ids: next.selectedIds });
        }
    }
    if (signal.aborted || context.getSnapshot().projectId !== before.projectId) throw new DOMException("已停止画布操作", "AbortError");
    // Validate the complete batch before publishing it. No partial mutation on invalid instructions.
    for (const op of ops) if ((op.type === "add_node" || op.type === "connect_nodes") && !op.id) op.id = nanoid();
    const expected = applyCanvasAgentOps(context.getSnapshot(), ops), after = context.applyOps(ops);
    if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error("画布操作回读不一致，请检查当前画布");
    const changedIds = after.nodes.filter((node) => { const previous = before.nodes.find((item) => item.id === node.id); return !previous || JSON.stringify(previous) !== JSON.stringify(node); }).map((node) => node.id);
    return { applied: ops.length, nodeIds: changedIds, selectedNodeIds: after.selectedNodeIds.filter((id) => changedIds.includes(id) || (Array.isArray(args.nodeIds) && args.nodeIds.includes(id))), note: "操作已落地，可撤销；生成仍须调用 run_nodes，沿用手动 / 自动模式。" };
}
