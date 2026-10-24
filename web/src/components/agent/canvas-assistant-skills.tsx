import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Check, Copy, FolderOpen, Pencil, Plus, Search, Star, Trash2, Upload, X } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { BUILTIN_ASSISTANT_SKILLS, type AssistantSkillDraft, type CanvasAssistantSkill } from "@/lib/canvas/canvas-assistant-skills";
import { getAssistantSkill, loadAssistantSkills, useCanvasAssistantSkillStore } from "@/stores/use-canvas-assistant-skill-store";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = { activeId?: string; onSelect: (id?: string) => void; disabled?: boolean };
type Editor = { id?: string; draft: AssistantSkillDraft; readOnly?: boolean };
const blank = (): AssistantSkillDraft => ({ name: "", description: "", content: "", inputMode: "any", tags: [] });
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
const button = "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40";
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Plain-text workflow skills; selection stays in the caller's persistent Agent session. */
export function CanvasAssistantSkills({ activeId, onSelect, disabled = false }: Props) {
    const store = useCanvasAssistantSkillStore(), theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [open, setOpen] = useState(false), [tab, setTab] = useState<"builtin" | "favorites" | "mine">("builtin"), [query, setQuery] = useState("");
    const [editor, setEditor] = useState<Editor | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
    const [position, setPosition] = useState({ left: 8, top: 8, width: 420, maxHeight: 480 });
    const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), files = useRef<HTMLInputElement>(null), directory = useRef<HTMLInputElement>(null);
    const active = getAssistantSkill(activeId);
    const all = [...BUILTIN_ASSISTANT_SKILLS, ...store.skills];
    const list = (tab === "builtin" ? [...BUILTIN_ASSISTANT_SKILLS] : tab === "favorites" ? all.filter((skill) => store.favorites.includes(skill.id)) : store.skills).filter((skill) => `${skill.name}\n${skill.description}\n${skill.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
    useEffect(() => { void loadAssistantSkills().catch(() => undefined); }, []);
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    useEffect(() => {
        if (!open) return;
        const place = () => {
            const bounds = trigger.current?.getBoundingClientRect();
            if (!bounds) return;
            const width = Math.min(440, window.innerWidth - 16), maxHeight = Math.min(560, window.innerHeight - 24);
            setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), top: Math.max(8, Math.min(bounds.top - maxHeight - 8, window.innerHeight - maxHeight - 8)), width, maxHeight });
        };
        const outside = (event: PointerEvent) => { if (event.target instanceof Node && !popup.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false); };
        const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
        place(); window.addEventListener("resize", place); document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
        return () => { window.removeEventListener("resize", place); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
    }, [open]);
    const fieldStyle: CSSProperties = { color: theme.node.text, background: theme.node.panel, borderColor: theme.node.stroke };
    const select = (skill: CanvasAssistantSkill) => { onSelect(skill.id); setOpen(false); setEditor(null); };
    const perform = async (action: () => Promise<void>) => {
        if (busy || disabled) return;
        setBusy(true); setNotice("");
        try { await action(); } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); }
    };
    const edit = (skill: CanvasAssistantSkill) => { setEditor({ id: skill.id, draft: { name: skill.name, description: skill.description, content: skill.content, inputMode: skill.inputMode, tags: [...skill.tags] }, readOnly: skill.source === "builtin" }); setNotice(""); };
    const change = (update: Partial<AssistantSkillDraft>) => setEditor((value) => value ? { ...value, draft: { ...value.draft, ...update } } : null);
    const importFiles = (picked: FileList | null) => {
        const chosen = Array.from(picked || []);
        if (!chosen.length) return;
        void perform(async () => {
            const result = await store.importFiles(chosen);
            setNotice([`已导入 ${result.imported.length} 项 Skill`, result.ignored ? `已忽略 ${result.ignored} 个非文本文件` : "", ...result.errors].filter(Boolean).join("\n"));
            if (result.imported.length) { setTab("mine"); setEditor(null); }
        });
    };
    return <div className="inline-flex max-w-full flex-wrap items-center gap-1" data-canvas-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onPointerDown={stop} onMouseDown={stop}>
        <button ref={trigger} type="button" className={button} title="选择或管理工作流 Skill" disabled={disabled} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((value) => !value); setEditor(null); setNotice(""); }}><BookOpen size={14} />Skill</button>
        {activeId && <span className="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs" style={{ borderColor: theme.toolbar.border }}>
            <span className="max-w-48 truncate" title={active?.description || "该 Skill 已不存在，请重新选择"}>{active?.name || "Skill 已删除"}</span>
            <button type="button" className={button} aria-label="取消当前 Skill" disabled={disabled} onClick={() => onSelect(undefined)}><X size={12} /></button>
        </span>}
        {open && createPortal(<div ref={popup} role="dialog" aria-label="Agent 工作流 Skill" className="fixed z-[280] flex flex-col overflow-hidden rounded-xl border p-3 shadow-2xl" style={{ ...position, color: theme.node.text, background: theme.toolbar.panel, borderColor: theme.toolbar.border }} data-canvas-overlay data-canvas-no-zoom data-canvas-shortcuts-ignore onPointerDown={stop} onMouseDown={stop} onDoubleClick={stop} onWheel={stop} onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") setOpen(false); }} onKeyUp={stop}>
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2"><strong className="text-sm">{editor ? editor.readOnly ? "内置 Skill · 只读" : editor.id ? "编辑 Skill" : "新建 Skill" : "工作流 Skill"}</strong><button type="button" className={button} aria-label="关闭 Skill 菜单" onClick={() => setOpen(false)}><X size={15} /></button></div>
            {store.error && <div role="alert" className="mb-2 shrink-0 whitespace-pre-wrap text-xs text-red-500">{store.error}{!store.loaded && <button className={button} type="button" disabled={store.loading} onClick={() => void loadAssistantSkills().catch(() => undefined)}>重试读取</button>}</div>}
            {notice && <div role="status" className="mb-2 max-h-24 shrink-0 overflow-auto whitespace-pre-wrap text-xs" style={{ color: theme.node.muted }}>{notice}</div>}
            {editor ? <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
                <label className="text-xs">名称<input className="mt-1 w-full rounded-md border px-2 py-1.5" style={fieldStyle} value={editor.draft.name} readOnly={editor.readOnly} onChange={(event) => change({ name: event.target.value })} /></label>
                <label className="text-xs">说明<input className="mt-1 w-full rounded-md border px-2 py-1.5" style={fieldStyle} value={editor.draft.description} readOnly={editor.readOnly} onChange={(event) => change({ description: event.target.value })} /></label>
                <div className="flex gap-2"><label className="w-32 shrink-0 text-xs">输入类型<select className="mt-1 w-full rounded-md border px-2 py-1.5" style={fieldStyle} value={editor.draft.inputMode} disabled={editor.readOnly} onChange={(event) => change({ inputMode: event.target.value as AssistantSkillDraft["inputMode"] })}><option value="any">任意素材</option><option value="text">文本</option><option value="image">图片</option></select></label><label className="min-w-0 flex-1 text-xs">标签（逗号分隔）<input className="mt-1 w-full rounded-md border px-2 py-1.5" style={fieldStyle} value={editor.draft.tags.join(", ")} readOnly={editor.readOnly} onChange={(event) => change({ tags: event.target.value.split(/[,，]/) })} /></label></div>
                <label className="text-xs">Skill 正文<textarea className="mt-1 min-h-40 w-full resize-y rounded-md border px-2 py-1.5 font-mono text-xs" style={fieldStyle} value={editor.draft.content} readOnly={editor.readOnly} onChange={(event) => change({ content: event.target.value })} /></label>
                <p className="text-[11px]" style={{ color: theme.node.muted }}>正文作为本次会话的工作流指导传给对话模型，不执行本地代码；图片与视频模型仍以你已配置的渠道为准。</p>
                <div className="flex shrink-0 justify-end gap-2"><button type="button" className={button} disabled={busy} onClick={() => setEditor(null)}>返回</button>{editor.readOnly ? <button type="button" className={button} disabled={busy || !store.loaded} onClick={() => { setEditor({ draft: { ...editor.draft, name: `${editor.draft.name} 副本` } }); }}><Copy size={13} />复制为我的 Skill</button> : <button type="button" className={button} disabled={busy || !store.loaded} onClick={() => void perform(async () => { const saved = await store.saveSkill(editor.draft, editor.id); setTab("mine"); setEditor(null); setNotice(`已保存「${saved.name}」`); })}><Check size={13} />{busy ? "保存中…" : "保存"}</button>}</div>
            </div> : <>
                <div className="mb-2 flex shrink-0 gap-1" role="tablist" aria-label="Skill 分类">{([["builtin", "通用"], ["favorites", "收藏"], ["mine", "我的"]] as const).map(([id, label]) => <button type="button" key={id} className={`${button} flex-1`} role="tab" aria-selected={tab === id} style={tab === id ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined} onClick={() => setTab(id)}>{label}</button>)}</div>
                <label className="mb-2 flex shrink-0 items-center gap-2 rounded-md border px-2" style={fieldStyle}><Search size={13} /><input className="w-full bg-transparent py-1.5 text-xs outline-none" value={query} placeholder="搜索名称、说明或标签" aria-label="搜索 Skill" onChange={(event) => setQuery(event.target.value)} /></label>
                <div className="mb-2 flex shrink-0 flex-wrap gap-1"><button type="button" className={button} disabled={busy || !store.loaded} onClick={() => { setEditor({ draft: blank() }); setNotice(""); }}><Plus size={13} />新建</button><button type="button" className={button} disabled={busy || !store.loaded} onClick={() => files.current?.click()}><Upload size={13} />导入文件</button><button type="button" className={button} disabled={busy || !store.loaded} onClick={() => directory.current?.click()}><FolderOpen size={13} />导入目录</button></div>
                <div className="min-h-0 flex-1 overflow-auto" aria-busy={busy || store.loading}>{list.map((skill) => <div key={skill.id} className="mb-1 rounded-md border p-2" style={{ borderColor: skill.id === activeId ? theme.node.activeStroke : theme.toolbar.border }}>
                    <div className="flex items-start gap-1"><button type="button" className="min-w-0 flex-1 text-left" disabled={disabled || busy} onClick={() => select(skill)}><span className="flex items-center gap-1 text-xs font-semibold">{skill.id === activeId && <Check size={13} />}<span className="break-words">{skill.name}</span></span>{skill.description && <span className="mt-1 block text-[11px]" style={{ color: theme.node.muted }}>{skill.description}</span>}</button>
                        <button type="button" className={button} disabled={busy || !store.loaded} title={store.favorites.includes(skill.id) ? "取消收藏" : "收藏"} aria-label={`${store.favorites.includes(skill.id) ? "取消收藏" : "收藏"}${skill.name}`} onClick={() => void perform(() => store.toggleFavorite(skill.id))}><Star size={13} fill={store.favorites.includes(skill.id) ? "currentColor" : "none"} /></button>
                        <button type="button" className={button} disabled={busy} title={skill.source === "builtin" ? "查看与复制" : "编辑"} aria-label={`${skill.source === "builtin" ? "查看" : "编辑"}${skill.name}`} onClick={() => edit(skill)}>{skill.source === "builtin" ? <BookOpen size={13} /> : <Pencil size={13} />}</button>
                        {skill.source === "user" && <button type="button" className={button} disabled={busy} title="删除 Skill" aria-label={`删除${skill.name}`} onClick={() => void perform(async () => { await store.removeSkill(skill.id); if (activeId === skill.id) onSelect(undefined); setNotice(`已删除「${skill.name}」`); })}><Trash2 size={13} /></button>}
                    </div>{skill.tags.length > 0 && <div className="mt-1 text-[10px]" style={{ color: theme.node.faint }}>{skill.tags.join(" · ")}</div>}
                </div>)}{!list.length && <p className="py-4 text-center text-xs" style={{ color: theme.node.muted }}>{store.loading ? "读取中…" : tab === "favorites" ? "暂无收藏，点击星标添加" : tab === "mine" ? "暂无自定义 Skill，可新建或导入" : "没有匹配的 Skill"}</p>}</div>
                <p className="mt-2 shrink-0 text-[11px]" style={{ color: theme.node.muted }}>选中后作用于当前会话。导入仅支持 .md、.markdown、.txt 正文。</p>
            </>}
            <input ref={files} className="hidden" type="file" multiple accept=".md,.markdown,.txt" aria-label="导入 Skill 文件" onChange={(event) => { importFiles(event.target.files); event.target.value = ""; }} />
            <input ref={(element) => { directory.current = element; element?.setAttribute("webkitdirectory", ""); }} className="hidden" type="file" multiple aria-label="导入 Skill 目录" onChange={(event) => { importFiles(event.target.files); event.target.value = ""; }} />
        </div>, document.body)}
    </div>;
}
