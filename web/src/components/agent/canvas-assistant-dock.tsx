import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { AtSign, Bot, Box, ChevronDown, Copy, Maximize2, MessageSquare, Minus, Plus, Send, Square, Trash2, Undo2, X } from "lucide-react";
import { useCopyText } from "@/hooks/use-copy-text";

import { ASSISTANT_CONTEXT_WINDOWS, normalizeAssistantContextWindow } from "@/lib/canvas/assistant-context-window";
import { CanvasAssistantSkills } from "@/components/agent/canvas-assistant-skills";
import { CanvasAssistantGenerationMode } from "@/components/agent/canvas-assistant-generation-mode";
import { canvasThemes } from "@/lib/canvas-theme";
import { anchorAssistantDock, clampAssistantDock, clampAssistantWindow, moveAssistantDock, resizeAssistantWindow, type AssistantResizeDirection, type AssistantWindow, type AssistantDockLayout } from "@/lib/canvas/assistant-dock-layout";
import { useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useCanvasAssistantStore, type CanvasAssistantMessage } from "@/stores/use-canvas-assistant-store";
import { useThemeStore } from "@/stores/use-theme-store";

import { CanvasPromptChipInput, type PromptChipInputHandle } from "@/components/canvas/canvas-prompt-chip-input";
import { buildCanvasResourceReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { assistantDraftWithReferences, assistantReferenceToken } from "@/lib/canvas/assistant-inline-references";

const layoutKey = "blinkflow:canvas-assistant-layout";
const editorLayoutKey = "blinkflow:canvas-assistant-editor-layout";
const sidebarWidthKey = "blinkflow:canvas-assistant-sidebar-width";
const sidebarWidth = (width: number) => clampAssistantWindow({ x: 8, y: 8, width, height: 240 }, viewport()).width;
function initialSidebarWidth() {
    try { const width = Number(localStorage.getItem(sidebarWidthKey)); if (Number.isFinite(width) && width > 0) return sidebarWidth(width); } catch { /* UI preference only. */ }
    return sidebarWidth(420);
}
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function defaultLayout(): AssistantDockLayout {
    return anchorAssistantDock({ orbX: Math.max(12, window.innerWidth - 82), orbY: Math.max(70, window.innerHeight - 105), x: 8, y: 8, height: Math.max(260, Math.min(650, window.innerHeight - 110)) }, viewport());
}
function initialLayout() {
    try { const value: unknown = JSON.parse(localStorage.getItem(layoutKey) || "null"); if (value && typeof value === "object" && Object.values(value).every((field) => typeof field === "number" && Number.isFinite(field)) && ["orbX", "orbY", "x", "y", "height"].every((key) => key in value)) return "width" in value ? clampAssistantDock(value as AssistantDockLayout, viewport()) : anchorAssistantDock(value as AssistantDockLayout, viewport()); } catch { /* Tiny UI preferences must not stop the Agent. */ }
    return defaultLayout();
}
function initialEditorLayout(): AssistantWindow {
    try { const value = JSON.parse(localStorage.getItem(editorLayoutKey) || "null"); if (value && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key]))) return clampAssistantWindow(value, viewport()); } catch { /* UI layout only. */ }
    return clampAssistantWindow({ x: 40, y: 70, width: 680, height: Math.min(620, window.innerHeight - 100) }, viewport());
}
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
const button = "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40";

