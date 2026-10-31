import { recordDiagnostic } from "@/services/diagnostics";
import { isHarnessCanvasBusy } from "@/lib/canvas/harness-canvas-busy";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { create } from "zustand";

import { buildAssistantSkillPrompt } from "@/lib/canvas/canvas-assistant-skills";
import { assistantContextMessages, DEFAULT_ASSISTANT_CONTEXT_WINDOW, normalizeAssistantContextWindow } from "@/lib/canvas/assistant-context-window";
import { getAssistantSkill, loadAssistantSkills } from "@/stores/use-canvas-assistant-skill-store";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { assistantPromptSourceIds, assistantRunMode, assistantRunTargets, assistantSystemPrompt, assistantWorkflowWithSources, executeAssistantTool, requestAssistantAction, type AssistantAction, type AssistantToolResult } from "@/services/api/canvas-assistant";
import type { AiTextMessage } from "@/services/api/image";
import { selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import type { CanvasGenerationMode, CanvasNodeData } from "@/types/canvas";
import { assistantDisplayDraft, assistantDraftWithReferences, assistantReadableDraft, assistantReferenceIds, assistantReferenceToken, insertAssistantReferences, type AssistantDraftSelection } from "@/lib/canvas/assistant-inline-references";
import { buildCanvasResourceReferences } from "@/lib/canvas/canvas-resource-references";
import { assistantImageParameters, explicitAssistantImageRequirements } from "@/lib/canvas/assistant-image-parameters";

export type CanvasAssistantContext = {
    snapshot: CanvasAgentSnapshot;
    getSnapshot: () => CanvasAgentSnapshot;
    getCreationCenter?: () => { x: number; y: number };
    applyOps: (ops: CanvasAgentOp[]) => CanvasAgentSnapshot;
    undoOps?: () => CanvasAgentSnapshot | null;
    canUndo?: boolean;
    runNode: (nodeId: string, mode?: CanvasGenerationMode, prompt?: string, signal?: AbortSignal) => Promise<CanvasNodeData | undefined>;
};
export type CanvasAssistantMessage = { id: string; role: "user" | "assistant" | "tool" | "error"; text: string; draft?: string; referenceLabels?: Record<string, string>; references?: string[]; models?: string[] };
export type CanvasAssistantSession = { id: string; projectId: string; title: string; model: string; messages: CanvasAssistantMessage[]; transcript: AiTextMessage[]; contextWindow?: number; turnHistoryLength?: number; recentPromptNodeIds?: string[]; turnPromptSourceIds?: string[]; knownNodeIds?: string[]; references: string[]; models: string[]; turnModels?: string[]; skillId?: string; turnSkillPrompt?: string; draft: string; running: boolean; status: string; pending?: AssistantAction; updatedAt: number };
export type CanvasAssistantGenerationMode = "manual" | "auto";
const generationModeKey = "blinkflow:canvas-assistant-generation-mode";
export function readCanvasAssistantGenerationMode(): CanvasAssistantGenerationMode {
    try { return localStorage.getItem(generationModeKey) === "auto" ? "auto" : "manual"; } catch { return "manual"; }
}

type ProjectSessions = { sessions: CanvasAssistantSession[]; currentId: string };
type CanvasAssistantStore = {
    generationMode: CanvasAssistantGenerationMode; setGenerationMode: (mode: CanvasAssistantGenerationMode) => void;
    open: boolean; context: CanvasAssistantContext | null; sessions: CanvasAssistantSession[]; currentId: string; loading: boolean; storageError: string;
    setOpen: (open: boolean) => void; setContext: (context: CanvasAssistantContext | null) => void; addReferences: (ids: string[]) => void;
    removeReference: (id: string) => void; toggleModel: (id: string) => void; setDraft: (draft: string) => void; setModel: (model: string) => void; setSkill: (id?: string) => void; setContextWindow: (count: number) => void;
    setDraftSelection: (selection: AssistantDraftSelection) => void; getDraftSelection: () => AssistantDraftSelection | undefined;

    createSession: () => void; selectSession: (id: string) => void; renameSession: (id: string, title: string) => void; deleteSession: (id: string) => void;
    send: () => Promise<void>; confirm: (accepted: boolean) => Promise<void>; stop: () => void; clearHistory: () => Promise<void>;
};
const db = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_assistant" });
const projects = new Map<string, ProjectSessions>();
const controllers = new Map<string, AbortController>();
const pendingReferences = new Map<string, string[]>();
// UI-only caret offsets survive leaving the editor for canvas selection, without persisting DOM ranges.
const draftSelections = new Map<string, AssistantDraftSelection>();
let storageEpoch = 0;
let writeQueue: Promise<unknown> = Promise.resolve();

function newSession(projectId: string): CanvasAssistantSession {
    const config = useConfigStore.getState().config, models = selectableModelsByCapability(config, "text");
    return { id: nanoid(), projectId, title: "新对话", model: models.includes(config.textModel) ? config.textModel : models[0] || "", messages: [], transcript: [], contextWindow: DEFAULT_ASSISTANT_CONTEXT_WINDOW, references: [], models: [], draft: "", running: false, status: "", updatedAt: Date.now() };
}
function projectOf(projectId: string) {
    let project = projects.get(projectId);
    if (!project) { const session = newSession(projectId); project = { sessions: [session], currentId: session.id }; projects.set(projectId, project); }
    return project;
}
function persist(projectId: string) {
    const data = projectOf(projectId);
    // Credentials, picture bytes, context callbacks and active request state never enter this database.
    const value = { sessions: data.sessions.map(({ running: _running, ...session }) => ({ ...session, running: false, status: session.pending ? "等待确认生成" : "" })), currentId: data.currentId };
    writeQueue = writeQueue.catch(() => undefined).then(() => db.setItem(projectId, value)).catch((error) => { useCanvasAssistantStore.setState({ storageError: `Agent 历史保存失败：${error instanceof Error ? error.message : String(error)}` }); });
}
function publish(projectId: string) {
    if (useCanvasAssistantStore.getState().context?.snapshot.projectId === projectId) useCanvasAssistantStore.setState({ ...projectOf(projectId) });
}
function patch(projectId: string, sessionId: string, update: (session: CanvasAssistantSession) => CanvasAssistantSession) {
    const project = projects.get(projectId);
    if (!project) return;
    project.sessions = project.sessions.map((session) => session.id === sessionId ? { ...update(session), updatedAt: Date.now() } : session);
    publish(projectId); persist(projectId);
}
function append(projectId: string, sessionId: string, role: CanvasAssistantMessage["role"], text: string, extras: Partial<CanvasAssistantMessage> = {}) {
    if (role === "error") recordDiagnostic("Agent", text, { projectId });
    patch(projectId, sessionId, (session) => ({ ...session, messages: [...session.messages, { id: nanoid(), role, text, ...extras }] }));
}
function active(): { context: CanvasAssistantContext; session: CanvasAssistantSession; projectId: string } | null {
    const state = useCanvasAssistantStore.getState(), context = state.context;
    if (!context) return null;
    const project = projectOf(context.snapshot.projectId), session = project.sessions.find((item) => item.id === project.currentId);
    return session ? { context, session, projectId: session.projectId } : null;
}
function expandReferences(context: CanvasAssistantContext, ids: string[]) {
    const nodes = context.getSnapshot().nodes, result = new Set<string>();
    const visit = (id: string) => { if (result.has(id)) return; const node = nodes.find((item) => item.id === id); if (!node) return; result.add(id); if (node.type === "group") nodes.filter((item) => item.metadata?.groupId === id).forEach((item) => visit(item.id)); };
    ids.forEach(visit); return [...result];
}
function actionName(action: AssistantAction) {
    return ({ read_assets: "查看素材", read_results: "读取运行结果", apply_workflow: "创建工作流", update_nodes: "更新节点参数", edit_canvas: "编辑画布", run_nodes: "等待确认生成", final: "完成" })[action.tool];
}
function toolMessage(action: AssistantAction, result: AssistantToolResult): AiTextMessage {
    const text = `工具 ${action.tool} 返回：${JSON.stringify(result.value)}`;
    return { role: "user", content: result.images?.length ? [{ type: "text", text }, ...result.images.flatMap((image): Exclude<AiTextMessage["content"], string> => [{ type: "text", text: `节点图片 ${image.nodeId}` }, { type: "image_url", image_url: { url: image.url } }])] : text };
}
function textOnly(message: AiTextMessage): AiTextMessage {
    return typeof message.content === "string" ? message : { ...message, content: message.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n") };
}
function assertProject(context: CanvasAssistantContext, projectId: string, signal: AbortSignal) {
    if (signal.aborted) throw new DOMException("已停止", "AbortError");
    if (useCanvasAssistantStore.getState().context?.snapshot.projectId !== projectId || context.getSnapshot().projectId !== projectId) throw new Error("当前画布已切换，Agent 已停止操作旧画布");
}
async function runGeneration(action: AssistantAction, context: CanvasAssistantContext, projectId: string, signal: AbortSignal, userDraft = ""): Promise<AssistantToolResult> {
    assertProject(context, projectId, signal);
    let targets = assistantRunTargets(action, context);
    const outcomes = [];
    if (!targets.length) throw new Error("Agent 未指定可运行节点");
    // Validate every target before the first generation request, in either approval mode.
    const runModes = targets.map(assistantRunMode);
    const requirements = explicitAssistantImageRequirements(userDraft), config = useConfigStore.getState().config;
    if (Object.keys(requirements).length) {
        const ops = targets.flatMap((node, index): CanvasAgentOp[] => runModes[index] === "image" && node.type !== "blinkflow:fusion" ? [{ type: "update_node", id: node.id, metadata: assistantImageParameters(requirements, node.metadata || {}, config) }] : []);
        if (ops.length) { context.applyOps(ops); targets = assistantRunTargets(action, context); }
    }
    for (const [index, node] of targets.entries()) {
        assertProject(context, projectId, signal);
        const output = await context.runNode(node.id, runModes[index], node.metadata?.composerContent || node.metadata?.prompt || "", signal);
        assertProject(context, projectId, signal);
        const graph = context.getSnapshot();
        const current = output || graph.nodes.find((item) => item.id === node.id);
        outcomes.push({ id: current?.id || node.id, sourceNodeId: node.id, width: current?.metadata?.naturalWidth, height: current?.metadata?.naturalHeight, parameters: { size: current?.metadata?.size, imageResolution: current?.metadata?.imageResolution }, exists: Boolean(current), status: current?.metadata?.status || "idle", error: current?.metadata?.errorDetails, images: current?.metadata?.images?.map((image) => ({ id: image.id, status: image.status, error: image.errorDetails, width: image.naturalWidth, height: image.naturalHeight })), hasOutput: Boolean(current?.metadata?.storageKey || current?.metadata?.content || current?.metadata?.images?.some((image) => image.status === "success")) });
    }
    return { value: { outcomes, note: "id是实际产物ID，sourceNodeId是输入节点。width/height为真实像素；参数不是产物证明。请按真实结果回答，必要时调用 read_results 查看实际产物ID，不要把旧输入图当作新结果。" } };
}
async function loop(context: CanvasAssistantContext, initial: CanvasAssistantSession, transcript: AiTextMessage[], controller: AbortController) {
    const { projectId, id } = initial, signal = controller.signal;
    const seen = new Map<string, CanvasAgentSnapshot>();
    try {
        while (!signal.aborted) {
            assertProject(context, projectId, signal);
            const session = projectOf(projectId).sessions.find((item) => item.id === id);
            if (!session) return;
            const config = useConfigStore.getState().config;
            patch(projectId, id, (value) => ({ ...value, running: true, status: "思考中" }));
            const proposed = await requestAssistantAction(config, session.model, [{ role: "system", content: assistantSystemPrompt(config, initial.turnModels || initial.models, useCanvasAssistantStore.getState().generationMode) + (initial.turnSkillPrompt || "") }, ...assistantContextMessages(transcript, initial.turnHistoryLength ?? transcript.length, session.contextWindow)], signal);
            assertProject(context, projectId, signal);
            const action = assistantWorkflowWithSources(proposed, context.getSnapshot(), session.turnPromptSourceIds || []);
            const fingerprint = JSON.stringify(action), before = context.getSnapshot(), previous = seen.get(fingerprint);
            if (previous && previous.nodes === before.nodes && previous.connections === before.connections && previous.viewport === before.viewport && previous.selectedNodeIds.length === before.selectedNodeIds.length && previous.selectedNodeIds.every((nodeId, index) => nodeId === before.selectedNodeIds[index])) throw new Error("Agent 重复同一操作且画布没有变化，已停止。请调整要求或更换对话模型后继续。");
            seen.set(fingerprint, before);
            transcript = [...transcript, { role: "assistant", content: JSON.stringify(action) }];
            patch(projectId, id, (value) => ({ ...value, transcript: transcript.map(textOnly), status: action.tool === "run_nodes" && useCanvasAssistantStore.getState().generationMode === "auto" ? "正在生成" : actionName(action) }));
            if (action.tool === "final") { append(projectId, id, "assistant", typeof action.args.message === "string" ? action.args.message : "已完成"); return; }
            if (action.tool === "run_nodes" && useCanvasAssistantStore.getState().generationMode === "manual") {
                const targets = assistantRunTargets(action, context);
                if (!targets.length) throw new Error("Agent 未指定可运行节点");
                patch(projectId, id, (value) => ({ ...value, pending: action, running: false, status: "等待确认生成" }));
                return;
            }
            let result: AssistantToolResult;
            try { result = action.tool === "run_nodes" ? await runGeneration(action, context, projectId, signal, session.messages.findLast((item) => item.role === "user")?.draft || "") : await executeAssistantTool(action, context, config, initial.turnModels || initial.models, signal, session.knownNodeIds || []); }
            catch (error) { if (signal.aborted) throw error; recordDiagnostic("Agent 工具", error, { projectId }); result = { value: { ok: false, error: error instanceof Error ? error.message : String(error) } }; }
            assertProject(context, projectId, signal);
            transcript = [...transcript, toolMessage(action, result)];
            const resolved = action.tool === "apply_workflow" ? (result.value as { resolvedNodes?: Array<{ id: string }> })?.resolvedNodes : undefined;
            const createdTextIds = Array.isArray(resolved) ? resolved.map((item) => item.id).filter((nodeId) => context.getSnapshot().nodes.some((node) => node.id === nodeId && node.type === "text")) : [];
            const beforeIds = new Set(before.nodes.map((node) => node.id));
            const createdIds = context.getSnapshot().nodes.filter((node) => !beforeIds.has(node.id)).map((node) => node.id);
            const readIds = action.tool === "read_assets" || action.tool === "read_results" ? ((result.value as { nodes?: Array<{ id: string }> })?.nodes || []).map((node) => node.id) : [];
            const outputIds = action.tool === "run_nodes" ? ((result.value as { outcomes?: Array<{ id: string }> })?.outcomes || []).map((node) => node.id) : [];
            patch(projectId, id, (value) => ({ ...value, knownNodeIds: [...new Set([...(value.knownNodeIds || []), ...createdIds, ...readIds, ...outputIds])], transcript: transcript.map(textOnly), ...(createdTextIds.length ? { recentPromptNodeIds: createdTextIds, turnPromptSourceIds: createdTextIds.length === 1 ? createdTextIds : [] } : {}) }));
            append(projectId, id, "tool", `${action.tool === "run_nodes" ? "生成结果" : actionName(action)}：${JSON.stringify(result.value)}`);
        }
    } catch (error) {
        if (!signal.aborted) append(projectId, id, "error", error instanceof Error ? error.message : String(error));
    } finally {
        if (controllers.get(id) === controller) { controllers.delete(id); patch(projectId, id, (value) => ({ ...value, running: false, status: value.pending ? "等待确认生成" : "" })); }
    }
}

export const useCanvasAssistantStore = create<CanvasAssistantStore>((set, get) => ({
    generationMode: readCanvasAssistantGenerationMode(),
    setGenerationMode: (mode) => {
        if (mode !== "manual" && mode !== "auto") return;
        set({ generationMode: mode });
        try { localStorage.setItem(generationModeKey, mode); } catch (error) { set({ storageError: `Agent 生成模式保存失败：${String(error)}` }); }
    },
    open: false, context: null, sessions: [], currentId: "", loading: false, storageError: "",
    setOpen: (open) => set({ open }),
    setContext: (context) => {
        const previousId = get().context?.snapshot.projectId, projectId = context?.snapshot.projectId;
        if (previousId === projectId) { set({ context }); return; }
        if (previousId) { const previous = projectOf(previousId); for (const session of previous.sessions) { controllers.get(session.id)?.abort(); controllers.delete(session.id); } previous.sessions = previous.sessions.map((session) => ({ ...session, running: false, status: session.pending ? "等待确认生成" : "" })); persist(previousId); }
        set({ context, sessions: [], currentId: "", loading: Boolean(context) });
        if (!context || !projectId) return;
        const finish = () => { if (get().context?.snapshot.projectId !== projectId) return; const pending = pendingReferences.get(projectId) || []; pendingReferences.delete(projectId); publish(projectId); set({ loading: false }); if (pending.length) get().addReferences(pending); };
        if (projects.has(projectId)) { finish(); return; }
        const epoch = storageEpoch;
        void db.getItem<ProjectSessions>(projectId).then((saved) => {
            if (epoch !== storageEpoch) return;
            if (!projects.has(projectId) && saved && Array.isArray(saved.sessions) && saved.sessions.every((session) => session.projectId === projectId)) projects.set(projectId, { sessions: saved.sessions.map((session) => ({ ...session, running: false })), currentId: saved.currentId });
            const data = projectOf(projectId); if (!data.sessions.length) { const session = newSession(projectId); data.sessions = [session]; data.currentId = session.id; }
            if (!data.sessions.some((session) => session.id === data.currentId)) data.currentId = data.sessions[0].id;
            finish();
        }).catch((error) => { if (epoch !== storageEpoch || get().context?.snapshot.projectId !== projectId) return; set({ storageError: `Agent 历史读取失败：${String(error)}` }); finish(); });
    },
    addReferences: (ids) => {
        const state = get(), context = state.context; if (!context) return;
        const projectId = context.snapshot.projectId;
        if (state.loading) { pendingReferences.set(projectId, [...new Set([...(pendingReferences.get(projectId) || []), ...ids])]); set({ open: true }); return; }
        const value = active(); if (!value) return;
        if (value.session.running || value.session.pending) { set({ open: true }); return; }
        const additions = expandReferences(context, ids);
        if (!additions.length) return;
        patch(projectId, value.session.id, (session) => {
            const inserted = insertAssistantReferences(session.draft, additions, draftSelections.get(session.id));
            draftSelections.set(session.id, inserted.selection);
            return { ...session, draft: inserted.draft, references: assistantReferenceIds(inserted.draft) };
        }); set({ open: true });
    },
    removeReference: (id) => { const value = active(); if (value) patch(value.projectId, value.session.id, (session) => ({ ...session, draft: session.draft.split(assistantReferenceToken(id)).join(""), references: session.references.filter((item) => item !== id) })); },
    toggleModel: (id) => { const value = active(); if (value) patch(value.projectId, value.session.id, (session) => ({ ...session, models: session.models.includes(id) ? session.models.filter((item) => item !== id) : [...session.models, id] })); },
    setDraft: (draft) => { const value = active(); if (value) patch(value.projectId, value.session.id, (session) => ({ ...session, draft, references: assistantReferenceIds(draft) })); },
    setDraftSelection: (selection) => { const value = active(); if (value) draftSelections.set(value.session.id, selection); },
    getDraftSelection: (): AssistantDraftSelection | undefined => { const value = active(); return value ? draftSelections.get(value.session.id) : undefined; },
    setModel: (model) => { const value = active(); if (value) patch(value.projectId, value.session.id, (session) => ({ ...session, model })); },
    setSkill: (skillId) => { const value = active(); if (value && !get().loading && !value.session.running && !value.session.pending) patch(value.projectId, value.session.id, (session) => ({ ...session, skillId })); },
    setContextWindow: (count) => { const value = active(); if (value && !get().loading && !value.session.running && !value.session.pending) patch(value.projectId, value.session.id, (session) => ({ ...session, contextWindow: normalizeAssistantContextWindow(count) })); },
    createSession: () => { const context = get().context; if (!context) return; const projectId = context.snapshot.projectId, project = projectOf(projectId), session = newSession(projectId); project.sessions = [session, ...project.sessions]; project.currentId = session.id; publish(projectId); persist(projectId); },
    selectSession: (id) => { const value = active(); if (!value || !projectOf(value.projectId).sessions.some((session) => session.id === id)) return; projectOf(value.projectId).currentId = id; publish(value.projectId); persist(value.projectId); },
    renameSession: (id, title) => { const value = active(); if (value && title.trim()) patch(value.projectId, id, (session) => ({ ...session, title: title.trim() })); },
    deleteSession: (id) => { const value = active(); if (!value) return; draftSelections.delete(id); controllers.get(id)?.abort(); controllers.delete(id); const project = projectOf(value.projectId); project.sessions = project.sessions.filter((session) => session.id !== id); if (!project.sessions.length) project.sessions = [newSession(value.projectId)]; if (project.currentId === id) project.currentId = project.sessions[0].id; publish(value.projectId); persist(value.projectId); },
    send: async () => {
        const value = active(); if (!value || get().loading || value.session.running || value.session.pending) return;
        const { session, projectId, context } = value;
        if (isHarnessCanvasBusy(projectId)) { append(projectId, session.id, "error", "DeepSeek Harness 正在操作当前画布，请等待完成后再发送。输入内容已保留。"); return; }
        if (!session.draft.trim() && !session.references.length) return;
        const controller = new AbortController(); controllers.set(session.id, controller);
        // Lock this turn before asynchronous Skill loading, so double-clicks cannot submit twice.
        patch(projectId, session.id, (item) => ({ ...item, running: true, status: "读取会话配置" }));
        try {
            await loadAssistantSkills();
            assertProject(context, projectId, controller.signal);
            const skill = getAssistantSkill(session.skillId);
            if (session.skillId && !skill) throw new Error("当前会话的 Skill 已不存在，请重新选择或取消该 Skill");
            const turnSkillPrompt = buildAssistantSkillPrompt(skill);
            const nodes = context.getSnapshot().nodes;
            const draft = assistantDraftWithReferences(session.draft, session.references);
            const labels = new Map(buildCanvasResourceReferences(nodes).map((item) => [item.nodeId, item.kind === "image" ? item.label : item.title]));
            const references = assistantReferenceIds(draft), models = [...session.models];
            const referenceLabels = Object.fromEntries(references.map((id) => [id, labels.get(id) || nodes.find((node) => node.id === id)?.title || "已移除节点"]));
            const displayText = assistantDisplayDraft(draft, (id) => referenceLabels[id]);
            const text = assistantReadableDraft(draft, (id) => nodes.find((node) => node.id === id)?.title || id).trim() || "请分析这些节点";
            const turnPromptSourceIds = assistantPromptSourceIds(context.getSnapshot(), references, text, session.recentPromptNodeIds);
            const knownNodeIds = [...new Set([...(session.knownNodeIds || []), ...session.messages.flatMap((item) => item.references || []), ...references, ...turnPromptSourceIds])];
            const user: AiTextMessage = { role: "user", content: `${text}\n本次引用节点ID：${JSON.stringify(references)}\n本次指定生成模型ID：${JSON.stringify(models)}\n本次提示词源节点ID：${JSON.stringify(turnPromptSourceIds)}` };
            const turnHistoryLength = session.transcript.length;
            let transcript = [...session.transcript, user];
            draftSelections.delete(session.id);
            patch(projectId, session.id, (item) => ({ ...item, running: true, draft: "", references: [], models: [], knownNodeIds, turnModels: models, turnSkillPrompt, turnHistoryLength, turnPromptSourceIds, title: item.messages.length ? item.title : displayText.trim().split("\n")[0], transcript, pending: undefined, messages: [...item.messages, { id: nanoid(), role: "user", text: displayText, draft, referenceLabels, references, models }] }));
            const inputNodeIds = [...new Set([...references, ...turnPromptSourceIds])];
            if (inputNodeIds.length) {
                try { const result = await executeAssistantTool({ tool: "read_assets", args: { nodeIds: inputNodeIds } }, context, useConfigStore.getState().config, models, controller.signal, knownNodeIds);
                    const readIds = ((result.value as { nodes?: Array<{ id: string }> })?.nodes || []).map((node) => node.id);
                    patch(projectId, session.id, (item) => ({ ...item, knownNodeIds: [...new Set([...(item.knownNodeIds || []), ...readIds])] }));
                    transcript = [...transcript, toolMessage({ tool: "read_assets", args: {} }, result)]; }
                catch (error) { if (!controller.signal.aborted) append(projectId, session.id, "error", `读取引用失败：${error instanceof Error ? error.message : String(error)}`); }
            }
            await loop(context, { ...session, knownNodeIds, models, turnModels: models, turnSkillPrompt, turnHistoryLength, turnPromptSourceIds }, transcript, controller);
        } catch (error) {
            if (!controller.signal.aborted) append(projectId, session.id, "error", error instanceof Error ? error.message : String(error));
        } finally {
            if (controllers.get(session.id) === controller) { controllers.delete(session.id); patch(projectId, session.id, (item) => ({ ...item, running: false, status: item.pending ? "等待确认生成" : "" })); }
        }
    },
    confirm: async (accepted) => {
        const value = active(); if (!value?.session.pending || value.session.running) return;
        const { session, context, projectId } = value, action = session.pending!;
        const controller = new AbortController(); controllers.set(session.id, controller);
        patch(projectId, session.id, (item) => ({ ...item, running: true, pending: undefined, status: accepted ? "正在生成" : "已取消本次生成" }));
        let result: AssistantToolResult;
        if (!accepted) result = { value: { cancelled: true, note: "用户取消生成，已经建好的节点和连线保留，不要重复请求运行同一批节点。" } };
        else {
            try {
                result = await runGeneration(action, context, projectId, controller.signal, session.messages.findLast((item) => item.role === "user")?.draft || "");
            } catch (error) { if (!controller.signal.aborted) recordDiagnostic("Agent 生成", error, { projectId }); result = { value: { ok: false, error: error instanceof Error ? error.message : String(error) } }; }
        }
        if (controller.signal.aborted) return;
        const outcomes = (result.value as { outcomes?: Array<{ id: string }> })?.outcomes || [];
        patch(projectId, session.id, (item) => ({ ...item, knownNodeIds: [...new Set([...(item.knownNodeIds || []), ...outcomes.map((outcome) => outcome.id)])] }));
        append(projectId, session.id, "tool", `${accepted ? "生成结果" : "取消生成"}：${JSON.stringify(result.value)}`);
        await loop(context, session, [...session.transcript, toolMessage(action, result)], controller);
    },
    stop: () => { const value = active(); if (!value) return; controllers.get(value.session.id)?.abort(); controllers.delete(value.session.id); patch(value.projectId, value.session.id, (session) => ({ ...session, running: false, pending: undefined, status: "Agent 已停止，已提交的生成任务与画布内容保留" })); },
    clearHistory: async () => { storageEpoch += 1; for (const controller of controllers.values()) controller.abort(); controllers.clear(); projects.clear(); pendingReferences.clear(); draftSelections.clear(); await writeQueue.catch(() => undefined); await db.clear(); const context = get().context; set({ sessions: [], currentId: "", loading: false, storageError: "" }); if (context) { projectOf(context.snapshot.projectId); publish(context.snapshot.projectId); } },
}));
