import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React, { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import ts from "typescript";
import { buildCanvasResourceReferences, getGroupResourceNodes } from "../src/lib/canvas/canvas-resource-references";
import { buildNodeGenerationContext } from "../src/components/canvas/canvas-node-generation";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

// Exercise the production panel's render, button and submit handler. Unrelated settings UI,
// translation and stores are inert here; upstream resource parsing/context are the real modules.
const source = readFileSync("src/components/canvas/canvas-node-prompt-panel.tsx", "utf8");
const tree = ts.createSourceFile("canvas-node-prompt-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actual = tree.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "CanvasNodePromptPanel");
assert(actual, "Production prompt panel missing");
const empty = () => null;
const theme = { toolbar: { panel: "", border: "" }, node: { text: "" } };
const scope = {
    React, useEffect, useState, CanvasNodeType, buildCanvasResourceReferences, getGroupResourceNodes,
    useTranslation: () => ({ t: (key: string) => key }), useEffectiveConfig: () => ({}),
    useConfigStore: (select: (state: unknown) => unknown) => select({ openConfigDialog: empty }),
    canvasThemes: { light: theme }, useThemeStore: (select: (state: unknown) => unknown) => select({ theme: "light" }),
    buildGenerationConfig: () => ({}), defaultMode: (type: string) => type === "text" ? "text" : type === "video" ? "video" : type === "audio" ? "audio" : "image",
    Button: ({ children, onClick, disabled, "aria-label": label }: any) => <button onClick={onClick} disabled={disabled} aria-label={label}>{children}</button>,
    Tooltip: ({ children }: any) => children, Modal: empty,
    CanvasPromptChipInput: ({ value, onChange, onSubmit }: any) => <textarea value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmit?.(); }} />,
    CanvasNodeReferenceBar: empty, CanvasPromptLibrary: empty, ModelPicker: empty,
    CanvasImageSettingsPopover: empty, CanvasVideoSettingsPopover: empty, CanvasAudioSettingsPopover: empty, CanvasTextSettingsPopover: empty,
    Maximize2: empty, LoaderCircle: empty, Square: empty, ArrowUp: empty,
};
const js = ts.transpileModule(`const Component = (${actual.getText(tree).replace(/^export\s+/, "")});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.None } }).outputText;
const Panel = new Function(...Object.keys(scope), `${js};return Component;`)(...Object.values(scope)) as React.ComponentType<any>;
const make = (id: string, type = CanvasNodeType.Image, metadata = {}): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 300, metadata });
let passed = 0;
async function check(name: string, work: () => void | Promise<void>) { await work(); console.log(`PASS ${name}`); passed++; }
async function main() {
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const prompts: string[] = [], configs: unknown[] = [], generated: unknown[][] = [], stopped: string[] = [];
    const promptNode = make("text", CanvasNodeType.Text, { content: "A small orange kitten" });
    const imageNode = make("image"); let current: any;
    const render = async (node: CanvasNodeData, connectedNodes: CanvasNodeData[] = [], extra: any = {}) => {
        current = { node, nodes: [node, promptNode, ...connectedNodes], connectedNodes, isRunning: false, onPromptChange: (_: string, value: string) => prompts.push(value), onConfigChange: (_: string, patch: unknown) => configs.push(patch), onGenerate: (...args: unknown[]) => generated.push(args), onStop: (id: string) => stopped.push(id), ...extra };
        await act(async () => root.render(<Panel {...current} />));
    };
    const generate = () => host.querySelector('[aria-label="canvas.promptPanel.generate"]') as HTMLButtonElement;
    const click = async (button: HTMLButtonElement) => act(async () => button.click());
    try {
        await check("empty local prompt and no input stays disabled", async () => { await render(imageNode); assert.equal(generate().disabled, true); });
        await check("direct upstream text enables run, dispatches blank local prompt and does not mutate/copy text", async () => {
            await render(imageNode, [promptNode]); assert.equal(generate().disabled, false); await click(generate());
            assert.deepEqual(generated.pop(), ["image", "image", ""]); assert.deepEqual(prompts, []); assert.deepEqual(configs, []);
            assert.equal(host.querySelector("textarea")?.value, ""); assert.equal(promptNode.metadata?.content, "A small orange kitten");
            const context = buildNodeGenerationContext("image", [imageNode, promptNode], [{ id: "edge", fromNodeId: "text", toNodeId: "image" }], "");
            assert(context.prompt.includes("A small orange kitten")); assert.equal(context.textCount, 1);
        });
        await check("keyboard submission has same upstream-text rule", async () => {
            await act(async () => host.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
            assert.deepEqual(generated.pop(), ["image", "image", ""]);
        });
        await check("disconnect or whitespace-only text disables immediately", async () => {
            await render(imageNode); assert.equal(generate().disabled, true);
            await render(imageNode, [make("blank", CanvasNodeType.Text, { content: " \n  " })]); assert.equal(generate().disabled, true);
        });
        await check("image-only reference does not become a fake text prompt", async () => {
            await render(imageNode, [make("reference", CanvasNodeType.Image, { content: "data:image/png;base64,AA==" })]); assert.equal(generate().disabled, true);
        });
        await check("linked group resolves real child text without using the group title", async () => {
            const group = make("group", CanvasNodeType.Group), child = { ...promptNode, id: "group-child", metadata: { content: "Grouped prompt", groupId: "group" } };
            await render(imageNode, [group], { nodes: [imageNode, group, child] }); assert.equal(generate().disabled, false); await click(generate()); assert.deepEqual(generated.pop(), ["image", "image", ""]);
        });
        await check("registered text resource is accepted, local prompt still sent once", async () => {
            registerNodeDefinitions([{ type: "test:prompt", title: "Prompt", icon: null, defaultSize: { width: 100, height: 100 }, resource: () => ({ kind: "text", text: "Plugin text" }) }], "text-run-0226");
            const plugin = make("plugin", "test:prompt" as CanvasNodeType);
            await render(imageNode, [plugin]); assert.equal(generate().disabled, false);
            const local = make("local", CanvasNodeType.Image, { prompt: " local instruction " }); await render(local, [promptNode]); await click(generate()); assert.deepEqual(generated.pop(), ["local", "image", "local instruction"]);
            const context = buildNodeGenerationContext("local", [local, promptNode], [{ id: "edge", fromNodeId: "text", toNodeId: "local" }], "local instruction");
            assert.equal(context.prompt.split("A small orange kitten").length - 1, 1); assert(context.prompt.startsWith("local instruction"));
        });
        await check("video/audio/text use upstream text; plugin scene-specific mode keeps original guard", async () => {
            for (const mode of [CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text]) { const node = make(`target-${mode}`, mode); await render(node, [promptNode]); assert.equal(generate().disabled, false); await click(generate()); assert.deepEqual(generated.pop(), [node.id, mode, ""]); }
            await render(imageNode, [promptNode], { modeOverride: "image" }); assert.equal(generate().disabled, true);
        });
        await check("running node always retains enabled stop action", async () => {
            await render(imageNode, [], { isRunning: true }); const stop = host.querySelector('[aria-label="canvas.promptPanel.stopGeneration"]') as HTMLButtonElement;
            assert.equal(stop.disabled, false); await click(stop); assert.deepEqual(stopped, ["image"]);
        });
        console.log(`Prompt upstream text: ${passed}/${passed} passed; production panel and context, no network.`);
    } finally { unregisterPluginNodes("text-run-0226"); await act(async () => root.unmount()); host.remove(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });