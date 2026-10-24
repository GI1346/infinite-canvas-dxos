import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { NODE_DEFAULT_SIZE } from "../src/constant/canvas";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { imageMetadata, audioMetadata, buildImageGenerationMetadata, buildAudioGenerationMetadata } from "../src/lib/canvas/canvas-node-factory";
import { fitNodeSize, generatedImageNodeSize, nodeSizeFromRatio } from "../src/lib/canvas/canvas-node-size";

// Compile the production callback body, rather than reimplementing its guards.
// Only transport/persistence and React setters are supplied by this offline harness.
const source = readFileSync("src/pages/canvas/project.tsx", "utf8"), tree = ts.createSourceFile("project.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function expression(name: string) {
    let found: ts.Node | undefined;
    const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
        if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(tree) === "useCallback") found = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    };
    visit(tree); assert(found, `Actual production function ${name} missing`); return found.getText(tree);
}
function compile(code: string, scope: Record<string, unknown>) {
    const js = ts.transpileModule(`const actual = (${code});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    return new Function(...Object.keys(scope), `${js}; return actual;`)(...Object.values(scope));
}
function callback(name: string, scope: Record<string, unknown>) { return compile(expression(name), scope); }
let lifecycle: ts.ArrowFunction | undefined;
const findLifecycle = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" && ts.isArrowFunction(node.arguments[0]) && node.arguments[0].getText(tree).includes("Only navigation/unmount cancels native requests")) lifecycle = node.arguments[0]; ts.forEachChild(node, findLifecycle); }; findLifecycle(tree); assert(lifecycle);
const guardGenerationSetter = callback("guardGenerationSetter", {});
const ref = <T,>(current: T) => ({ current });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function node(id = "source", type = "text"): CanvasNodeData { return { id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 240, metadata: {} }; }
const uploaded = { url: "test:image:new", storageKey: "test:image", width: 2048, height: 2048, bytes: 5, mimeType: "image/png" };
function setup() {
    const nodesRef = ref([node()]), connectionsRef = ref<any[]>([]), generationRequestsRef = ref(new Map<string, any>()), generationOwnersRef = ref(new Map<string, any>()), generationProjectRef = ref({ id: "project-a", alive: true }), videoPollIdsRef = ref(new Map<string, any>());
    let running: string | null = null, selected: Set<string> = new Set(), dialog: string | null = null, expanded: Set<string> = new Set(), edges = connectionsRef.current, selectionEdge: string | null = null;
    let sequence = 0, uploadCalls = 0, storeAudioCalls = 0, storeVideoCalls = 0, queued = false;
    const queue: Array<() => void> = [], calls: Array<{ kind: string; signal: AbortSignal }> = [], alerts: string[] = [];
    let imageRequest = async (_config: unknown, _prompt: string, options: { signal: AbortSignal }) => { calls.push({ kind: "image", signal: options.signal }); return [{ dataUrl: "test:new" }]; };
    let textRequest = async (_config: unknown, _messages: unknown, onText: (text: string) => void, options: { signal: AbortSignal }) => { calls.push({ kind: "text", signal: options.signal }); onText("new text"); return "new text"; };
    let audioRequest = async (_config: unknown, _prompt: string, options: { signal: AbortSignal }) => { calls.push({ kind: "audio", signal: options.signal }); return "new audio"; };
    let videoCreate = async (_config: unknown, _prompt: string, _images: unknown, options: { signal: AbortSignal }) => { calls.push({ kind: "video", signal: options.signal }); return { id: "server-video-task", provider: "openai", model: "video" }; };
    let videoWait = async () => "new video";
    const setter = <T,>(get: () => T, set: (value: T) => void) => (next: T | ((old: T) => T)) => { const apply = () => set(typeof next === "function" ? (next as (value: T) => T)(get()) : next); if (queued) queue.push(apply); else apply(); };
    const setNodes = setter(() => nodesRef.current, (value) => { nodesRef.current = value; });
    const setRunningNodeId = setter(() => running, (value) => { running = value; });
    const scope: Record<string, unknown> = { nodesRef, connectionsRef, generationRequestsRef, generationOwnersRef, generationProjectRef, videoPollIdsRef, guardGenerationSetter, setNodes, setRunningNodeId,
        setConnections: setter(() => edges, (value) => { edges = value; connectionsRef.current = value; }), setSelectedNodeIds: setter(() => selected, (value) => { selected = value; }), setSelectedConnectionId: setter(() => selectionEdge, (value) => { selectionEdge = value; }), setDialogNodeId: setter(() => dialog, (value) => { dialog = value; }), setExpandedBatchNodeIds: setter(() => expanded, (value) => { expanded = value; }),
        effectiveConfig: { count: "1", nodeRegenerateBehavior: "overwrite" }, isAiConfigReady: () => true, openConfigDialog: () => { throw new Error("unexpected config dialog"); },
        buildGenerationConfig: (_: unknown, _source: unknown, mode: string) => ({ model: mode, count: "1", size: "auto" }), buildNodeGenerationContext: (_id: string, _nodes: unknown, _edges: unknown, prompt: string) => ({ prompt, referenceImages: [], referenceVideos: [], referenceAudios: [] }), hydrateNodeGenerationContext: async (context: unknown) => context, buildNodeResponseMessages: (context: unknown) => context,
        getNodeDefinition: () => undefined, imageOutputCropContext: () => undefined, imageMetadata, audioMetadata, buildImageGenerationMetadata, buildAudioGenerationMetadata, getGenerationCount: Number, NODE_DEFAULT_SIZE, CanvasNodeType, fitNodeSize, generatedImageNodeSize, nodeSizeFromRatio, generationReferenceUrls: () => [], nanoid: () => `generated-${++sequence}`,
        requestGeneration: (...args: Parameters<typeof imageRequest>) => imageRequest(...args), requestEdit: (_config: unknown, prompt: string, _refs: unknown, options: { signal: AbortSignal }) => imageRequest(_config, prompt, options), uploadImage: async () => { uploadCalls++; return uploaded; },
        requestImageQuestion: (...args: Parameters<typeof textRequest>) => textRequest(...args), requestAudioGeneration: (...args: Parameters<typeof audioRequest>) => audioRequest(...args), storeGeneratedAudio: async () => { storeAudioCalls++; return { ...uploaded, mimeType: "audio/mpeg" }; },
        createVideoGenerationTask: (...args: Parameters<typeof videoCreate>) => videoCreate(...args), waitForVideoGenerationTask: () => videoWait(), storeGeneratedVideo: async () => { storeVideoCalls++; return { ...uploaded, mimeType: "video/mp4" }; }, applyGeneratedVideo: (item: CanvasNodeData) => ({ ...item, metadata: { ...item.metadata, status: "success", content: "new video" } }),
        NODE_STATUS_LOADING: "loading", NODE_STATUS_IDLE: "idle", NODE_STATUS_ERROR: "error", NODE_STATUS_SUCCESS: "success", isGenerationCanceled: (error: unknown) => error instanceof DOMException && error.name === "AbortError", isVideoTaskFailed: () => false, t: (value: string) => value, message: { error: (error: string) => alerts.push(error) },
    };
    const start = callback("startGenerationRequest", scope), finish = callback("finishGenerationRequest", scope); Object.assign(scope, { startGenerationRequest: start, finishGenerationRequest: finish });
    const video = callback("completeVideoNodeTask", scope); scope.completeVideoNodeTask = video;
    const run = callback("handleGenerateNode", scope), effect = compile(lifecycle!.getText(tree), scope); let cleanup = effect();
    return { run, start, finish, video, calls, alerts, graph: () => nodesRef.current, requests: generationRequestsRef, owners: generationOwnersRef, project: generationProjectRef, nodesRef,
        running: () => running, uploads: () => uploadCalls, storedAudio: () => storeAudioCalls, storedVideo: () => storeVideoCalls,
        image: (fn: typeof imageRequest) => { imageRequest = fn; }, text: (fn: typeof textRequest) => { textRequest = fn; }, audio: (fn: typeof audioRequest) => { audioRequest = fn; }, createVideo: (fn: typeof videoCreate) => { videoCreate = fn; }, waitVideo: (fn: typeof videoWait) => { videoWait = fn; },
        navigate: () => { generationProjectRef.current = { id: "project-b", alive: true }; cleanup(); cleanup = effect(); nodesRef.current = [node("new-project-node")]; }, dispose: () => cleanup(), queue: () => { queued = true; }, flush: () => { queued = false; while (queue.length) queue.shift()!(); } };
}
let passed = 0;
async function test(name: string, work: () => Promise<void> | void) { await work(); passed++; console.log(`PASS ${name}`); }
async function main() {
    const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Network forbidden in native generation guard test"); };
    try {
        await test("fresh generated image equals import size; empty target and explicit manual resize preserve correct geometry", async () => {
            const app = setup(); await app.run("source", "image", "draw");
            const output = app.graph().find((item) => item.type === "image")!; assert.deepEqual({width:output.width,height:output.height},fitNodeSize(uploaded.width,uploaded.height));
            assert.equal(output.metadata?.naturalWidth, 2048); assert(output.position.x > 300); app.dispose();
            for (const manual of [false, true]) { const app = setup(); app.nodesRef.current=[{...node("source","image"),width:180,height:240,metadata:{imageSizeManual:manual}}]; await app.run("source","image","draw");const out=app.graph()[0]; assert.equal(out.width,manual?180:640);assert.equal(out.height,manual?240:640); app.dispose(); }
            const sample=node(); assert.deepEqual(generatedImageNodeSize(1152,2048,sample),{width:360,height:640}); assert.deepEqual(generatedImageNodeSize(64,32,sample),{width:64,height:32});
            sample.metadata={freeResize:true}; assert.deepEqual(generatedImageNodeSize(1152,2048,sample),{width:300,height:240});
        });
        await test("actual native pre-aborted caller dispatches no transport or graph write", async () => {
            const app = setup(), abort = new AbortController(); abort.abort(); await assert.rejects(app.run("source", "image", "draw", abort.signal), /生成已停止/); assert.equal(app.calls.length, 0); assert.equal(app.requests.current.size, 0); assert.equal(app.graph().length, 1); app.dispose();
        });
        await test("actual image external signal reaches internal request; ignored abort skips upload and late writes", async () => {
            const app = setup(), pending = deferred<Array<{ dataUrl: string }>>(), abort = new AbortController();
            app.image(async (_config, _prompt, options) => { app.calls.push({ kind: "image", signal: options.signal }); return pending.promise; });
            const run = app.run("source", "image", "draw", abort.signal); await tick(); assert.equal(app.calls.length, 1); assert.notEqual(app.calls[0].signal, abort.signal); abort.abort(); assert(app.calls[0].signal.aborted); assert.equal(app.requests.current.size, 0); const before = JSON.stringify(app.graph()); pending.resolve([{ dataUrl: "old" }]); await run; assert.equal(JSON.stringify(app.graph()), before); assert.equal(app.uploads(), 0); assert.equal(app.alerts.length, 0); app.dispose();
        });
        await test("actual project effect aborts only navigation/unmount and old image cannot append to new shared canvas", async () => {
            for (const action of ["navigate", "dispose"] as const) { const app = setup(), pending = deferred<Array<{ dataUrl: string }>>(); app.image(async (_config, _prompt, options) => { app.calls.push({ kind: "image", signal: options.signal }); return pending.promise; }); const run = app.run("source", "image", "draw"); await tick(); assert(!app.calls[0].signal.aborted); if (action === "navigate") app.navigate(); else app.dispose(); assert(app.calls[0].signal.aborted); const before = JSON.stringify(app.graph()); pending.resolve([{ dataUrl: "old" }]); await run; assert.equal(JSON.stringify(app.graph()), before); assert.equal(app.uploads(), 0); assert.equal(app.requests.current.size, 0); }
        });
        await test("actual streamed text and delayed React functional updater reject stale project writes", async () => {
            const app = setup(), pending = deferred<string>(); let stream!: (text: string) => void;
            app.text(async (_config, _messages, onText, options) => { stream = onText; app.calls.push({ kind: "text", signal: options.signal }); return pending.promise; });
            const run = app.run("source", "text", "describe"); await tick(); app.queue(); stream("queued old stream"); app.navigate(); stream("late old stream"); app.flush(); assert.deepEqual(app.graph().map((item) => item.id), ["new-project-node"]); pending.resolve("old completed text"); await run; assert.deepEqual(app.graph().map((item) => item.id), ["new-project-node"]); app.dispose();
        });
        await test("actual stopped run late finally does not clear replacement controller or loading state", async () => {
            const app = setup(), old = deferred<string>(), next = deferred<string>(), abort = new AbortController(); let requests = 0;
            app.text(async (_config, _messages, _onText, options) => { app.calls.push({ kind: "text", signal: options.signal }); return ++requests === 1 ? old.promise : next.promise; });
            const oldRun = app.run("source", "text", "old", abort.signal); await tick(); abort.abort(); const newRun = app.run("source", "text", "new"); await tick(); const owner = app.requests.current.get("source")?.controller; assert(owner && !owner.signal.aborted); old.reject(new Error("late ignored error")); await oldRun; assert.equal(app.requests.current.get("source")?.controller, owner); assert.equal(app.running(), "source"); next.resolve("new valid result"); await newRun; assert.equal(app.graph().find((item) => item.id === "source")?.metadata?.content, "new valid result"); assert.equal(app.requests.current.size, 0); assert.equal(app.alerts.length, 0); app.dispose();
        });
        await test("actual start/finish ownership protects replacement request from old cleanup", () => {
            const app = setup(), first = app.start("source", "source"), second = app.start("source", "source"); assert(first.signal.aborted); app.finish("source", first); assert.equal(app.requests.current.get("source").controller, second); app.finish("source", second); assert.equal(app.requests.current.size, 0); app.dispose();
        });
        await test("actual audio/video transports ignore abort without persistence or stale result import; video ID retained", async () => {
            const app = setup(), audio = deferred<string>(), audioAbort = new AbortController(); app.audio(async (_config, _prompt, options) => { app.calls.push({ kind: "audio", signal: options.signal }); return audio.promise; }); const audioRun = app.run("source", "audio", "audio", audioAbort.signal); await tick(); audioAbort.abort(); audio.resolve("old audio"); await audioRun; assert.equal(app.storedAudio(), 0); app.dispose();
            const video = setup(), pending = deferred<string>(), videoAbort = new AbortController(); video.waitVideo(() => pending.promise); const videoRun = video.run("source", "video", "video", videoAbort.signal); await tick(); const output = video.graph().find((item) => item.type === "video")!; assert.equal(output.metadata?.videoTaskId, "server-video-task"); videoAbort.abort(); const before = JSON.stringify(video.graph()); pending.resolve("old video"); await videoRun; assert.equal(video.storedVideo(), 0); assert.equal(JSON.stringify(video.graph()), before); assert.equal(video.graph().find((item) => item.id === output.id)?.metadata?.videoTaskId, "server-video-task"); video.dispose();
        });
        console.log(`Native generation actual callbacks: ${passed}/${passed} passed (AST-extracted production callbacks/effect; mocked transport/persistence, no network).`);
    } finally { globalThis.fetch = originalFetch; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
