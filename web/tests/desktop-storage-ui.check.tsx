import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import "../src/i18n";
import { ConfigLocalStorage } from "../src/components/layout/config-local-storage";

const host = document.createElement("div"); document.body.append(host);
const root = createRoot(host);
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const render = async () => { await act(async () => { root.render(<ConfigLocalStorage active />); await tick(); }); };
const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
    assert(button, label);
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); await tick(); });
};
async function main() {
    await render();
    assert(host.textContent?.includes("当前是浏览器版"));
    assert(!host.textContent?.includes("清除其他数据，保留 API 配置"));
    await act(async () => { root.render(null); });
    let opened = 0, cleared = 0;
    window.blinkflowStorage = {
        info: async () => ({ installDirectory: "D:\\BlinkFlow", dataDirectory: "D:\\BlinkFlow\\BlinkFlowData" }),
        open: async () => { opened++; },
        clear: async () => { cleared++; return false; },
    };
    await render();
    assert(host.textContent?.includes("D:\\BlinkFlow\\BlinkFlowData"));
    assert(!host.textContent?.includes("清理旧目录"));
    await click("打开数据目录"); assert.equal(opened, 1);
    await click("清除其他数据"); assert.equal(cleared, 1);
    window.blinkflowStorage.clear = async () => { throw new Error("测试拒绝清理"); };
    await click("清除其他数据");
    assert(host.textContent?.includes("测试拒绝清理"));
    await act(async () => root.unmount());
    console.log("Storage UI passed: browser boundary, actual install/data paths, no old-directory button, native open/clear dispatch, cancellation and error visibility.");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
