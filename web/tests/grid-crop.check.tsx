import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "../src/components/canvas/canvas-node-split-dialog";

let passed = 0;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
async function fire(target: EventTarget, event: Event) { await act(async () => { target.dispatchEvent(event); await tick(); }); }
const mouse = (type: string) => new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
const pointer = (type: string, x = 300, y = 200) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y });
const button = (text: string) => { const result = [...document.querySelectorAll("button")].find((element) => element.textContent === text); assert.ok(result, text); return result; };
const named = (label: string) => { const result = document.querySelector(`[aria-label="${label}"]`); assert.ok(result, label); return result as HTMLElement; };
const line = (axis: string, index = 0) => { const result = document.querySelector(`[data-grid-line="${axis}:${index}"]`); assert.ok(result); return result as HTMLElement; };
async function test(name: string, work: () => Promise<void>) { await work(); console.log(`PASS ${name}`); passed++; }

async function main() {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); let output: CanvasImageSplitParams | null = null;
    await act(async () => { root.render(<CanvasNodeSplitDialog dataUrl="data:image/png;base64,AA==" open onClose={() => {}} onConfirm={(value) => { output = value; }} />); await tick(); });
    const stage = document.querySelector("[data-grid-stage]") as HTMLElement, viewport = document.querySelector("[data-grid-viewport]") as HTMLElement;
    stage.getBoundingClientRect = viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400, x: 0, y: 0, toJSON() {} });
    await test("多宫格默认全选，奇数像素尺寸按真实边界计算且输出全部行列", async () => {
        assert.ok(document.body.textContent?.includes("多宫格裁剪")); assert.equal(document.querySelectorAll("[data-grid-cell]").length, 4);
        const sizes = [...document.querySelectorAll("[data-grid-cell]")].map((element) => element.textContent);
        assert.ok(sizes[0]?.includes("501 × 351 px")); assert.ok(sizes[1]?.includes("500 × 351 px")); assert.ok(sizes[3]?.includes("500 × 350 px"));
        await fire(button("生成 4 个图片子节点"), mouse("click"));
        assert.equal(output!.rows, 2); assert.equal(output!.columns, 2); assert.equal(output!.selectedCells!.length, 4);
    });
    await test("切片点选与全选/全不选控制输出，零选禁用，选择历史可撤销重做", async () => {
        await fire(button("全不选"), mouse("click")); assert.equal((button("生成 0 个图片子节点") as HTMLButtonElement).disabled, true);
        await fire(named("选择第 2 行第 1 列切片"), mouse("click")); await fire(button("生成 1 个图片子节点"), mouse("click")); assert.deepEqual(output!.selectedCells, [{ row: 1, column: 0 }]);
        await fire(named("撤回切图调整"), mouse("click")); assert.equal(named("选择第 2 行第 1 列切片").getAttribute("aria-pressed"), "false");
        await fire(named("重做切图调整"), mouse("click")); assert.equal(named("选择第 2 行第 1 列切片").getAttribute("aria-pressed"), "true");
        await fire(button("全选"), mouse("click")); assert.equal(button("生成 4 个图片子节点").hasAttribute("disabled"), false);
        await fire(named("输出第 1 行第 1 列切片"), mouse("click")); assert.equal(named("选择第 1 行第 1 列切片").getAttribute("aria-pressed"), "false");
    });
    await test("拖动自定义切线保留选片、展示实际尺寸，撤销/重做恢复边界", async () => {
        await fire(line("vertical"), pointer("pointerdown")); await fire(window, pointer("pointermove", 150, 200)); await fire(window, pointer("pointerup", 150, 200));
        assert.equal(line("vertical").style.left, "25%"); assert.ok(named("选择第 1 行第 1 列切片").textContent?.includes("250 × 351"));
        assert.equal(named("选择第 1 行第 1 列切片").getAttribute("aria-pressed"), "false");
        await fire(named("撤回切图调整"), mouse("click")); assert.equal(line("vertical").style.left, "50%");
        await fire(named("重做切图调整"), mouse("click")); assert.equal(line("vertical").style.left, "25%");
    });
    await test("空格平移和滚轮缩放覆盖切线，不拖动切线或切换输出选择", async () => {
        const cut = line("vertical").style.left, selection = named("选择第 1 行第 1 列切片").getAttribute("aria-pressed");
        await fire(window, new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }));
        viewport.scrollLeft = 80; viewport.scrollTop = 60;
        await fire(line("vertical"), pointer("pointerdown")); await fire(viewport, pointer("pointermove", 350, 230)); await fire(viewport, pointer("pointerup", 350, 230));
        assert.equal(line("vertical").style.left, cut); assert.equal(viewport.scrollLeft, 30); assert.equal(viewport.scrollTop, 30);
        await fire(window, new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true, cancelable: true }));
        const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 300, clientY: 200 }); await fire(line("vertical"), wheel);
        assert.equal(wheel.defaultPrevented, true); assert.ok(document.body.textContent?.includes("120%")); assert.equal(line("vertical").style.left, cut); assert.equal(named("选择第 1 行第 1 列切片").getAttribute("aria-pressed"), selection);
    });
    await test("行列输入中的空格保持正常编辑，不进入预览平移或删除切线", async () => {
        const input = named("宫格行数"); await act(async () => input.focus());
        const space = new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true, cancelable: true }); await fire(input, space); assert.equal(space.defaultPrevented, false);
        const remove = new KeyboardEvent("keydown", { code: "Backspace", key: "Backspace", bubbles: true, cancelable: true }); await fire(input, remove); assert.equal(remove.defaultPrevented, false);
        assert.equal(document.activeElement, input); assert.equal(document.querySelectorAll("[data-grid-line]").length, 2); await act(async () => input.blur());
    });
    await test("添加/删除切线重新全选，删除最后切线给空数组和单行单列", async () => {
        await fire(button("纵向线"), mouse("click")); assert.equal(document.querySelectorAll('[data-grid-line^="vertical"]').length, 2); assert.equal(button("生成 6 个图片子节点").hasAttribute("disabled"), false);
        await fire(button("删除线"), mouse("click"));
        await fire(line("vertical"), pointer("pointerdown")); await fire(window, pointer("pointerup")); await fire(button("删除线"), mouse("click"));
        await fire(line("horizontal"), pointer("pointerdown")); await fire(window, pointer("pointerup")); await fire(button("删除线"), mouse("click"));
        assert.equal(document.querySelectorAll("[data-grid-line]").length, 0);
        await fire(button("生成 1 个图片子节点"), mouse("click"));
        assert.equal(output!.rows, 1); assert.equal(output!.columns, 1); assert.deepEqual(output!.horizontalLines, []); assert.deepEqual(output!.verticalLines, []); assert.deepEqual(output!.selectedCells, [{ row: 0, column: 0 }]);
    });
    await act(async () => root.unmount()); host.remove();
    console.log(`PASS grid crop: ${passed}/${passed} UI checks; metadata mocked, real React/Ant Design, no network`);
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
