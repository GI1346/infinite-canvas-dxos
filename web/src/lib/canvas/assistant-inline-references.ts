// Stable IDs, not mutable titles, identify inline references in the persisted draft.
export const assistantReferenceToken = (id: string) => `@[node:${id}]`;
export type AssistantDraftSelection = { start: number; end: number };
export function insertAssistantReferences(draft: string, ids: string[], selection?: AssistantDraftSelection) {
    const start = Math.max(0, Math.min(selection?.start ?? draft.length, draft.length));
    const end = Math.max(start, Math.min(selection?.end ?? start, draft.length));
    const text = ids.map(assistantReferenceToken).join(" ") + " ";
    return { draft: draft.slice(0, start) + text + draft.slice(end), selection: { start: start + text.length, end: start + text.length } };
}
export function assistantDisplayDraft(draft: string, label: (id: string) => string) {
    return draft.replace(/@\[node:([^\]\r\n]+)\]/g, (_, id: string) => `@${label(id)}`);
}
export function assistantReferenceIds(draft: string) {
    return [...new Set(Array.from(draft.matchAll(/@\[node:([^\]\r\n]+)\]/g), (match) => match[1]))];
}
export function assistantDraftWithReferences(draft: string, ids: string[]) {
    const present = new Set(assistantReferenceIds(draft));
    const missing = ids.filter((id) => !present.has(id)).map(assistantReferenceToken);
    return draft + (missing.length ? `${draft && !/\s$/.test(draft) ? " " : ""}${missing.join(" ")}` : "");
}
export function assistantReadableDraft(draft: string, title: (id: string) => string) {
    return draft.replace(/@\[node:([^\]\r\n]+)\]/g, (_, id: string) => `【${title(id)}（节点ID:${id}）】`);
}
