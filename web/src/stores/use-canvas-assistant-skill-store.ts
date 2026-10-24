import localforage from "localforage";
import { nanoid } from "nanoid";
import { create } from "zustand";

import { BUILTIN_ASSISTANT_SKILLS, parseAssistantSkillMarkdown, validateAssistantSkill, type AssistantSkillDraft, type CanvasAssistantSkill } from "@/lib/canvas/canvas-assistant-skills";

type StoredSkills = { version: 1; skills: CanvasAssistantSkill[]; favorites: string[] };
export type AssistantSkillImportResult = { imported: CanvasAssistantSkill[]; errors: string[]; ignored: number };
type SkillStore = {
    skills: CanvasAssistantSkill[];
    favorites: string[];
    loading: boolean;
    loaded: boolean;
    error: string;
    saveSkill: (draft: AssistantSkillDraft, id?: string) => Promise<CanvasAssistantSkill>;
    removeSkill: (id: string) => Promise<void>;
    toggleFavorite: (id: string) => Promise<void>;
    importFiles: (files: File[]) => Promise<AssistantSkillImportResult>;
};
const db = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_assistant_skills" });
let loading: Promise<void> | undefined;
let writeQueue: Promise<unknown> = Promise.resolve();
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function readStored(value: unknown): StoredSkills {
    if (value === null) return { version: 1, skills: [], favorites: [] };
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("skills" in value) || !Array.isArray(value.skills) || !("favorites" in value) || !Array.isArray(value.favorites) || !value.favorites.every((id: unknown) => typeof id === "string")) throw new Error("Skill 存储格式无效，原数据未被覆盖");
    const ids = new Set<string>();
    const skills = value.skills.map((item: unknown): CanvasAssistantSkill => {
        if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string" || !item.id.startsWith("user:") || ids.has(item.id) || !("name" in item) || typeof item.name !== "string" || !("description" in item) || typeof item.description !== "string" || !("content" in item) || typeof item.content !== "string" || !("inputMode" in item) || !["text", "image", "any"].includes(String(item.inputMode)) || !("tags" in item) || !Array.isArray(item.tags) || !item.tags.every((tag: unknown) => typeof tag === "string") || !("updatedAt" in item) || typeof item.updatedAt !== "number" || !Number.isFinite(item.updatedAt)) throw new Error("自定义 Skill 数据无效，原数据未被覆盖");
        const skill = item as CanvasAssistantSkill;
        validateAssistantSkill(skill);
        ids.add(skill.id);
        return { ...skill, source: "user", tags: [...skill.tags] };
    });
    return { version: 1, skills, favorites: value.favorites };
}

export async function loadAssistantSkills(): Promise<void> {
    if (useCanvasAssistantSkillStore.getState().loaded) return;
    if (!loading) {
        useCanvasAssistantSkillStore.setState({ loading: true, error: "" });
        loading = db.getItem<unknown>("catalog").then((value) => {
            const stored = readStored(value);
            useCanvasAssistantSkillStore.setState({ skills: stored.skills, favorites: stored.favorites, loaded: true, error: "" });
        }).catch((error: unknown) => {
            useCanvasAssistantSkillStore.setState({ error: `Skill 读取失败：${message(error)}` });
            throw error;
        }).finally(() => { useCanvasAssistantSkillStore.setState({ loading: false }); loading = undefined; });
    }
    return loading;
}
export function getAssistantSkill(id?: string): CanvasAssistantSkill | undefined {
    return id ? BUILTIN_ASSISTANT_SKILLS.find((skill) => skill.id === id) || useCanvasAssistantSkillStore.getState().skills.find((skill) => skill.id === id) : undefined;
}

// Serialize read-modify-write and publish only after IndexedDB succeeds, so failures never appear saved.
async function mutate<T>(update: (current: StoredSkills) => { next: StoredSkills; result: T }): Promise<T> {
    await loadAssistantSkills();
    const operation = writeQueue.catch(() => undefined).then(async () => {
        const state = useCanvasAssistantSkillStore.getState();
        const { next, result } = update({ version: 1, skills: state.skills, favorites: state.favorites });
        await db.setItem("catalog", next);
        useCanvasAssistantSkillStore.setState({ skills: next.skills, favorites: next.favorites, error: "" });
        return result;
    });
    writeQueue = operation;
    try { return await operation; } catch (error) {
        useCanvasAssistantSkillStore.setState({ error: `Skill 保存失败：${message(error)}` });
        throw error;
    }
}
export async function clearAssistantSkills() {
    await mutate(() => ({ next: { version: 1, skills: [], favorites: [] }, result: undefined }));
}
export const useCanvasAssistantSkillStore = create<SkillStore>(() => ({
    skills: [], favorites: [], loading: false, loaded: false, error: "",
    saveSkill: async (draft, id) => {
        validateAssistantSkill(draft);
        return mutate((current) => {
            if (id && !current.skills.some((skill) => skill.id === id)) throw new Error("该自定义 Skill 已不存在");
            const skill: CanvasAssistantSkill = { ...draft, name: draft.name.trim(), description: draft.description.trim(), content: draft.content.trim(), tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))], id: id || `user:${nanoid()}`, source: "user", updatedAt: Date.now() };
            return { next: { ...current, skills: id ? current.skills.map((item) => item.id === id ? skill : item) : [...current.skills, skill] }, result: skill };
        });
    },
    removeSkill: async (id) => {
        await mutate((current) => {
            if (!current.skills.some((skill) => skill.id === id)) throw new Error("内置 Skill 不能删除，或该 Skill 已不存在");
            return { next: { ...current, skills: current.skills.filter((skill) => skill.id !== id), favorites: current.favorites.filter((value) => value !== id) }, result: undefined };
        });
    },
    toggleFavorite: async (id) => {
        await mutate((current) => {
            if (!getAssistantSkill(id)) throw new Error("该 Skill 已不存在");
            return { next: { ...current, favorites: current.favorites.includes(id) ? current.favorites.filter((value) => value !== id) : [...current.favorites, id] }, result: undefined };
        });
    },
    importFiles: async (files) => {
        await loadAssistantSkills();
        const imported: CanvasAssistantSkill[] = [], errors: string[] = [];
        let ignored = 0;
        // Directory import treats text files as data only. No scripts, network fetches or dependency hooks run.
        for (const file of files) {
            if (!/\.(md|markdown|txt)$/i.test(file.name)) { ignored++; continue; }
            try {
                const filename = file.name.replace(/^skill\.(md|markdown|txt)$/i, () => file.webkitRelativePath.split("/").slice(-2, -1)[0] || "Skill");
                const draft = parseAssistantSkillMarkdown(await file.text(), filename);
                imported.push(await useCanvasAssistantSkillStore.getState().saveSkill(draft));
            } catch (error) { errors.push(`${file.webkitRelativePath || file.name}：${message(error)}`); }
        }
        return { imported, errors, ignored };
    },
}));
