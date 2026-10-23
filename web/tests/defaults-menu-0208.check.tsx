import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import i18n from "../src/i18n";
import { NodeCreateMenu } from "../src/components/canvas/canvas-create-menus";
import { CanvasToolbar } from "../src/components/canvas/canvas-toolbar";
import { registerBuiltinNodes } from "../src/components/canvas/nodes/builtin-nodes";
import type { CanvasNodeContext } from "../src/types/canvas-plugin";
import { getNodeDefinition, registerNodeDefinitions } from "../src/lib/canvas/node-registry";
import { canvasThemes } from "../src/lib/canvas-theme";
import { inferMediaScale } from "../src/lib/media-size";
import { buildGenerationConfig } from "../src/lib/canvas/canvas-generation-helpers";
import { useConfigStore, defaultConfig, CONFIG_STORE_KEY } from "../src/stores/use-config-store";
import { useThemeStore } from "../src/stores/use-theme-store";
import { useCanvasStore } from "../src/stores/canvas/use-canvas-store";

const no = () => {}, host = document.createElement("div"); document.body.append(host);
const root = createRoot(host);
const fire = async (target: EventTarget, event: Event) => act(async () => { target.dispatchEvent(event); });
const click = (target: EventTarget) => fire(target, new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
const labels = ["文本", "图片", "多维表格", "LLM 多模态分析", "生成配置", "组", "视频", "并发生成", "音频"];

async function main() {
    await i18n.changeLanguage("zh-CN");
    const script = readFileSync("index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)![1];
    new Function(script)();
    assert.equal(document.documentElement.classList.contains("warm"), false, "pre-React first paint is pure white");
    localStorage.setItem("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "dark" } }));
    new Function(script)();
    assert.equal(document.documentElement.classList.contains("warm"), true, "pre-React script retains saved warm choice");
    localStorage.removeItem("infinite-canvas:theme_store"); document.documentElement.classList.remove("warm");
    assert.equal(useThemeStore.getState().theme, "light");
    assert.equal(canvasThemes[useThemeStore.getState().theme].canvas.background, "#ffffff");
    assert.equal(defaultConfig.canvasImageCount, "1");
    assert.equal(defaultConfig.count, "1");
    assert.equal(inferMediaScale(defaultConfig.size), "2k");
    const config = buildGenerationConfig(defaultConfig, undefined, "image");
    assert.equal(config.count, "1"); assert.equal(inferMediaScale(config.size), "2k");
    const id = useCanvasStore.getState().createProject("defaults");
    assert.equal(useCanvasStore.getState().openProject(id)!.backgroundMode, "lines");
    assert.equal(useCanvasStore.getState().openProject(useCanvasStore.getState().importProject({ title: "no background" }))!.backgroundMode, "lines");
    console.log("PASS clean install defaults: pure white, line grid, one image, 2K generation.");

    // Persisted choices and the independent credential groups must survive hydration.
    const channels = [
        { id: "image", name: "绘画", baseUrl: "https://image.example.test", apiKey: "test-image-placeholder", apiFormat: "openai" as const, models: [] },
        { id: "text", name: "对话", baseUrl: "https://text.example.test", apiKey: "test-text-placeholder", apiFormat: "openai" as const, models: [] },
    ];
    localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify({ state: { config: { ...defaultConfig, channels, canvasImageCount: "7", size: "3840x2160" } }, version: 0 }));
    await useConfigStore.persist.rehydrate();
    assert.equal(useConfigStore.getState().config.canvasImageCount, "7");
    assert.equal(useConfigStore.getState().config.size, "3840x2160");
    assert.deepEqual(channels.map(c => useConfigStore.getState().config.channels.find(saved => saved.id === c.id)!.apiKey), channels.map(c => c.apiKey));
    localStorage.setItem(CONFIG_STORE_KEY, JSON.stringify({ state: { config: { channels } }, version: 0 }));
    await useConfigStore.persist.rehydrate();
    assert.equal(useConfigStore.getState().config.canvasImageCount, "1"); assert.equal(inferMediaScale(useConfigStore.getState().config.size), "2k");
    localStorage.setItem("infinite-canvas:theme_store", JSON.stringify({ state: { theme: "dark" }, version: 0 }));
    await useThemeStore.persist.rehydrate(); assert.equal(useThemeStore.getState().theme, "dark"); useThemeStore.setState({ theme: "light" });
    console.log("PASS saved preferences and separate image/text credentials retained; missing preferences use new defaults.");

    registerBuiltinNodes();
    registerNodeDefinitions([{ type: "test:extra", title: "扩展测试", icon: null, defaultSize: { width: 100, height: 100 } }], "test");
    let created: string[] = [];
    await act(async () => root.render(<NodeCreateMenu position={{ x: 0, y: 0 }} onCreate={(type) => created.push(type)} onClose={no} />));
    const menuButtons = [...host.querySelectorAll("button")].filter(button => button.querySelector("span.min-w-0"));
    assert.deepEqual(menuButtons.map(button => button.querySelector("span.min-w-0 > span")!.textContent), [...labels, "扩展测试"]);
    for (const button of menuButtons.slice(2, 4)) {
        await fire(button, new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
        await fire(button, new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })); await click(button);
    }
    assert.deepEqual(created, ["dxos:table", "dxos:llm"]);
    console.log("PASS menu table/LLM replace video/audio positions and create correct nodes; extensions retained.");

    created = [];
    await act(async () => root.render(<CanvasToolbar selectedCount={0} canvasTool="select" canUndo={false} canRedo={false} backgroundMode="lines" showImageInfo={false} onAddImage={no} onAddVideo={() => created.push("video")} onAddAudio={() => created.push("audio")} onAddText={no} onAddConfig={no} onAddGroup={no} onAddExtensionNode={(type) => created.push(type)} onUndo={no} onRedo={no} onUpload={no} onDelete={no} onClear={no} onCanvasToolChange={no} onBackgroundModeChange={no} onShowImageInfoChange={no} onFocusSelected={no} />));
    const nodeButtons = [...host.querySelectorAll("[data-canvas-bottom-toolbar] button")].filter(button => labels.includes(button.getAttribute("aria-label") || ""));
    assert.deepEqual(nodeButtons.map(button => button.getAttribute("aria-label")), labels);
    await click(nodeButtons[2]); await click(nodeButtons[3]); await click(nodeButtons[6]); await click(nodeButtons[8]);
    assert.deepEqual(created, ["dxos:table", "dxos:llm", "video", "audio"]);
    console.log("PASS toolbar matches menu order and table/LLM/video/audio actions work.");

    useConfigStore.setState({ config: defaultConfig });
    const Content = getNodeDefinition("dxos:concurrent")!.Content!;
    const node = { id: "default-batch", type: "dxos:concurrent", title: "batch", position: { x: 0, y: 0 }, width: 420, height: 600, metadata: {} };
    const ctx = { node, theme: canvasThemes.light, getNodes: () => [node], getConnections: () => [], ai: { listModels: () => [] }, updateMetadata: (patch: object) => { node.metadata = { ...node.metadata, ...patch }; root.render(<Content ctx={ctx} />); } } as unknown as CanvasNodeContext;
    await act(async () => root.render(<Content ctx={ctx} />));
    const ratio = host.querySelector<HTMLSelectElement>('select[aria-label="生成比例"]')!, resolution = host.querySelector<HTMLSelectElement>('select[aria-label="生成分辨率"]')!;
    assert.equal(resolution.value, "2k"); assert.equal(ratio.value, "1:1");
    ratio.value = "auto"; await fire(ratio, new Event("change", { bubbles: true }));
    assert.equal(ratio.value, "auto"); assert.equal(resolution.value, "2k");
    resolution.value = "4k"; await fire(resolution, new Event("change", { bubbles: true }));
    assert.equal(ratio.value, "auto"); assert.equal(resolution.value, "4k");
    console.log("PASS new concurrent node inherits 2K preference and retains independent auto ratio with 2K/4K.");
}
main().then(async () => { await act(async () => root.unmount()); host.remove(); process.exit(0); }).catch((error) => { console.error(error); process.exit(1); });
