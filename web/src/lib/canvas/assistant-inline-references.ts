// Stable IDs, not mutable titles, identify inline references in the persisted draft.
export const assistantReferenceToken = (id: string) => `@[node:${id}]`;
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
