import assert from "node:assert/strict";
import { cleanAssets, cleanProject, type CleanupOptions } from "../src/lib/canvas/canvas-cleanup";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import type { Asset } from "../src/stores/use-asset-store";

const options: CleanupOptions = { images: true, history: true, logs: true, assets: false, allProjects: false };
const project: CanvasProject = {
    id: "test", title: "保留工作流", createdAt: "now", updatedAt: "now", activeChatId: "chat", backgroundMode: "lines", showImageInfo: true, viewport: { x: 1, y: 2, k: 1 },
    connections: [{ id: "edge", fromNodeId: "input", toNodeId: "table", toPort: "input-1" }],
    nodes: [
        { id: "input", type: "image", title: "输入", position: { x: 0, y: 0 }, width: 300, height: 300, metadata: { content: "blob:input", storageKey: "image:input", images: [{ id: "output", content: "data:image/png;base64,AA==", storageKey: "image:output", status: "success", naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: "image/png" }], model: "relay::image", prompt: "保留提示词", status: "success" } },
        { id: "table", type: "dxos:table", title: "表格", position: { x: 400, y: 0 }, width: 600, height: 600, metadata: { table: { kind: "table", version: 1, columns: ["字段"], rows: [["翻译英文"]], selectedRows: [], mergedGroups: [] }, tableInputChannels: [{ id: "input-1" }], tableBatchRun: { id: "run", state: "completed", tasks: [] } } },
        { id: "video", type: "video", title: "视频", position: { x: 0, y: 400 }, width: 300, height: 300, metadata: { content: "blob:video", storageKey: "video:keep", model: "relay::video" } },
    ],
    chatSessions: [{ id: "chat", title: "对话", createdAt: "now", updatedAt: "now", messages: [{ id: "m", role: "user", text: "你好", references: [{ id: "ref", type: "image", title: "图片", dataUrl: "blob:input", storageKey: "image:input" }] }] }],
};
const original = JSON.stringify(project);
const cleaned = cleanProject(project, options);
assert.equal(JSON.stringify(project), original, "must not mutate original");
assert.equal(cleaned.nodes[0].metadata?.content, undefined);
assert.equal(cleaned.nodes[0].metadata?.storageKey, undefined);
assert.equal(cleaned.nodes[0].metadata?.images, undefined);
assert.equal(cleaned.nodes[0].metadata?.status, "idle");
assert.equal(cleaned.nodes[0].metadata?.model, "relay::image");
assert.equal(cleaned.nodes[0].metadata?.prompt, "保留提示词");
assert.deepEqual(cleaned.connections, project.connections);
assert.deepEqual(cleaned.nodes[1].metadata?.table, project.nodes[1].metadata?.table);
assert.deepEqual(cleaned.nodes[1].metadata?.tableInputChannels, project.nodes[1].metadata?.tableInputChannels);
assert.equal(cleaned.nodes[1].metadata?.tableBatchRun, undefined);
assert.equal(cleaned.nodes[2].metadata?.content, "blob:video");
assert.equal(cleaned.nodes[2].metadata?.storageKey, "video:keep");
assert.equal(cleaned.chatSessions.length, 0);
assert.equal(cleaned.activeChatId, null);
const historyOnly = cleanProject(project, { ...options, images: false });
assert.equal(historyOnly.nodes[0].metadata?.content, "blob:input");
const imagesOnly = cleanProject(project, { ...options, history: false, logs: false });
assert.equal(imagesOnly.chatSessions[0].messages[0].text, "你好");
assert.deepEqual(imagesOnly.chatSessions[0].messages[0].references, []);
const assets = [{ id: "i", kind: "image" }, { id: "v", kind: "video" }, { id: "t", kind: "text" }] as Asset[];
assert.equal(cleanAssets(assets, options), assets);
assert.deepEqual(cleanAssets(assets, { ...options, assets: true }).map((a) => a.id), ["v", "t"]);
console.log("PASS: 清理图片/历史；保留模型、提示词、连线、表格、视频；素材默认保留；源数据不变");
