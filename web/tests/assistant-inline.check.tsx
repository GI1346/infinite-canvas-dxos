import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { CanvasAssistantDock } from "../src/components/agent/canvas-assistant-dock";
import { useCanvasAssistantStore as store, type CanvasAssistantContext } from "../src/stores/use-canvas-assistant-store";
import { assistantReferenceToken as token, assistantReadableDraft, assistantReferenceIds } from "../src/lib/canvas/assistant-inline-references";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";

HTMLElement.prototype.scrollIntoView = function () {};
window.Range.prototype.getBoundingClientRect = () => ({ left: 200, top: 220, bottom: 240, right: 200, width: 0, height: 20 }) as DOMRect;
const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const state = () => store.getState(), session = () => state().sessions.find((item) => item.id === state().currentId)!;
const label = (name: string) => { const element = document.querySelector<HTMLElement>(`[aria-label="${name}"]`); assert(element, name); return element; };
const fire = async (el: EventTarget, event: Event) => act(async () => { el.dispatchEvent(event); await tick(); });
async function click(el: HTMLElement) { for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) await fire(el, type.startsWith("pointer") ? new PointerEvent(type, { bubbles: true, cancelable: true, button: 0 }) : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })); }
function caret(el: Node, offset: number) { const range = document.createRange(); range.setStart(el, offset); range.collapse(true); window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); document.dispatchEvent(new Event("selectionchange")); }
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhU0AAAAASUVORK5CYII=";
const snapshot = { projectId: "inline-0213", title: "offline", nodes: [1,2].map((i) => ({ id: `img${i}`, type: "image" as const, title: `产品${i}.png`, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: image } })), connections: [], selectedNodeIds: ["img2"], viewport: { x: 0, y: 0, k: 1 } };
const context: CanvasAssistantContext = { snapshot, getSnapshot: () => snapshot, applyOps: () => snapshot, runNode: async () => { throw Error("No generation"); } };
let requests = 0; globalThis.fetch = (async () => { requests++; throw Error("No network"); }) as typeof fetch;
async function main() {
 useConfigStore.setState({config: {...defaultConfig,channels:[],models:[],imageModel:"",textModel:"",videoModel:""}});
 await act(async () => { state().setContext(context); state().setOpen(true); await tick(60); state().setDraft("把的手柄换成另一张的手柄"); root.render(<ConfigProvider theme={{token:{motion:false}}}><CanvasAssistantDock /></ConfigProvider>); await tick(); });
 const editor=label("Agent 消息"); editor.focus(); caret(editor.firstChild!,1);
 await click(label("引用节点或模型"));
 const menu=document.querySelector<HTMLElement>("[data-canvas-resource-mention-menu]")!; assert(menu); assert.equal(menu.querySelectorAll("img").length,2);
 const candidate=[...menu.querySelectorAll("button")].find((el)=>el.textContent?.includes("产品1.png"))!;
 await fire(candidate,new MouseEvent("mouseover",{bubbles:true}));
 const hover=document.querySelector<HTMLElement>("[data-reference-image-preview]")!; assert(hover); assert.equal(hover.querySelector("img")?.src,image); assert(hover.hasAttribute("data-canvas-no-zoom"));
 await click([...hover.querySelectorAll("button")].find((el)=>el.textContent==="查看原图")!);
 assert(document.querySelector("[data-image-preview-viewport]"),"original image viewer");
 await click(document.querySelector<HTMLElement>(".ant-modal-close")!); await act(async()=>{await tick(180)});
 // Open again at the same caret and select with the real pointerdown-to-click sequence.
 await click(label("引用节点或模型"));
 const currentMenu=document.querySelector<HTMLElement>("[data-canvas-resource-mention-menu]")!;
 await click([...currentMenu.querySelectorAll("button")].find((el)=>el.textContent?.includes("产品1.png"))!);
 assert.equal(session().draft,`把${token("img1")} 的手柄换成另一张的手柄`); assert.deepEqual(session().references,["img1"]);
 assert.equal(editor.querySelectorAll("[data-ref-label] img").length,1); assert(!document.querySelector("[data-assistant-chips]"),"no top image-chip pile");
 const compact=editor.querySelector<HTMLElement>("[data-ref-label]")!;
 assert.equal(compact.textContent,"@图片1"); assert.equal(compact.title,"产品1.png"); assert(compact.classList.contains("inline-flex") && compact.classList.contains("h-[1em]") && compact.classList.contains("whitespace-nowrap"),"image and @ label stay on one text-height inline unit");
 assert(compact.querySelector("img")!.classList.contains("size-[1em]")); assert(!compact.classList.contains("size-12") && !compact.classList.contains("border"));
 const afterChip=document.createRange();afterChip.setStartAfter(compact);afterChip.collapse(true);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(afterChip);
 await fire(editor,new Event("input",{bubbles:true}));assert(!document.querySelector("[data-canvas-resource-mention-menu]"),"displayed @图片 label must not reopen mention matching");
 const tail=editor.lastChild!; caret(tail,tail.textContent!.indexOf("另一张")); await click(label("引用节点或模型"));
 await click([...document.querySelectorAll<HTMLElement>("[data-canvas-resource-mention-menu] button")].find((el)=>el.textContent?.includes("产品2.png"))!);
 assert.equal(assistantReferenceIds(session().draft).length,2); assert(session().draft.indexOf(token("img2"))>session().draft.indexOf("换成"));
 assert.deepEqual([...editor.querySelectorAll("[data-ref-label]")].map(el=>el.textContent),["@图片1","@图片2"]);
 const saved=session().draft;
 await click(label("全屏编辑 Agent 输入")); const expanded=label("Agent 全屏输入文字"); assert.equal(expanded.querySelectorAll("[data-ref-label] img").length,2); assert.equal(expanded.getAttribute("contenteditable"),"true");
 assert.deepEqual([...expanded.querySelectorAll("[data-ref-label]")].map(el=>el.textContent),["@图片1","@图片2"]); assert([...expanded.querySelectorAll("[data-ref-label] img")].every(el=>el.classList.contains("size-[1em]")),"fullscreen scales thumbnails with its own text size");
 expanded.focus(); const end=expanded.lastChild!; caret(end,end.textContent!.length); const text=document.createTextNode("\n已修改全文"); expanded.append(text); caret(text,text.length); await fire(expanded,new Event("input",{bubbles:true})); assert.equal(session().draft,saved+"\n已修改全文");
 await click(label("Agent 全屏输入文字").closest(".ant-modal")!.querySelector<HTMLElement>(".ant-modal-footer button")!);
 assert.equal(editor.querySelectorAll("[data-ref-label]").length,2); assert(editor.textContent?.includes("已修改全文"));
 assert(assistantReadableDraft(session().draft,(id)=>id==="img1"?"产品1":"产品2").includes("把【产品1（节点ID:img1）】"));
 // Atomic deletion removes only the referenced occurrence and updates attached IDs.
 editor.focus(); const chip=editor.querySelector<HTMLElement>("[data-ref-label]")!; const range=document.createRange();range.setStartAfter(chip);range.collapse(true);window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
 await fire(editor,new KeyboardEvent("keydown",{key:"Backspace",bubbles:true,cancelable:true})); await act(async()=>{await tick(50)});assert(!session().references.includes("img1"));assert(session().references.includes("img2"));
 await act(async()=>{state().setDraft("前后");await tick()});
 editor.focus();editor.firstChild!.textContent="前@后";caret(editor.firstChild!,2);await fire(editor,new Event("input",{bubbles:true}));
 await click([...document.querySelectorAll<HTMLElement>("[data-canvas-resource-mention-menu] button")].find(el=>el.textContent?.includes("产品1.png"))!);
 assert.equal(session().draft,`前${token("img1")} 后`,"typed @ uses current caret");
 const pasted=`多行\n文字${token("img2")}`;editor.focus();caret(editor.lastChild!,editor.lastChild!.textContent!.length);
 const paste=new Event("paste",{bubbles:true,cancelable:true});Object.defineProperty(paste,"clipboardData",{value:{getData:()=>pasted}});await fire(editor,paste);
 assert.equal(session().draft,`前${token("img1")} 后${pasted}`);assert.equal(editor.querySelectorAll("[data-ref-label] img").length,2);
 const selection=window.getSelection()!;const next=document.createTextNode("继续");const cursor=selection.getRangeAt(0);cursor.insertNode(next);caret(next,next.length);await fire(editor,new Event("input",{bubbles:true}));
 assert(session().draft.endsWith(`${pasted}继续`),"paste retains caret instead of jumping to input start");
 const inline=editor.querySelector<HTMLElement>("[data-ref-label]")!;await fire(inline,new MouseEvent("mouseover",{bubbles:true}));assert(document.querySelector("[data-reference-image-preview] img"),"inline image hover");
 assert.equal(requests,0); await act(async()=>root.unmount()); console.log("PASS Agent compact text-height @图片1/@图片2 inline references: typed/toolbar cursor placement, thumbnails/menu and inline hover/original viewer, full-screen edit sync, stable IDs, atomic deletion and multiline paste caret; zero API requests.");
}
main().then(()=>process.exit(0)).catch((error)=>{console.error(error);process.exit(1)});
