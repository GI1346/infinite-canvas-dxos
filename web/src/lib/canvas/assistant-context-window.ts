import type { AiTextMessage } from "@/services/api/image";

export const ASSISTANT_CONTEXT_WINDOWS = [3, 5, 10, 20, 50, 100, 150, 200] as const;
export const DEFAULT_ASSISTANT_CONTEXT_WINDOW = 20;

export function normalizeAssistantContextWindow(value?: number): number {
    return ASSISTANT_CONTEXT_WINDOWS.some((count) => count === value) ? value! : DEFAULT_ASSISTANT_CONTEXT_WINDOW;
}

function isGraph(value: unknown): value is { projectId: string; nodes: unknown[]; connections: unknown[]; selectedNodeIds?: string[] } {
    return Boolean(value && typeof value === "object" && "projectId" in value && typeof value.projectId === "string" && "nodes" in value && Array.isArray(value.nodes) && "connections" in value && Array.isArray(value.connections));
}

function requestText(text: string, historical: boolean, generatedTool: boolean): string {
    // Recognize only the exact automatic suffix used by older versions. User prose is untouched.
    const marker = "\n当前画布：", index = text.lastIndexOf(marker);
    if (index !== -1 && /\n本次引用节点ID：\[[^\n]*\]\n本次指定生成模型ID：\[[^\n]*\](?:\n本次提示词源节点ID：\[[^\n]*\])?$/.test(text.slice(0, index))) {
        try { if (isGraph(JSON.parse(text.slice(index + marker.length)))) return text.slice(0, index); } catch { /* Not an automatic snapshot. */ }
    }
    const match = /^工具 (read_canvas|read_assets|read_results|apply_workflow|update_nodes|edit_canvas|run_nodes) 返回：/.exec(text);
    if (!match || !generatedTool) return text;
    try {
        const [payload, ...imageLabels] = text.slice(match[0].length).split("\n");
        if (imageLabels.some((line) => !line.startsWith("节点图片 "))) return text;
        const value = JSON.parse(payload);
        const suffix = imageLabels.length ? "\n" + imageLabels.join("\n") : "";
        if (!value || typeof value !== "object" || Array.isArray(value)) return text;
        // Never resend cached output from the removed whole-canvas reader.
        if (match[1] === "read_canvas") return "旧版整图读取结果已停用；请用户主动添加所需引用。";
        const cleaned = { ...value };
        for (const key of ["canvas", "graph"]) if (isGraph(cleaned[key])) delete cleaned[key];
        if (historical && match[1] === "edit_canvas") { delete cleaned.nodeIds; delete cleaned.selectedNodeIds; }
        // Past inspected text is stale machine context, not user prose. Fetch the actual node when needed.
        if (historical && ["read_canvas", "read_assets", "read_results"].includes(match[1]) && Array.isArray(cleaned.nodes)) cleaned.nodes = cleaned.nodes.map((node: unknown) => {
            if (!node || typeof node !== "object" || Array.isArray(node)) return node;
            const { text: _text, prompt: _prompt, ...summary } = node as Record<string, unknown>;
            return summary;
        });
        return match[0] + JSON.stringify(cleaned) + suffix;
    } catch { return text; }
}

// Trim and normalize only the request copy. All stored history and the current user/Skill remain intact.
export function assistantContextMessages(transcript: AiTextMessage[], historyLength: number, count?: number): AiTextMessage[] {
    const end = Math.max(0, Math.min(transcript.length, Math.trunc(historyLength)));
    const start = Math.max(0, end - normalizeAssistantContextWindow(count));
    return transcript.slice(start).map((message, offset) => {
        const historical = start + offset < end;
        if (historical && message.role === "assistant" && typeof message.content === "string") {
            try {
                const action = JSON.parse(message.content);
                if (action?.tool === "read_canvas") return null;
                if ((action?.tool === "apply_workflow" || action?.tool === "edit_canvas") && Array.isArray(action.args?.nodes)) return { ...message, content: JSON.stringify({ ...action, args: { ...action.args, nodes: action.args.nodes.map((node: Record<string, unknown>) => { const { prompt: _prompt, text: _text, ...summary } = node; return summary; }) } }) };
            } catch { /* Ordinary assistant replies are preserved verbatim. */ }
        }
        if (message.role !== "user") return message;
        const previous = transcript[start + offset - 1];
        const text = typeof message.content === "string" ? message.content : message.content.find((part) => part.type === "text")?.text || "";
        const tool = /^工具 (\w+) 返回：/.exec(text)?.[1];
        let generatedTool = false;
        if (tool && previous && typeof previous.content === "string") {
            if (previous.role === "assistant") { try { generatedTool = JSON.parse(previous.content)?.tool === tool; } catch { /* Ordinary assistant text. */ } }
            else generatedTool = tool === "read_assets" && /\n本次引用节点ID：\[[^\n]*\]\n本次指定生成模型ID：\[[^\n]*\](?:\n本次提示词源节点ID：\[[^\n]*\])?(?:\n当前画布：[\s\S]+)?$/.test(previous.content);
        }
        if (generatedTool && tool === "read_canvas") return null;
        return { ...message, content: typeof message.content === "string" ? requestText(message.content, historical, generatedTool) : message.content.map((part) => part.type === "text" ? { ...part, text: requestText(part.text, historical, generatedTool) } : part) };
    }).filter((message): message is AiTextMessage => message !== null);
}