/** Display-only grouping: stored history and the transcript sent to the model stay intact. */
export function assistantMessageRows(messages: CanvasAssistantMessage[]) {
    const rows: (CanvasAssistantMessage | { id: string; steps: CanvasAssistantMessage[] })[] = [];
    let process: { id: string; steps: CanvasAssistantMessage[] } | undefined;
    for (const message of messages) {
        if (message.role === "user") process = undefined;
        if (message.role !== "tool") { rows.push(message); continue; }
        if (!process) { process = { id: message.id, steps: [] }; rows.push(process); }
        process.steps.push(message);
    }
    return rows;
}
export function CanvasAssistantDock() {
    const store = useCanvasAssistantStore(), config = useConfigStore((state) => state.config), colorTheme = useThemeStore((state) => state.theme), theme = canvasThemes[colorTheme];
    useNodeRegistryVersion((state) => state.version);
    const [layout, setLayout] = useState(initialLayout), [menu, setMenu] = useState<"models" | null>(null), [query, setQuery] = useState(""), [renaming, setRenaming] = useState(false), [name, setName] = useState(""), [expanded, setExpanded] = useState(false);
    const copyText = useCopyText();
    const [width, setWidth] = useState(initialSidebarWidth), widthRef = useRef(width);
    const [panelHeight, setPanelHeight] = useState(window.innerHeight);
    widthRef.current = width;
    const [editorLayout, setEditorLayout] = useState(initialEditorLayout), editorLayoutRef = useRef(editorLayout);
    editorLayoutRef.current = editorLayout;
    const expandedTextarea = useRef<PromptChipInputHandle>(null);
    const textarea = useRef<PromptChipInputHandle>(null), end = useRef<HTMLDivElement>(null), currentLayout = useRef(layout), moved = useRef(false), dragCleanup = useRef<(() => void) | null>(null);
    const session = store.sessions.find((item) => item.id === store.currentId), snapshot = store.context?.snapshot;
    currentLayout.current = layout;
    const imageModels = selectableModelsByCapability(config, "image"), videoModels = selectableModelsByCapability(config, "video"), textModels = selectableModelsByCapability(config, "text");
    const modelLabel = (id: string) => modelOptionLabel(config, id);
    const nodeLabel = (id: string) => snapshot?.nodes.find((node) => node.id === id)?.title || "已移除节点";
    const references = useMemo(() => {
        const resources = new Map(buildCanvasResourceReferences(snapshot?.nodes || []).map((item) => [item.nodeId, item]));
        const nodes: CanvasResourceReference[] = (snapshot?.nodes || []).map((node) => ({ id: node.id, nodeId: node.id, kind: "text", title: node.title || node.id, active: true, ...resources.get(node.id), mentionLabel: resources.get(node.id)?.kind === "image" ? resources.get(node.id)?.label : undefined, label: assistantReferenceToken(node.id) }));
        for (const id of session?.references || []) if (!nodes.some((node) => node.nodeId === id)) nodes.push({ id, nodeId: id, kind: "text", title: id, active: true, label: assistantReferenceToken(id) });
        return [...nodes, ...[...imageModels, ...videoModels].map((id): CanvasResourceReference => ({ id: `model:${id}`, nodeId: id, kind: "text", active: true, label: `@[model:${id}]`, title: modelLabel(id), text: imageModels.includes(id) ? "图片模型" : "视频模型" }))];
    }, [snapshot?.nodes, session?.references, config]);
    const draft = assistantDraftWithReferences(session?.draft || "", session?.references || []);
    const messageReferences = (message: NonNullable<typeof session>["messages"][number]) => (message.references || []).map((id) => {
        const reference = references.find((item) => item.nodeId === id);
        const title = message.referenceLabels?.[id] || reference?.mentionLabel || reference?.title || "已移除节点";
        return { id, nodeId: id, kind: "text" as const, active: true, title, ...reference, mentionLabel: title, label: assistantReferenceToken(id) };
    });
    const readOnly = !session || store.loading || session.running || Boolean(session.pending);
    const selectReference = (reference: CanvasResourceReference) => { if (!reference.id.startsWith("model:")) return false; store.toggleModel(reference.nodeId); return true; };
    useEffect(() => {
        const resize = () => {
            setWidth(sidebarWidth(widthRef.current));
            setPanelHeight(window.innerHeight);
            const next = clampAssistantDock(currentLayout.current, viewport());
            currentLayout.current = next;
            setLayout(next);
            const editor = clampAssistantWindow(editorLayoutRef.current, viewport()); editorLayoutRef.current = editor; setEditorLayout(editor);
        };
        window.addEventListener("resize", resize);
        return () => { window.removeEventListener("resize", resize); dragCleanup.current?.(); };
    }, []);

    useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [session?.id, session?.messages.length, session?.pending, store.open]);
    useEffect(() => { setMenu(null); setRenaming(false); }, [store.currentId, snapshot?.projectId]);
    useEffect(() => { setExpanded(false); }, [store.currentId, snapshot?.projectId, store.open]);
    useEffect(() => {
        if (!session || session.model || !textModels.length) return;
        store.setModel(textModels.includes(config.textModel) ? config.textModel : textModels[0]);
    }, [session?.id, session?.model, textModels.join("\u0000"), config.textModel]);

    const drag = (event: ReactPointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); dragCleanup.current?.();
        const start = { x: event.clientX, y: event.clientY, layout: currentLayout.current };
        moved.current = false;
        const onMove = (next: PointerEvent) => {
            const dx = next.clientX - start.x, dy = next.clientY - start.y;
            if (Math.hypot(dx, dy) > 4) moved.current = true;
            const nextLayout = moveAssistantDock(start.layout, dx, dy, "orb", viewport());
            // Pointer-up may precede React's next render, so persist the actual final drag.
            currentLayout.current = nextLayout;
            setLayout(nextLayout);
        };
        const finish = () => {
            window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); dragCleanup.current = null;
            try { localStorage.setItem(layoutKey, JSON.stringify(currentLayout.current)); } catch { /* Layout persistence is optional. */ }
        };
        dragCleanup.current = finish; window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    };
    const resizeWindow = (event: ReactPointerEvent<HTMLElement>, target: "sidebar" | "editor" | "input" | "editor-move", direction: AssistantResizeDirection = "se") => {
        if (event.button !== 0 || target === "editor-move" && (event.target as Element).closest("button")) return;
        event.preventDefault(); event.stopPropagation(); dragCleanup.current?.();
        const start = { x: event.clientX, y: event.clientY, panel: currentLayout.current, editor: editorLayoutRef.current, width: widthRef.current };
        const onMove = (next: PointerEvent) => {
            const dx = next.clientX - start.x, dy = next.clientY - start.y;
            if (target === "input") {
                const inputHeight = Math.max(80, Math.min((start.panel.inputHeight ?? 80) - dy, Math.max(80, panelHeight - 280)));
                currentLayout.current = { ...currentLayout.current, inputHeight }; setLayout(currentLayout.current);
            } else if (target === "sidebar") {
                widthRef.current = sidebarWidth(start.width - dx); setWidth(widthRef.current);
            } else {
                const rect = target === "editor-move" ? clampAssistantWindow({ ...start.editor, x: start.editor.x + dx, y: start.editor.y + dy }, viewport()) : resizeAssistantWindow(start.editor, dx, dy, direction, viewport());
                editorLayoutRef.current = rect; setEditorLayout(rect);
            }
        };
        const finish = () => {
            window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); dragCleanup.current = null;
            try { localStorage.setItem(layoutKey, JSON.stringify(currentLayout.current)); localStorage.setItem(editorLayoutKey, JSON.stringify(editorLayoutRef.current)); localStorage.setItem(sidebarWidthKey, String(widthRef.current)); } catch { /* Optional layout preference. */ }
        };
        dragCleanup.current = finish; window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
    };
    const closeEditor = () => { setExpanded(false); requestAnimationFrame(() => textarea.current?.focus()); };
    useEffect(() => { if (expanded) expandedTextarea.current?.focus(); }, [expanded]);
    if (!store.context) return null;
    const panelStyle: CSSProperties = { position: "relative", width: "100%", height: "100%", background: theme.node.panel, color: theme.node.text, borderLeft: `1px solid ${theme.toolbar.border}` };
    const inputStyle: CSSProperties = { background: "transparent", color: theme.node.text, border: `1px solid ${theme.node.stroke}`, borderRadius: 7, padding: "5px 7px" };
    const chooseModel = (id: string) => { store.toggleModel(id); setMenu(null); setQuery(""); textarea.current?.focus(); };
    const filteredModels = (ids: string[]) => ids.filter((id) => modelLabel(id).toLowerCase().includes(query.toLowerCase()));
    const renderModels = (title: string, ids: string[]) => <section className="mb-3"><div className="mb-1 px-2 text-xs" style={{ color: theme.node.muted }}>{title}</div>{filteredModels(ids).map((id) => <button key={id} type="button" className={`${button} w-full !justify-start text-left`} style={session?.models.includes(id) ? { background: theme.toolbar.activeBg } : undefined} onClick={() => chooseModel(id)}><Box size={14} /><span className="min-w-0 flex-1 break-all">{modelLabel(id)}</span>{session?.models.includes(id) ? "✓" : ""}</button>)}{!filteredModels(ids).length && <p className="px-2 py-1 text-xs" style={{ color: theme.node.faint }}>暂无{title}模型</p>}</section>;
    const renderMessage = (message: CanvasAssistantMessage) => <article key={message.id} className="rounded-lg p-2 text-xs leading-6" style={{ background: message.role === "user" ? theme.toolbar.activeBg : "transparent", border: message.role === "error" ? `1px solid ${theme.node.stroke}` : undefined }}>
                    <div className="mb-1 flex items-center text-[10px]" style={{ color: theme.node.muted }}>{message.role === "user" ? "你" : message.role === "tool" ? "工具" : message.role === "error" ? "执行提示" : "Agent"}<button type="button" className={`${button} ml-auto`} aria-label="复制此条消息" title="复制此条消息" onClick={() => copyText(message.text.replace(/（节点ID:[^）]*）/g, ""))}><Copy size={12} /></button></div>
                    {message.role === "tool" ? <details><summary className="cursor-pointer" style={{ color: theme.node.muted }}>{message.text.split("：")[0]}</summary><pre className="whitespace-pre-wrap break-all font-sans">{message.text}</pre></details> : message.draft !== undefined ? <CanvasPromptChipInput ariaLabel="已发送消息正文" value={message.draft} references={messageReferences(message)} onChange={() => {}} readOnly showReferenceTitle imageHoverPreview className="text-xs leading-6" /> : <p className="whitespace-pre-wrap break-words">{message.text}</p>}
                    {((!message.draft && message.references?.length) || message.models?.length) ? <div className="mt-1 flex flex-wrap gap-1" style={{ color: theme.node.muted }}>{!message.draft && message.references?.map((id) => <span key={id} className="rounded border px-1" style={{ borderColor: theme.node.stroke }}>@{nodeLabel(id)}</span>)}{message.models?.map((id) => <span key={id} className="rounded border px-1" style={{ borderColor: theme.node.stroke }}><Box className="mr-1 inline" size={11} />{modelLabel(id)}</span>)}</div> : null}
                </article>;
    return <div data-canvas-overlay data-canvas-no-zoom data-canvas-assistant className="relative h-full shrink-0" style={{ width: store.open ? width : 0, zIndex: 240 }} onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop} onContextMenu={stop} onKeyDown={stop} onKeyUp={stop} onWheel={stop}>
        {!store.open && <button type="button" data-assistant-orb aria-label="打开 Agent" title="Agent（可拖动）" className="fixed flex h-14 w-14 cursor-grab flex-col items-center justify-center rounded-full active:cursor-grabbing" style={{ zIndex: 240, left: layout.orbX, top: layout.orbY, background: theme.toolbar.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}`, boxShadow: "0 5px 22px rgba(0,0,0,.16)", touchAction: "none" }} onPointerDown={drag} onClick={() => { if (!moved.current) store.setOpen(true); moved.current = false; }}><Bot size={21} /><span className="text-[9px]">Agent</span></button>}
        <section data-assistant-panel data-canvas-overlay data-canvas-no-zoom role="dialog" aria-label="Agent 右侧面板" style={{ ...panelStyle, display: store.open ? "flex" : "none" }} className="flex-col">
            <header data-assistant-header className="flex shrink-0 items-center gap-1 border-b px-3 py-2" style={{ borderColor: theme.node.stroke }}>
                <Bot size={17} /><strong className="mr-auto text-sm">Agent</strong>
                <button type="button" className={button} aria-label="撤销 Agent 画布操作" title="撤销 Agent 最近一次画布操作" disabled={!store.context?.canUndo || session?.running} onClick={() => store.context?.undoOps?.()}><Undo2 size={15} /></button>
                <button type="button" className={button} aria-label="新建 Agent 对话" title="新建对话" disabled={store.loading} onClick={store.createSession}><Plus size={15} /></button>
                <button type="button" className={button} aria-label="重命名 Agent 对话" title="重命名对话" disabled={!session} onClick={() => { setName(session?.title || ""); setRenaming(!renaming); }}>✎</button>
                <button type="button" className={button} aria-label="删除 Agent 对话" title="删除当前对话" disabled={!session} onClick={() => session && store.deleteSession(session.id)}><Trash2 size={14} /></button>
                <button type="button" className={button} aria-label="收起 Agent" title="收起（任务继续）" onClick={() => store.setOpen(false)}><Minus size={16} /></button>
            </header>
            <div className="flex shrink-0 items-center gap-2 px-3 pt-2">
                <MessageSquare size={14} /><select aria-label="Agent 会话" className="min-w-0 flex-1 text-xs" style={inputStyle} value={store.currentId} onChange={(event) => store.selectSession(event.target.value)}>{store.sessions.map((item) => <option key={item.id} value={item.id}>{item.title}{item.running ? " · 运行中" : item.pending ? " · 待确认" : ""}</option>)}</select><ChevronDown size={12} />
            </div>
            {renaming && session && <form className="flex gap-1 px-3 pt-2" onSubmit={(event) => { event.preventDefault(); store.renameSession(session.id, name); setRenaming(false); }}><input aria-label="对话名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 text-xs" style={inputStyle} /><button type="submit" className={button}>保存</button><button type="button" className={button} onClick={() => setRenaming(false)}>取消</button></form>}
            <main className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3" data-node-scroll>
                {store.loading && <p className="text-xs" style={{ color: theme.node.muted }}>正在读取会话…</p>}
                {!store.loading && !session?.messages.length && <p className="py-6 text-center text-xs leading-6" style={{ color: theme.node.muted }}>描述你的创意，Agent 会把工作流建到画布。<br />选择节点可添加为素材；{store.generationMode === "auto" ? "自动生成模式会直接执行生成。" : "生成前会让你确认。"}</p>}
                {assistantMessageRows(session?.messages || []).map((row) => "steps" in row ? <details key={row.id} data-assistant-process className="rounded-lg px-2 text-xs leading-6">
                    <summary className="cursor-pointer" style={{ color: theme.node.muted }}>执行过程（{row.steps.length} 步）</summary>
                    <div className="space-y-1 pt-1">{row.steps.map(renderMessage)}</div>
                </details> : renderMessage(row))}
                {session?.pending && <div data-assistant-confirm className="rounded-lg border p-3 text-xs" style={{ borderColor: theme.node.stroke }}><strong>确认执行生成？</strong><p className="my-2">{Array.isArray(session.pending.args.nodeIds) ? session.pending.args.nodeIds.map(String).map(nodeLabel).join("、") : "指定节点"}</p><p className="mb-2" style={{ color: theme.node.muted }}>使用节点中选好的渠道和模型。取消后保留工作流。</p><div className="flex gap-2"><button type="button" className={button} onClick={() => void store.confirm(true)}>确认生成</button><button type="button" className={button} onClick={() => void store.confirm(false)}>取消生成</button></div></div>}
                <div ref={end} />
            </main>
            {store.storageError && <p role="alert" className="px-3 text-xs">{store.storageError}</p>}
            <div className="shrink-0 px-3 pb-2">
                <button type="button" aria-label="调整 Agent 输入区高度" title="上下拖动调整输入区高度" className="mb-1 flex h-3 w-full cursor-ns-resize items-center justify-center" style={{ touchAction: "none" }} onPointerDown={(event) => resizeWindow(event, "input")}><span className="h-1 w-8 rounded" style={{ background: theme.node.stroke }} /></button>
                <label className="mb-2 flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>历史回读<select aria-label="Agent 历史回读条数" disabled={readOnly} className="min-w-0 flex-1" style={inputStyle} value={normalizeAssistantContextWindow(session?.contextWindow)} onChange={(event) => store.setContextWindow(Number(event.target.value))}>{ASSISTANT_CONTEXT_WINDOWS.map((count) => <option key={count} value={count}>最近 {count} 条</option>)}</select></label>
                <div className="mb-2"><CanvasAssistantSkills activeId={session?.skillId} onSelect={store.setSkill} disabled={!session || store.loading || session.running || Boolean(session.pending)} /></div>
                <label className="mb-2 flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>对话模型<select data-assistant-chat-model aria-label="Agent 对话模型" disabled={session?.running} className="min-w-0 flex-1" style={inputStyle} value={session?.model || ""} onChange={(event) => store.setModel(event.target.value)}><option value="">请选择对话模型</option>{textModels.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</select></label>
                <div className="relative rounded-xl border p-2" style={{ borderColor: theme.node.stroke }}>
                    {session?.models.length ? <div data-assistant-chips className="mb-2 flex max-h-28 flex-wrap gap-1 overflow-auto">{session.models.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: theme.node.stroke }}><Box size={12} /><span className="max-w-64 truncate" title={modelLabel(id)}>{modelLabel(id)}</span><button type="button" title="移除模型引用" aria-label={`移除模型 ${modelLabel(id)}`} onClick={() => store.toggleModel(id)}><X size={12} /></button></span>)}</div> : null}
                    <CanvasPromptChipInput key={session?.id} inputRef={textarea} ariaLabel="Agent 消息" placeholder="描述需求，@ 节点或图片 / 视频模型" className="w-full bg-transparent text-xs leading-6" style={{ height: Math.min(layout.inputHeight ?? 80, Math.max(80, panelHeight - 280)) }} onSelectionChange={store.setDraftSelection} getSelection={store.getDraftSelection} value={draft} references={references} readOnly={readOnly} showReferenceTitle imageHoverPreview onReferenceSelect={selectReference} onChange={store.setDraft} onSubmit={() => void store.send()} />
                    <div className="flex items-center gap-1 border-t pt-1" style={{ borderColor: theme.node.stroke }}>
                        <button type="button" className={button} aria-label="添加选中节点到 Agent" title="添加选中节点" disabled={!snapshot?.selectedNodeIds.length} onClick={() => store.addReferences(snapshot?.selectedNodeIds || [])}><Plus size={15} /></button>
                        <button type="button" data-assistant-mention className={button} aria-label="引用节点或模型" title="@ 节点 / 模型" disabled={readOnly} onClick={() => textarea.current?.openMention()}><AtSign size={16} /></button>
                        <button type="button" data-assistant-models className={button} aria-label="图片和视频生成模型" title="选择生成模型" onClick={() => { setMenu(menu === "models" ? null : "models"); setQuery(""); }}><Box size={16} /></button>
                        <button type="button" className={button} aria-label="全屏编辑 Agent 输入" title="大窗口查看 / 编辑文字（可拖动缩放）" disabled={!session} onClick={() => { setMenu(null); setExpanded(true); }}><Maximize2 size={15} /></button>
                        <CanvasAssistantGenerationMode />
                        <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: theme.node.muted }} title={session?.status}>{session?.status}</span>
                        {session?.running ? <button type="button" className={button} aria-label="停止 Agent" onClick={store.stop}><Square size={16} /></button> : <button type="button" className={button} aria-label="发送 Agent 消息" disabled={!session || Boolean(session.pending) || (!session.draft.trim() && !session.references.length)} onClick={() => void store.send()}><Send size={17} /></button>}
                    </div>
                    {menu && <div data-canvas-overlay data-canvas-no-zoom data-assistant-menu role="dialog" aria-label="选择生成模型" className="absolute bottom-full left-0 z-10 mb-2 w-full overflow-auto rounded-xl border p-2" style={{ maxHeight: Math.max(180, panelHeight - 210), background: theme.node.panel, borderColor: theme.node.stroke, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
                        <div className="mb-2 flex gap-1"><input aria-label="搜索节点或模型" placeholder="搜索" className="min-w-0 flex-1 text-xs" style={inputStyle} value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" className={button} aria-label="关闭模型菜单" onClick={() => setMenu(null)}><X size={14} /></button></div>

                        {renderModels("图片", imageModels)}{renderModels("视频", videoModels)}
                    </div>}
                </div>
            </div>
            <div data-assistant-sidebar-resize data-assistant-resize="w" role="separator" aria-label="调整 Agent 侧栏宽度" aria-orientation="vertical" style={{ position: "absolute", left: -3, top: 0, bottom: 0, width: 7, zIndex: 5, cursor: "col-resize", touchAction: "none" }} onPointerDown={(event) => resizeWindow(event, "sidebar")} />
        </section>
        {expanded && store.open && session && <section data-canvas-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore data-assistant-editor role="dialog" aria-label="Agent 大窗口编辑" className="fixed flex flex-col rounded-2xl border p-3 shadow-2xl" style={{ ...editorLayout, left: editorLayout.x, top: editorLayout.y, position: "fixed", zIndex: 260, background: theme.node.panel, color: theme.node.text, borderColor: theme.node.stroke }}>
            <header className="mb-2 flex shrink-0 cursor-grab items-center gap-2" style={{ touchAction: "none" }} onPointerDown={(event) => resizeWindow(event, "editor-move")}><strong className="mr-auto text-sm">Agent 大窗口编辑</strong><button type="button" className={button} aria-label="关闭 Agent 大窗口编辑" onClick={closeEditor}><X size={16} /></button></header>
            <p className="mb-2 shrink-0 text-xs" style={{ color: theme.node.muted }}>{session.running || session.pending ? "任务进行中，仅查看当前输入。" : "修改实时保留；可在窗口外选择画布图片，再添加到光标处。"}</p>
            <CanvasPromptChipInput key={session.id} inputRef={expandedTextarea} onEscape={closeEditor} ariaLabel="Agent 全屏输入文字" containerClassName="min-h-0 flex-1 flex flex-col" className="thin-scrollbar min-h-0 w-full flex-1 rounded-xl border p-3 text-base leading-7" style={{ background: "transparent", borderColor: theme.node.stroke, color: theme.node.text }} value={draft} references={references} readOnly={readOnly} showReferenceTitle imageHoverPreview onReferenceSelect={selectReference} onChange={store.setDraft} onSelectionChange={store.setDraftSelection} getSelection={store.getDraftSelection} placeholder="在这里查看和编辑完整输入文字，@ 引用节点或模型" />
            <footer className="mt-2 flex shrink-0 justify-end"><button type="button" className={button} onClick={closeEditor}>完成编辑</button></footer>
            <ResizeHandles label="Agent 大窗口编辑" onResize={(event, direction) => resizeWindow(event, "editor", direction)} />
        </section>}
    </div>;
}

function ResizeHandles({ label, onResize }: { label: string; onResize: (event: ReactPointerEvent<HTMLElement>, direction: AssistantResizeDirection) => void }) {
    const handles: [AssistantResizeDirection, CSSProperties][] = [
        ["n", { top: -3, left: 10, right: 10, height: 7 }], ["s", { bottom: -3, left: 10, right: 10, height: 7 }],
        ["w", { left: -3, top: 10, bottom: 10, width: 7 }], ["e", { right: -3, top: 10, bottom: 10, width: 7 }],
        ["nw", { left: -3, top: -3 }], ["ne", { right: -3, top: -3 }], ["sw", { left: -3, bottom: -3 }], ["se", { right: -3, bottom: -3 }],
    ];
    return handles.map(([direction, style]) => <div key={direction} data-assistant-resize={direction} aria-label={"调整 " + label + " 大小 " + direction} style={{ position: "absolute", zIndex: 5, ...(direction.length === 2 ? { width: 12, height: 12 } : {}), ...style, cursor: direction + "-resize", touchAction: "none" }} onPointerDown={(event) => onResize(event, direction)} />);
}
