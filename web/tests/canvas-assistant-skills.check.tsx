import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import localforage from "localforage";
import { CanvasAssistantSkills } from "../src/components/agent/canvas-assistant-skills";
import { BUILTIN_ASSISTANT_SKILLS as builtins, buildAssistantSkillPrompt, parseAssistantSkillMarkdown as parse, validateAssistantSkill as validate, type AssistantSkillDraft } from "../src/lib/canvas/canvas-assistant-skills";
import { clearAssistantSkills, getAssistantSkill, loadAssistantSkills as load, useCanvasAssistantSkillStore as store } from "../src/stores/use-canvas-assistant-skill-store";
import { useThemeStore } from "../src/stores/use-theme-store";
import { canvasThemes } from "../src/lib/canvas-theme";
const state = () => store.getState(), db = localforage.createInstance({ name: "infinite-canvas", storeName: "canvas_assistant_skills" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
let selected: string | undefined;
function Harness({ disabled = false }: { disabled?: boolean }) { const [id, setId] = useState<string>(); return <CanvasAssistantSkills activeId={id} disabled={disabled} onSelect={(next) => { selected = next; setId(next); }} />; }
const fire = (target: EventTarget, event: Event) => act(async () => { target.dispatchEvent(event); });
async function click(target: EventTarget) { for (const [type, Ctor] of [["pointerdown", PointerEvent], ["mousedown", MouseEvent], ["pointerup", PointerEvent], ["mouseup", MouseEvent], ["click", MouseEvent]] as const) await fire(target, new Ctor(type, { bubbles: true, cancelable: true, button: 0 })); }
function button(text: string, scope: ParentNode = document) { const value = [...scope.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text); assert(value, `Missing button ${text}`); return value; }
function label(text: string, scope: ParentNode = document) { const value = scope.querySelector<HTMLElement>(`[aria-label="${text}"]`); assert(value, `Missing label ${text}`); return value; }
const popup = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Agent 工作流 Skill"]');
async function field(target: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(target, value); await fire(target, new Event("input", { bubbles: true })); }
function textFile(name: string, content: string, path = "") { const file = new File([content], name); Object.defineProperty(file, "webkitRelativePath", { value: path }); return file; }
const draft: AssistantSkillDraft = { name: "独立测试技能", description: "测试说明", content: "先读取素材，再创建真实工作流。", inputMode: "any", tags: [" 测试 ", "测试"] };
async function main() {
    await db.clear(); store.setState({ skills: [], favorites: [], loading: false, loaded: false, error: "" });
    assert.equal(builtins.length, 13); assert.equal(new Set(builtins.map((item) => item.id)).size, 13); assert.equal(new Set(builtins.map((item) => item.name)).size, 13);
    for (const item of builtins) { validate(item); assert.equal(item.source, "builtin"); assert(item.id.startsWith("builtin:")); assert(item.content.length > 30); }
    const warm = builtins.find((item) => item.id === "builtin:warm-french-album")!;
    const warmRaw = readFileSync("src/lib/canvas/skills/warm-french-album.md", "utf8").replace(/\r\n/g, "\n");
    assert.equal(warm.name, "暖调法式复古长条画册版"); assert.equal(warm.inputMode, "image");
    assert.equal(warm.content, warmRaw); assert.equal(createHash("sha256").update(warm.content).digest("hex"), "d9220a5bc0152d3da367303d2c4174396ce2b257b57b3a2996f45762ecae1823");
    assert(warm.content.includes("本次只输出策划及提示词，不直接生成图片。"));
    assert(warm.content.includes("只有详情页07采用三联竖向长矩形卡片"));
    assert(buildAssistantSkillPrompt(warm).includes(warmRaw));
    const advanced = builtins.find((item) => item.id === "builtin:advanced-product-design")!;
    const rawAdvanced = readFileSync("src/lib/canvas/skills/advanced-product-design.md", "utf8").replace(/\r\n/g, "\n");
    const advancedHash = (value: string) => createHash("sha256").update(value).digest("hex");
    assert.equal(advanced.name, "高级进阶版主图详情设计"); assert.equal(advanced.inputMode, "image"); assert.deepEqual(advanced.tags, ["电商", "设计"]);
    assert.equal(advanced.content, rawAdvanced); assert.equal(advancedHash(rawAdvanced), "f7028db0b8fc06082f97e49a3aba49447d0ac997cba307ea7e88470e62921b70");
    assert.equal(advancedHash(advanced.content), advancedHash(rawAdvanced));
    assert.equal((advanced.content.match(/^# /gm) || []).length, 10); assert.equal((advanced.content.match(/^## /gm) || []).length, 8); assert.equal((advanced.content.match(/^### /gm) || []).length, 8);
    assert(buildAssistantSkillPrompt(advanced).includes("<selected-skill>\n" + rawAdvanced + "\n</selected-skill>"));
    const builtin = builtins[0], original = JSON.stringify(builtin); assert.equal(getAssistantSkill(), undefined); assert.equal(getAssistantSkill("missing"), undefined);
    const prompt = buildAssistantSkillPrompt(builtin); assert(prompt.includes(builtin.content)); assert(prompt.includes(builtin.name)); assert(prompt.includes("需要文本")); assert.equal(buildAssistantSkillPrompt(), "");
    assert.deepEqual(parse('\uFEFF---\r\nname: "分析技能"\r\ndescription: >\r\n  第一行\r\n  第二行\r\ninputMode: image\r\ntags: ["图片", \'分析\']\r\n---\r\n先看图，再说明。', "fallback.md"), { name: "分析技能", description: "第一行 第二行", inputMode: "image", tags: ["图片", "分析"], content: "先看图，再说明。" });
    assert.equal(parse("正文", "随手写.txt").name, "随手写"); assert.equal(parse("---\ninputMode: invalid\n---\n正文", "fallback.markdown").inputMode, "any");
    assert.throws(() => parse("---\nname: 空白\n---\n  ", "empty.md"), /正文为空/); assert.throws(() => validate({ ...draft, name: " " }), /名称/);
    const script = 'globalThis.__skillShouldNotRun = true; <script>alert("x")</script>'; assert.equal(parse(script, "script.md").content, script); assert.equal((globalThis as any).__skillShouldNotRun, undefined);
    console.log("PASS 13 unique builtins, advanced Skill exact body/hash and 10 sections, BOM/CRLF/frontmatter/plain-text parsing, validation and system-prompt content; text never executes.");
    await Promise.all([load(), load()]); assert(state().loaded); assert.deepEqual(state().skills, []);
    await assert.rejects(() => state().saveSkill({ ...draft, content: " " }), /正文为空/);
    const saved = await state().saveSkill(draft); assert(saved.id.startsWith("user:")); assert.deepEqual(saved.tags, ["测试"]);
    const changed = await state().saveSkill({ ...draft, name: "重命名技能", content: "新的正文", inputMode: "text" }, saved.id); assert.equal(changed.id, saved.id); assert.equal(getAssistantSkill(saved.id)?.name, "重命名技能");
    await state().toggleFavorite(saved.id); await state().toggleFavorite(builtin.id); assert.deepEqual(new Set(state().favorites), new Set([saved.id, builtin.id])); await state().toggleFavorite(saved.id); assert(!state().favorites.includes(saved.id));
    await assert.rejects(() => state().saveSkill(draft, builtin.id), /已不存在/); await assert.rejects(() => state().removeSkill(builtin.id), /内置 Skill 不能删除/); assert.equal(JSON.stringify(builtin), original);
    const concurrent = await Promise.all([state().saveSkill({ ...draft, name: "并发1" }), state().saveSkill({ ...draft, name: "并发2" })]); assert(concurrent.every((item) => state().skills.some((value) => value.id === item.id)));
    const imported = await state().importFiles([textFile("first.md", "---\nname: 导入名称\ninputMode: text\n---\n导入正文"), textFile("SKILL.md", "目录技能正文", "my-workflow/SKILL.md"), textFile("empty.txt", "  "), textFile("run.js", "throw new Error('must not run')")]); assert.equal(imported.imported.length, 2); assert.equal(imported.errors.length, 1); assert.equal(imported.ignored, 1); assert.equal(imported.imported[1].name, "my-workflow");
    const expected = [...state().skills], favorites = [...state().favorites]; const stored = await db.getItem("catalog"); assert(stored); assert(!JSON.stringify(stored).includes("apiKey")); store.setState({ skills: [], favorites: [], loaded: false }); await load(); assert.deepEqual(state().skills, expected); assert.deepEqual(state().favorites, favorites);
    await state().toggleFavorite(saved.id); await state().removeSkill(saved.id); assert.equal(getAssistantSkill(saved.id), undefined); assert(!state().favorites.includes(saved.id));
    console.log("PASS custom CRUD/rename, builtin read-only, favorites, concurrent writes, file/directory imports and IndexedDB rehydration.");
    const valid = await db.getItem("catalog"), corrupt = { version: 1, skills: [{ id: "user:broken" }], favorites: [] }; await db.setItem("catalog", corrupt); store.setState({ skills: [], favorites: [], loaded: false }); await assert.rejects(load, /无效/); assert(state().error.includes("读取失败")); assert.equal(state().loaded, false); await assert.rejects(() => state().saveSkill(draft), /无效/); assert.deepEqual(await db.getItem("catalog"), corrupt); await db.setItem("catalog", valid); await load(); assert.equal(state().error, "");
    console.log("PASS corrupt persistence refuses overwrite and recovery reload succeeds.");
    let bubbles = 0; const count = () => { bubbles++; }; document.addEventListener("pointerdown", count); document.addEventListener("wheel", count); document.addEventListener("keydown", count);
    await act(async () => { root.render(<Harness />); await tick(); }); await click(button("Skill", host)); assert(popup()); assert(popup()!.classList.contains("z-[280]")); assert(popup()!.hasAttribute("data-canvas-overlay")); assert(popup()!.hasAttribute("data-canvas-no-zoom")); await fire(popup()!, new WheelEvent("wheel", { bubbles: true, deltaY: 100 })); await fire(popup()!, new KeyboardEvent("keydown", { bubbles: true, key: " " })); assert.equal(bubbles, 0);
    await click(label(`收藏${builtins[1].name}`)); await act(async () => { await tick(); }); assert(state().favorites.includes(builtins[1].id)); await click(button("收藏", popup()!)); assert(popup()!.textContent?.includes(builtins[1].name)); await click(button("通用", popup()!)); await click(label(`查看${builtin.name}`)); assert(popup()!.querySelector<HTMLInputElement>("input")!.readOnly); assert(popup()!.querySelector("textarea")!.readOnly);
    await click(button("复制为我的 Skill", popup()!)); assert(!popup()!.querySelector<HTMLInputElement>("input")!.readOnly); await click(button("保存", popup()!)); await act(async () => { await tick(); }); assert(state().skills.some((item) => item.name === `${builtin.name} 副本` && item.content === builtin.content)); assert.equal(JSON.stringify(builtin), original);
    await click(button("通用", popup()!)); await field(label("搜索 Skill") as HTMLInputElement, "品牌 Logo"); assert(popup()!.textContent?.includes("品牌 Logo 设计")); assert(!popup()!.textContent?.includes("商品卖点提炼")); const select = [...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.querySelector("span.font-semibold")?.textContent?.includes("品牌 Logo 设计"))!; assert(select); await click(select); assert.equal(selected, "builtin:brand-logo"); assert.equal(popup(), null); assert(host.textContent?.includes("品牌 Logo 设计")); await click(label("取消当前 Skill", host)); assert.equal(selected, undefined);
    await click(button("Skill", host)); await field(label("搜索 Skill") as HTMLInputElement, "高级进阶");
    assert(popup()!.textContent?.includes(advanced.name)); assert(!popup()!.textContent?.includes("商品卖点提炼"));
    await click(label(`查看${advanced.name}`)); assert(popup()!.querySelector<HTMLInputElement>("input")!.readOnly); assert(popup()!.querySelector("textarea")!.readOnly); assert.equal(popup()!.querySelector("textarea")!.value, rawAdvanced);
    await click(button("复制为我的 Skill", popup()!)); assert.equal(popup()!.querySelector("textarea")!.value, rawAdvanced); assert(!popup()!.querySelector("textarea")!.readOnly);
    await click(button("保存", popup()!)); await act(async () => { await tick(); });
    assert(state().skills.some((item) => item.name === `${advanced.name} 副本` && item.content === rawAdvanced.trim())); assert.equal(advanced.content, rawAdvanced);
    await click(button("通用", popup()!)); await field(label("搜索 Skill") as HTMLInputElement, "高级进阶");
    const advancedSelect = [...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.querySelector("span.font-semibold")?.textContent === advanced.name)!; assert(advancedSelect);
    await click(advancedSelect); assert.equal(selected, advanced.id); assert.equal(popup(), null); assert(host.textContent?.includes(advanced.name)); await click(label("取消当前 Skill", host)); assert.equal(selected, undefined);
    console.log("PASS advanced Skill searchable/selectable, full body readonly, complete-content editable copy, original remains unchanged.");
    await click(button("Skill", host)); await field(label("搜索 Skill") as HTMLInputElement, "暖调法式");
    assert(popup()!.textContent?.includes(warm.name)); await click(label(`查看${warm.name}`));
    assert.equal(popup()!.querySelector("textarea")!.value, warmRaw); assert(popup()!.querySelector("textarea")!.readOnly);
    await click(button("返回", popup()!)); await field(label("搜索 Skill") as HTMLInputElement, "暖调法式");
    const warmSelect = [...popup()!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.querySelector("span.font-semibold")?.textContent === warm.name)!;
    await click(warmSelect); assert.equal(selected, warm.id); await click(label("取消当前 Skill", host));
    console.log("PASS warm French album Skill exact attachment body, hash, searchable/read-only/selectable and injected without triggering generation.");
    await click(button("Skill", host)); await fire(popup()!, new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })); assert.equal(popup(), null); await click(button("Skill", host)); await fire(document.body, new PointerEvent("pointerdown", { bubbles: true, button: 0 })); assert.equal(popup(), null);
    await click(button("Skill", host)); await act(async () => useThemeStore.setState({ theme: "dark" })); const color = document.createElement("span"); color.style.color = canvasThemes.dark.node.text; assert.equal(popup()!.style.color, color.style.color); await act(async () => root.render(<Harness disabled />)); assert.equal(popup(), null); assert(button("Skill", host).disabled); document.removeEventListener("pointerdown", count); document.removeEventListener("wheel", count); document.removeEventListener("keydown", count);
    console.log("PASS DOM menu, favorite, builtin readonly/copy, search, selection/chip removal, portal z280, canvas event isolation, Escape/outside close, dark theme and disabled state.");
    await act(async () => root.unmount()); host.remove(); await clearAssistantSkills(); assert.deepEqual(state().skills, []); assert.deepEqual(state().favorites, []); assert.equal(builtins.length, 13); assert.deepEqual((await db.getItem<any>("catalog")).skills, []); console.log("PASS cleanup clears user Skill/favorites and retains application builtins.");
}
main().then(() => { console.log("ALL CANVAS ASSISTANT SKILL CHECKS PASSED"); process.exit(0); }).catch(async (error) => { console.error(error); await act(async () => root.unmount()); host.remove(); process.exit(1); });
