import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AtSign, Bot, Box, ChevronDown, Maximize2, MessageSquare, Minus, Plus, Send, Square, Trash2, X } from "lucide-react";
import { Modal } from "antd";

import { CanvasAssistantSkills } from "@/components/agent/canvas-assistant-skills";
import { CanvasAssistantGenerationMode } from "@/components/agent/canvas-assistant-generation-mode";
import { canvasThemes } from "@/lib/canvas-theme";
import { anchorAssistantDock, moveAssistantDock, type AssistantDockLayout } from "@/lib/canvas/assistant-dock-layout";
import { useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { modelOptionLabel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useCanvasAssistantStore } from "@/stores/use-canvas-assistant-store";
import { useThemeStore } from "@/stores/use-theme-store";

import { CanvasPromptChipInput, type PromptChipInputHandle } from "@/components/canvas/canvas-prompt-chip-input";
import { buildCanvasResourceReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { assistantDraftWithReferences, assistantReferenceToken } from "@/lib/canvas/assistant-inline-references";

const layoutKey = "blinkflow:canvas-assistant-layout";
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

function defaultLayout(): AssistantDockLayout {
    return anchorAssistantDock({ orbX: Math.max(12, window.innerWidth - 82), orbY: Math.max(70, window.innerHeight - 105), x: 8, y: 8, height: Math.max(260, Math.min(650, window.innerHeight - 110)) }, viewport());
}
function initialLayout() {
    try { const value: unknown = JSON.parse(localStorage.getItem(layoutKey) || "null"); if (value && typeof value === "object" && Object.values(value).every((field) => typeof field === "number" && Number.isFinite(field)) && ["orbX", "orbY", "x", "y", "height"].every((key) => key in value)) return anchorAssistantDock(value as AssistantDockLayout, viewport()); } catch { /* Tiny UI preferences must not stop the Agent. */ }
    return defaultLayout();
}
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
const button = "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40";

export function CanvasAssistantDock() {
    const store = useCanvasAssistantStore(), config = useConfigStore((state) => state.config), colorTheme = useThemeStore((state) => state.theme), theme = canvasThemes[colorTheme];
    useNodeRegistryVersion((state) => state.version);
    const [layout, setLayout] = useState(initialLayout), [menu, setMenu] = useState<"models" | null>(null), [query, setQuery] = useState(""), [renaming, setRenaming] = useState(false), [name, setName] = useState(""), [expanded, setExpanded] = useState(false);
    const expandedTextarea = useRef<PromptChipInputHandle>(null);
    const textarea = useRef<PromptChipInputHandle>(null), end = useRef<HTMLDivElement>(null), currentLayout = useRef(layout), moved = useRef(false), dragCleanup = useRef<(() => void) | null>(null);
    const session = store.sessions.find((item) => item.id === store.currentId), snapshot = store.context?.snapshot;
    currentLayout.current = layout;
    const imageModels = selectableModelsByCapability(config, "image"), videoModels = selectableModelsByCapability(config, "video"), textModels = selectableModelsByCapability(config, "text");
    const modelLabel = (id: string) => modelOptionLabel(config, id);
    const nodeLabel = (id: string) => snapshot?.nodes.find((node) => node.id === id)?.title || id;
    const references = useMemo(() => {
        const resources = new Map(buildCanvasResourceReferences(snapshot?.nodes || []).map((item) => [item.nodeId, item]));
        const nodes: CanvasResourceReference[] = (snapshot?.nodes || []).map((node) => ({ id: node.id, nodeId: node.id, kind: "text", title: node.title || node.id, active: true, ...resources.get(node.id), mentionLabel: resources.get(node.id)?.kind === "image" ? resources.get(node.id)?.label : undefined, label: assistantReferenceToken(node.id) }));
        for (const id of session?.references || []) if (!nodes.some((node) => node.nodeId === id)) nodes.push({ id, nodeId: id, kind: "text", title: id, active: true, label: assistantReferenceToken(id) });
        return [...nodes, ...[...imageModels, ...videoModels].map((id): CanvasResourceReference => ({ id: `model:${id}`, nodeId: id, kind: "text", active: true, label: `@[model:${id}]`, title: modelLabel(id), text: imageModels.includes(id) ? "图片模型" : "视频模型" }))];
    }, [snapshot?.nodes, session?.references, config]);
    const draft = assistantDraftWithReferences(session?.draft || "", session?.references || []);
    const readOnly = !session || store.loading || session.running || Boolean(session.pending);
    const selectReference = (reference: CanvasResourceReference) => { if (!reference.id.startsWith("model:")) return false; store.toggleModel(reference.nodeId); return true; };
    useEffect(() => {
        const resize = () => {
            const next = anchorAssistantDock(currentLayout.current, viewport());
            currentLayout.current = next;
            setLayout(next);
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

    const drag = (event: ReactPointerEvent<HTMLElement>, mode: "orb" | "panel" | "resize") => {
        if (event.button !== 0) return;
        if (mode === "panel" && (event.target as Element).closest("button,input,select")) return;
        event.preventDefault(); event.stopPropagation(); dragCleanup.current?.();
        const start = { x: event.clientX, y: event.clientY, layout: currentLayout.current };
        moved.current = false;
        const onMove = (next: PointerEvent) => {
            const dx = next.clientX - start.x, dy = next.clientY - start.y;
            if (Math.hypot(dx, dy) > 4) moved.current = true;
            const nextLayout = moveAssistantDock(start.layout, dx, dy, mode, viewport());
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
    if (!store.context) return null;
    const panelStyle: CSSProperties = { position: "fixed", zIndex: 240, left: layout.x, top: layout.y, width: "min(420px, calc(100vw - 16px))", height: layout.height, background: theme.node.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}`, boxShadow: "0 14px 46px rgba(0,0,0,.18)", borderRadius: 16 };
    const inputStyle: CSSProperties = { background: "transparent", color: theme.node.text, border: `1px solid ${theme.node.stroke}`, borderRadius: 7, padding: "5px 7px" };
    const chooseModel = (id: string) => { store.toggleModel(id); setMenu(null); setQuery(""); textarea.current?.focus(); };
    const filteredModels = (ids: string[]) => ids.filter((id) => modelLabel(id).toLowerCase().includes(query.toLowerCase()));
    const renderModels = (title: string, ids: string[]) => <section className="mb-3"><div className="mb-1 px-2 text-xs" style={{ color: theme.node.muted }}>{title}</div>{filteredModels(ids).map((id) => <button key={id} type="button" className={`${button} w-full !justify-start text-left`} style={session?.models.includes(id) ? { background: theme.toolbar.activeBg } : undefined} onClick={() => chooseModel(id)}><Box size={14} /><span className="min-w-0 flex-1 break-all">{modelLabel(id)}</span>{session?.models.includes(id) ? "✓" : ""}</button>)}{!filteredModels(ids).length && <p className="px-2 py-1 text-xs" style={{ color: theme.node.faint }}>暂无{title}模型</p>}</section>;
    return <div data-canvas-overlay data-canvas-no-zoom data-canvas-assistant onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop} onContextMenu={stop} onKeyDown={stop} onKeyUp={stop} onWheel={stop}>
        {!store.open && <button type="button" data-assistant-orb aria-label="打开 Agent" title="Agent（可拖动）" className="fixed flex h-14 w-14 cursor-grab flex-col items-center justify-center rounded-full active:cursor-grabbing" style={{ zIndex: 240, left: layout.orbX, top: layout.orbY, background: theme.toolbar.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}`, boxShadow: "0 5px 22px rgba(0,0,0,.16)", touchAction: "none" }} onPointerDown={(event) => drag(event, "orb")} onClick={() => { if (!moved.current) store.setOpen(true); moved.current = false; }}><Bot size={21} /><span className="text-[9px]">Agent</span></button>}
        <section data-assistant-panel data-canvas-overlay data-canvas-no-zoom role="dialog" aria-label="Agent 浮窗" style={{ ...panelStyle, display: store.open ? "flex" : "none" }} className="flex-col overflow-hidden">
            <header data-assistant-drag-handle className="flex cursor-grab items-center gap-1 border-b px-3 py-2 active:cursor-grabbing" style={{ borderColor: theme.node.stroke, touchAction: "none" }} onPointerDown={(event) => drag(event, "panel")}>
                <Bot size={17} /><strong className="mr-auto text-sm">Agent</strong>
                <button type="button" className={button} aria-label="新建 Agent 对话" title="新建对话" disabled={store.loading} onClick={store.createSession}><Plus size={15} /></button>
                <button type="button" className={button} aria-label="重命名 Agent 对话" title="重命名对话" disabled={!session} onClick={() => { setName(session?.title || ""); setRenaming(!renaming); }}>✎</button>
                <button type="button" className={button} aria-label="删除 Agent 对话" title="删除当前对话" disabled={!session} onClick={() => session && store.deleteSession(session.id)}><Trash2 size={14} /></button>
                <button type="button" className={button} aria-label="收起 Agent" title="收起（任务继续）" onClick={() => store.setOpen(false)}><Minus size={16} /></button>
            </header>
            <div className="flex items-center gap-2 px-3 pt-2">
                <MessageSquare size={14} /><select aria-label="Agent 会话" className="min-w-0 flex-1 text-xs" style={inputStyle} value={store.currentId} onChange={(event) => store.selectSession(event.target.value)}>{store.sessions.map((item) => <option key={item.id} value={item.id}>{item.title}{item.running ? " · 运行中" : item.pending ? " · 待确认" : ""}</option>)}</select><ChevronDown size={12} />
            </div>
            {renaming && session && <form className="flex gap-1 px-3 pt-2" onSubmit={(event) => { event.preventDefault(); store.renameSession(session.id, name); setRenaming(false); }}><input aria-label="对话名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 text-xs" style={inputStyle} /><button type="submit" className={button}>保存</button><button type="button" className={button} onClick={() => setRenaming(false)}>取消</button></form>}
            <main className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-3" data-node-scroll>
                {store.loading && <p className="text-xs" style={{ color: theme.node.muted }}>正在读取会话…</p>}
                {!store.loading && !session?.messages.length && <p className="py-6 text-center text-xs leading-6" style={{ color: theme.node.muted }}>描述你的创意，Agent 会把工作流建到画布。<br />选择节点可添加为素材；{store.generationMode === "auto" ? "自动生成模式会直接执行生成。" : "生成前会让你确认。"}</p>}
                {session?.messages.map((message) => <article key={message.id} className="rounded-lg p-2 text-xs leading-6" style={{ background: message.role === "user" ? theme.toolbar.activeBg : "transparent", border: message.role === "error" ? `1px solid ${theme.node.stroke}` : undefined }}>
                    <div className="mb-1 text-[10px]" style={{ color: theme.node.muted }}>{message.role === "user" ? "你" : message.role === "tool" ? "工具" : message.role === "error" ? "执行提示" : "Agent"}</div>
                    {message.role === "tool" ? <details><summary className="cursor-pointer" style={{ color: theme.node.muted }}>{message.text.split("：")[0]}</summary><pre className="whitespace-pre-wrap break-all font-sans">{message.text}</pre></details> : <p className="whitespace-pre-wrap break-words">{message.text}</p>}
                    {(message.references?.length || message.models?.length) ? <div className="mt-1 flex flex-wrap gap-1" style={{ color: theme.node.muted }}>{message.references?.map((id) => <span key={id} className="rounded border px-1" style={{ borderColor: theme.node.stroke }}>@{nodeLabel(id)}</span>)}{message.models?.map((id) => <span key={id} className="rounded border px-1" style={{ borderColor: theme.node.stroke }}><Box className="mr-1 inline" size={11} />{modelLabel(id)}</span>)}</div> : null}
                </article>)}
                {session?.pending && <div data-assistant-confirm className="rounded-lg border p-3 text-xs" style={{ borderColor: theme.node.stroke }}><strong>确认执行生成？</strong><p className="my-2">{Array.isArray(session.pending.args.nodeIds) ? session.pending.args.nodeIds.map(String).map(nodeLabel).join("、") : "指定节点"}</p><p className="mb-2" style={{ color: theme.node.muted }}>使用节点中选好的渠道和模型。取消后保留工作流。</p><div className="flex gap-2"><button type="button" className={button} onClick={() => void store.confirm(true)}>确认生成</button><button type="button" className={button} onClick={() => void store.confirm(false)}>取消生成</button></div></div>}
                <div ref={end} />
            </main>
            {store.storageError && <p role="alert" className="px-3 text-xs">{store.storageError}</p>}
            <div className="px-3 pb-2">
                <div className="mb-2"><CanvasAssistantSkills activeId={session?.skillId} onSelect={store.setSkill} disabled={!session || store.loading || session.running || Boolean(session.pending)} /></div>
                <label className="mb-2 flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>对话模型<select data-assistant-chat-model aria-label="Agent 对话模型" disabled={session?.running} className="min-w-0 flex-1" style={inputStyle} value={session?.model || ""} onChange={(event) => store.setModel(event.target.value)}><option value="">请选择对话模型</option>{textModels.map((id) => <option key={id} value={id}>{modelLabel(id)}</option>)}</select></label>
                <div className="relative rounded-xl border p-2" style={{ borderColor: theme.node.stroke }}>
                    {session?.models.length ? <div data-assistant-chips className="mb-2 flex max-h-28 flex-wrap gap-1 overflow-auto">{session.models.map((id) => <span key={id} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: theme.node.stroke }}><Box size={12} /><span className="max-w-64 truncate" title={modelLabel(id)}>{modelLabel(id)}</span><button type="button" title="移除模型引用" aria-label={`移除模型 ${modelLabel(id)}`} onClick={() => store.toggleModel(id)}><X size={12} /></button></span>)}</div> : null}
                    <CanvasPromptChipInput key={session?.id} inputRef={textarea} ariaLabel="Agent 消息" placeholder="描述需求，@ 节点或图片 / 视频模型" className="min-h-20 max-h-44 w-full bg-transparent text-xs leading-6" value={draft} references={references} readOnly={readOnly} showReferenceTitle imageHoverPreview onReferenceSelect={selectReference} onChange={store.setDraft} onSubmit={() => void store.send()} />
                    <div className="flex items-center gap-1 border-t pt-1" style={{ borderColor: theme.node.stroke }}>
                        <button type="button" className={button} aria-label="添加选中节点到 Agent" title="添加选中节点" disabled={!snapshot?.selectedNodeIds.length} onClick={() => store.addReferences(snapshot?.selectedNodeIds || [])}><Plus size={15} /></button>
                        <button type="button" data-assistant-mention className={button} aria-label="引用节点或模型" title="@ 节点 / 模型" disabled={readOnly} onClick={() => textarea.current?.openMention()}><AtSign size={16} /></button>
                        <button type="button" data-assistant-models className={button} aria-label="图片和视频生成模型" title="选择生成模型" onClick={() => { setMenu(menu === "models" ? null : "models"); setQuery(""); }}><Box size={16} /></button>
                        <button type="button" className={button} aria-label="全屏编辑 Agent 输入" title="全屏查看 / 编辑文字" disabled={!session} onClick={() => { setMenu(null); setExpanded(true); }}><Maximize2 size={15} /></button>
                        <CanvasAssistantGenerationMode />
                        <span className="min-w-0 flex-1 truncate text-[10px]" style={{ color: theme.node.muted }} title={session?.status}>{session?.status}</span>
                        {session?.running ? <button type="button" className={button} aria-label="停止 Agent" onClick={store.stop}><Square size={16} /></button> : <button type="button" className={button} aria-label="发送 Agent 消息" disabled={!session || Boolean(session.pending) || (!session.draft.trim() && !session.references.length)} onClick={() => void store.send()}><Send size={17} /></button>}
                    </div>
                    {menu && <div data-canvas-overlay data-canvas-no-zoom data-assistant-menu role="dialog" aria-label="选择生成模型" className="absolute bottom-full left-0 z-10 mb-2 w-full overflow-auto rounded-xl border p-2" style={{ maxHeight: Math.max(180, layout.height - 210), background: theme.node.panel, borderColor: theme.node.stroke, boxShadow: "0 8px 24px rgba(0,0,0,.15)" }}>
                        <div className="mb-2 flex gap-1"><input aria-label="搜索节点或模型" placeholder="搜索" className="min-w-0 flex-1 text-xs" style={inputStyle} value={query} onChange={(event) => setQuery(event.target.value)} /><button type="button" className={button} aria-label="关闭模型菜单" onClick={() => setMenu(null)}><X size={14} /></button></div>

                        {renderModels("图片", imageModels)}{renderModels("视频", videoModels)}
                    </div>}
                </div>
            </div>
            <button type="button" aria-label="调整 Agent 浮窗高度" title="上下拖动调整高度" className="mx-auto h-3 w-16 cursor-ns-resize" style={{ touchAction: "none" }} onPointerDown={(event) => drag(event, "resize")}><span className="mx-auto block h-1 w-8 rounded" style={{ background: theme.node.stroke }} /></button>
        </section>
        <Modal
            title="Agent 全屏编辑"
            open={expanded && store.open && Boolean(session)}
            width="100vw"
            style={{ top: 0, margin: 0, paddingBottom: 0, maxWidth: "100vw", height: "100dvh" }}
            styles={{ container: { display: "flex", flexDirection: "column", height: "100%", borderRadius: 0, background: theme.node.panel, color: theme.node.text }, header: { background: "transparent" }, title: { color: theme.node.text }, close: { color: theme.node.text }, body: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1 } }}
            wrapProps={{ "data-canvas-overlay": true, "data-canvas-no-zoom": true, "data-canvas-shortcuts-ignore": true, "data-assistant-editor": true, onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); setExpanded(false); } event.stopPropagation(); } }}
            footer={<button type="button" className={button} onClick={() => setExpanded(false)}>完成编辑</button>}
            onCancel={() => setExpanded(false)}
            afterOpenChange={(open) => { if (open) expandedTextarea.current?.focus(); }}
            destroyOnHidden
        >
            <p className="mb-3 text-xs" style={{ color: theme.node.muted }}>{session?.running || session?.pending ? "任务进行中，仅查看当前输入。" : "修改实时保留，Enter 换行；关闭后回到输入框，不会发送。"}</p>
            {/* Share the session draft directly: closing or Escape cannot discard edits or send a request. */}
            <CanvasPromptChipInput inputRef={expandedTextarea} onEscape={() => setExpanded(false)} ariaLabel="Agent 全屏输入文字" containerClassName="min-h-0 flex-1 flex flex-col" className="thin-scrollbar min-h-0 w-full flex-1 rounded-xl border p-4 text-base leading-7" style={{ background: "transparent", borderColor: theme.node.stroke, color: theme.node.text }} value={draft} references={references} readOnly={readOnly} showReferenceTitle imageHoverPreview onReferenceSelect={selectReference} onChange={store.setDraft} placeholder="在这里查看和编辑完整输入文字，@ 引用节点或模型" />
        </Modal>
    </div>;
}
