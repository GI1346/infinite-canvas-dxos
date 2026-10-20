import assert from "node:assert/strict";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { fetchChannelModelDetails, requestEdit, requestGeneration, requestImageQuestion } from "../src/services/api/image";
import { relayImageInput, relayTaskBase, relayTasks, requestRelayImage, waitRelayImage, type RelayTask } from "../src/services/api/relay-tasks";
import { relayChatScript } from "../src/services/api/relay-chat";
import { createModelChannel, defaultConfig, RELAY_IMAGE_NAME, RELAY_IMAGE_URL, RELAY_TASK_URL, RELAY_TEXT_URL, resolveModelChannel, resolveModelRequestConfig, resolveModelScript, useConfigStore, type AiConfig } from "../src/stores/use-config-store";
import { useCallProtocolStore } from "../src/stores/use-call-protocol-store";

// Offline contract tests: synthetic credentials, no live accounts or network calls.
const imageChannel = createModelChannel({ id: "image-test", name: "65535 生图测试", baseUrl: RELAY_IMAGE_URL, imageTaskBaseUrl: RELAY_TASK_URL, apiKey: " test-image-key ", models: [{ name: "same-model", capability: "image" }] });
const textChannel = createModelChannel({ id: "text-test", name: "65535 对话测试", baseUrl: RELAY_TEXT_URL, apiKey: "test-text-key", models: [{ name: "same-model", capability: "text" }] });
const config: AiConfig = { ...defaultConfig, channels: [imageChannel, textChannel], model: "image-test::same-model", imageModel: "image-test::same-model", textModel: "text-test::same-model", apiKey: "must-not-use-global-key", systemPrompt: "系统要求", size: "2048x2048", quality: "high", count: "2" };
const results: Array<{ name: string; passed: boolean; detail?: string }> = [];
const original = { adapter: axios.defaults.adapter, fetch: globalThis.fetch, now: Date.now, timeout: globalThis.setTimeout };
let clock = 0;
let delays: number[] = [];
let sequence = 0;
const response = (req: InternalAxiosRequestConfig, data: unknown, status = 200) => ({ data, status, statusText: status === 202 ? "Accepted" : "OK", headers: {}, config: req });
function httpError(req: InternalAxiosRequestConfig, status: number, message: string) {
    return new AxiosError(message, "ERR_BAD_RESPONSE", req, undefined, response(req, { error: { message } }, status));
}
function task(id = `test-${++sequence}`): RelayTask {
    return { id, channelId: imageChannel.id, model: "same-model", baseUrl: RELAY_TASK_URL, status: "pending", createdAt: "test" };
}
function fakeClock() {
    clock = 0; delays = [];
    Date.now = () => clock;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
        if (Number(ms) < 3000) return original.timeout(callback, ms, ...args);
        delays.push(Number(ms));
        return original.timeout(() => { clock += Number(ms); callback(...args); }, 0);
    }) as typeof setTimeout;
}
async function check(name: string, run: () => Promise<void> | void) {
    fakeClock();
    axios.defaults.adapter = async () => { throw new Error("Unexpected Axios request: offline test refused network"); };
    globalThis.fetch = async () => { throw new Error("Unexpected fetch request: offline test refused network"); };
    await relayTasks.clear();
    try { await run(); results.push({ name, passed: true }); console.log(`PASS: ${name}`); }
    catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : String(error) }); console.error(`FAIL: ${name}\n${error instanceof Error ? error.stack : error}`); }
    finally { Date.now = original.now; globalThis.setTimeout = original.timeout; }
}

async function main() {
    await useCallProtocolStore.persist.rehydrate();
    useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: false } });
    await check("drawing preset renames old persisted labels, preserving keys, URLs, bindings and custom names", () => {
        const merge = useConfigStore.persist.getOptions().merge!;
        assert.equal(defaultConfig.channels[0].name, RELAY_IMAGE_NAME);
        for (const name of ["默认渠道", "Default channel", "65535 生图（独立密钥）", RELAY_IMAGE_NAME, "我的自定义绘画"]) {
            const saved = { ...imageChannel, id: "default", name, protocolId: "custom-image", imageTaskBaseUrl: "https://tasks.invalid", models: [{ name: "same-model", capability: "image" as const, script: undefined, protocolId: "model-protocol" }] };
            const result = merge({ config: { ...config, channels: [saved, textChannel] } }, useConfigStore.getState()).config;
            assert.deepEqual(result.channels.find((channel) => channel.id === saved.id), { ...saved, name: name === "我的自定义绘画" ? name : RELAY_IMAGE_NAME });
            assert.deepEqual(result.channels.find((channel) => channel.id === textChannel.id), textChannel);
        }
        const fresh = merge({ config: {} }, useConfigStore.getState()).config;
        assert.equal(fresh.channels.find((channel) => channel.baseUrl === RELAY_IMAGE_URL)?.name, RELAY_IMAGE_NAME);
        assert.equal(fresh.channels.find((channel) => channel.baseUrl === RELAY_IMAGE_URL)?.apiKey, "");
        const other = { ...imageChannel, name: "默认渠道", baseUrl: "https://other.invalid" };
        assert.equal(merge({ config: { ...config, channels: [other] } }, useConfigStore.getState()).config.channels[0].name, "默认渠道");
    });
    await check("independent channel credentials and no missing-channel/key fallback", async () => {
        assert.equal(resolveModelChannel(config, config.imageModel).apiKey.trim(), "test-image-key");
        assert.equal(resolveModelRequestConfig(config, config.textModel).apiKey, "test-text-key");
        assert.equal(resolveModelRequestConfig(config, config.textModel).baseUrl, RELAY_TEXT_URL);
        assert.throws(() => resolveModelChannel(config, "missing::same-model"), /不存在/);
        assert.throws(() => resolveModelChannel(config, "image-test::deleted-model"), /不存在/);
        assert.throws(() => resolveModelChannel(config, "unknown-model"), /不存在/);
        assert.throws(() => resolveModelChannel({ ...config, channels: [{ ...imageChannel, apiKey: "" }, textChannel] }, config.imageModel), /独立 API Key/);
        await assert.rejects(requestGeneration({ ...config, channels: [{ ...imageChannel, apiKey: "" }, textChannel] }, "prompt"), /独立 API Key/);
        await assert.rejects(requestImageQuestion({ ...config, model: config.textModel, channels: [imageChannel, { ...textChannel, apiKey: "" }] }, [], () => {}), /独立 API Key/);
        await assert.rejects(requestGeneration({ ...config, model: "missing::same-model" }, "prompt"), /不存在/);
    });
    await check("relay URL routing and complete image payload", () => {
        assert.equal(relayTaskBase({ ...imageChannel, imageTaskBaseUrl: undefined, baseUrl: `${RELAY_IMAGE_URL}/v1/` }), RELAY_TASK_URL);
        assert.equal(relayTaskBase(textChannel), undefined);
        assert.equal(relayTaskBase({ ...imageChannel, imageTaskBaseUrl: "" }), undefined);
        assert.equal(relayTaskBase({ ...imageChannel, protocolId: "custom-default" }), undefined);
        assert.equal(relayTaskBase({ ...imageChannel, imageTaskBaseUrl: "https://tasks.invalid/v1" }), "https://tasks.invalid/v1");
        assert.deepEqual(relayImageInput(config, "prompt", ["data:image/png;base64,AA==", "https://images.invalid/ref.png"]), { kind: "image", model: "same-model", input: { prompt: "prompt", n: 2, size: "2048x2048", quality: "high", image_urls: ["data:image/png;base64,AA==", "https://images.invalid/ref.png"] } });
        assert.deepEqual(relayImageInput({ ...config, size: "auto", quality: "auto", count: "1" }, "prompt", []), { kind: "image", model: "same-model", input: { prompt: "prompt", n: 1 } });
        for (const [count, expected] of [["-2", 2], ["2.8", 2], ["0", 1], ["99", 15], ["invalid", 1]] as const) assert.equal(relayImageInput({ ...config, count }, "prompt", []).input.n, expected);
    });
    await check("channel default protocol inheritance, model overrides and wrong/missing capability blocking", async () => {
        useCallProtocolStore.setState({ protocols: [
            { format: "canvas-call/v1", id: "image-default", label: "Image default", capability: "image", script: "return ['https://images.invalid/channel.png'];" },
            { format: "canvas-call/v1", id: "image-override", label: "Image override", capability: "image", script: "return ['https://images.invalid/override.png'];" },
            { format: "canvas-call/v1", id: "text-default", label: "Text default", capability: "text", script: "return 'text';" },
        ] });
        const channel = createModelChannel({ ...imageChannel, protocolId: "image-default", models: [
            { name: "inherited", capability: "image" },
            { name: "override", capability: "image", protocolId: "image-override" },
            { name: "script-override", capability: "image", script: "return ['https://images.invalid/script.png'];" },
            { name: "wrong-capability", capability: "text" },
            { name: "wrong-explicit", capability: "image", protocolId: "text-default" },
            { name: "missing-explicit", capability: "image", protocolId: "removed" },
        ] });
        const selected = { ...config, channels: [channel], model: "image-test::inherited" };
        assert.equal(resolveModelScript(selected, selected.model), "canvas-protocol:image-default");
        assert.equal(resolveModelScript(selected, "image-test::override"), "canvas-protocol:image-override");
        assert.equal(resolveModelScript(selected, "image-test::script-override"), "return ['https://images.invalid/script.png'];");
        assert.throws(() => resolveModelScript(selected, "image-test::wrong-capability"), /能力不匹配/);
        assert.throws(() => resolveModelScript(selected, "image-test::wrong-explicit"), /能力不匹配/);
        assert.throws(() => resolveModelScript(selected, "image-test::missing-explicit"), /已删除/);
        assert.equal((await requestGeneration(selected, "prompt"))[0].dataUrl, "https://images.invalid/channel.png");
        assert.equal((await requestGeneration({ ...selected, model: "image-test::override" }, "prompt"))[0].dataUrl, "https://images.invalid/override.png");
        assert.equal((await requestGeneration({ ...selected, model: "image-test::script-override" }, "prompt"))[0].dataUrl, "https://images.invalid/script.png");
        assert.equal(channel.models[0].protocolId, undefined, "继承不向每个模型复制协议 ID");
        useConfigStore.setState({ config: { ...selected, channels: [channel, { ...textChannel, imageTaskBaseUrl: "" }] } });
        await useConfigStore.persist.rehydrate();
        const restored = useConfigStore.getState().config.channels;
        assert.equal(restored.find((item) => item.id === channel.id)?.protocolId, "image-default");
        assert.equal(restored.find((item) => item.id === textChannel.id)?.imageTaskBaseUrl, "");
        assert.equal(restored.find((item) => item.id === channel.id)?.models[1].protocolId, "image-override");
        useCallProtocolStore.setState({ protocols: [] });
        await assert.rejects(requestGeneration(selected, "prompt"), /已删除/);
    });
    await check("custom channel protocol fetches its own model directory, never native task directory", async () => {
        const channel = { ...imageChannel, baseUrl: "https://custom-relay.invalid", protocolId: "saved-custom" };
        let calls = 0;
        axios.defaults.adapter = async (req) => {
            calls++; assert.equal(req.url, "https://custom-relay.invalid/v1/models"); assert.equal(req.headers.Authorization, "Bearer test-image-key");
            return response(req, { data: [{ id: "custom-image", capabilities: ["image"] }] });
        };
        assert.deepEqual(await fetchChannelModelDetails(channel), [{ name: "custom-image", capability: "image" }]); assert.equal(calls, 1);
    });
    await check("image create + pending/running/unknown/done, ID persistence, URL filtering", async () => {
        const id = "img / encoded"; const states = ["pending", "running", "future-state", "done"]; let creates = 0, polls = 0;
        axios.defaults.adapter = async (req) => {
            assert.equal(req.headers.Authorization, "Bearer test-image-key");
            assert.notEqual(req.headers.Authorization, "Bearer test-text-key");
            if (req.method === "post") {
                creates++; assert.equal(req.url, `${RELAY_TASK_URL}/v1/tasks`);
                assert.match(String(req.headers["Idempotency-Key"]), /^[a-f0-9-]{36}$/i);
                assert.deepEqual(JSON.parse(req.data).input, { prompt: "系统要求\n画一只猫", n: 2, size: "2048x2048", quality: "high" });
                return response(req, { id, status: "pending" }, 202);
            }
            assert.equal(req.url, `${RELAY_TASK_URL}/v1/tasks/${encodeURIComponent(id)}`);
            assert.equal((await relayTasks.getItem<RelayTask>(id))?.id, id);
            return response(req, { status: states[polls++], result_urls: ["https://images.invalid/result.png", "javascript:bad", 42, "http://images.invalid/result-2.png"] });
        };
        const images = await requestGeneration(config, "画一只猫");
        assert.deepEqual(images.map((image) => image.dataUrl), ["https://images.invalid/result.png", "http://images.invalid/result-2.png"]);
        assert.equal(creates, 1); assert.equal(polls, 4); assert.deepEqual(delays, [3000, 3000, 3000, 3000]);
        assert.equal((await relayTasks.getItem<RelayTask>(id))?.status, "done");
        assert.deepEqual((await relayTasks.getItem<RelayTask>(id))?.resultUrls, images.map((image) => image.dataUrl));
        const persisted = JSON.stringify(await relayTasks.getItem(id));
        assert(!persisted.includes("test-image-key") && !persisted.includes("test-text-key"));
    });
    await check("reference edit uses native task and retains size/quality/count", async () => {
        let submitted = false;
        axios.defaults.adapter = async (req) => {
            assert.equal(req.headers.Authorization, "Bearer test-image-key");
            if (req.method === "post") {
                const body = JSON.parse(req.data); assert.equal(body.kind, "image"); assert.equal(body.model, "same-model");
                assert.deepEqual(body.input.image_urls, ["data:image/png;base64,AA=="]);
                assert.equal(body.input.size, "2048x2048"); assert.equal(body.input.quality, "high"); assert.equal(body.input.n, 2);
                assert(body.input.prompt.includes("翻译英文")); submitted = true;
                return response(req, { id: "edit-task" }, 202);
            }
            return response(req, { status: "done", result_urls: ["https://images.invalid/edit.png"] });
        };
        const images = await requestEdit(config, "翻译英文", [{ id: "ref", name: "reference", type: "image/png", dataUrl: "data:image/png;base64,AA==" }]);
        assert(submitted); assert.equal(images[0].dataUrl, "https://images.invalid/edit.png");
    });
    await check("text Responses API uses only text key and text URL", async () => {
        let requests = 0; const deltas: string[] = [];
        globalThis.fetch = async (url, options) => {
            requests++; assert.equal(url, `${RELAY_TEXT_URL}/v1/responses`);
            const headers = options?.headers as Record<string, string>;
            assert.equal(headers.Authorization, "Bearer test-text-key");
            assert.notEqual(headers.Authorization, "Bearer test-image-key");
            const body = JSON.parse(String(options?.body)); assert.equal(body.model, "same-model"); assert.equal(body.stream, true);
            assert.deepEqual(body.input, [{ role: "system", content: "系统要求" }, { role: "user", content: "你好" }]);
            const events = [{ type: "response.output_text.delta", delta: "你" }, { type: "response.output_text.delta", delta: "好" }, { type: "response.completed", response: { output_text: "你好" } }];
            return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        };
        assert.equal(await requestImageQuestion({ ...config, model: config.textModel }, [{ role: "user", content: "你好" }], (delta) => deltas.push(delta)), "你好");
        assert.equal(requests, 1); assert.deepEqual(deltas, ["你", "你好"]);
    });
    await check("empty text Responses/Gemini/custom calls throw rather than returning success placeholder", async () => {
        for (const format of ["responses", "gemini", "script"] as const) for (const empty of ["", " \n\t"]) {
            const channel = { ...textChannel, apiFormat: format === "gemini" ? "gemini" as const : "openai" as const, models: [{ name: "same-model", capability: "text" as const, ...(format === "script" ? { script: `return ${JSON.stringify(empty)};` } : {}) }] };
            const selected = { ...config, model: config.textModel, channels: [imageChannel, channel] }, deltas: string[] = [];
            globalThis.fetch = async () => new Response(`data: ${JSON.stringify(format === "gemini" ? { candidates: [{ content: { parts: [{ text: empty }] } }] } : { type: "response.completed", response: { output_text: empty } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
            await assert.rejects(requestImageQuestion(selected, [{ role: "user", content: "分析" }], (text) => deltas.push(text)), /没有返回内容|No content returned/);
            assert.ok(!deltas.some((text) => /没有返回内容|No content returned/.test(text)), "no error placeholder emitted as answer delta");
        }
    });
    await check("model list uses each channel key, pricing classification and account-visible intersection", async () => {
        const urls: string[] = [];
        axios.defaults.adapter = async (req) => {
            urls.push(req.url!);
            if (req.url === `${RELAY_TEXT_URL}/v1/models`) {
                assert.equal(req.headers.Authorization, "Bearer test-text-key"); return response(req, { data: [{ id: "chat-visible" }] });
            }
            if (req.url === `${RELAY_TEXT_URL}/v1/pricing`) { assert.equal(req.headers.Authorization, "Bearer test-text-key"); return response(req, { data: [{ id: "chat-visible", endpoints: ["openai", "responses"] }] }); }
            assert.equal(req.headers.Authorization, "Bearer test-image-key");
            if (req.url!.endsWith("/models")) return response(req, { data: [{ id: "paint-visible" }, { id: "movie-visible" }, { id: "voice-visible", capabilities: ["audio"] }, { id: "explicit-visible", capabilities: ["image"] }, { id: "" }, { id: null }] });
            assert.equal(req.url, `${RELAY_TASK_URL}/v1/pricing`);
            return response(req, { data: [{ id: "paint-visible", endpoints: ["image"] }, { id: "movie-visible", endpoints: ["video"] }, { id: "explicit-visible", endpoints: ["video"] }, { id: "not-authorized", endpoints: ["image"] }] });
        };
        assert.deepEqual(await fetchChannelModelDetails(imageChannel), [{ name: "explicit-visible", capability: "image" }, { name: "movie-visible", capability: "video" }, { name: "paint-visible", capability: "image" }, { name: "voice-visible", capability: "audio" }]);
        assert.deepEqual(await fetchChannelModelDetails(textChannel), [{ name: "chat-visible", capability: "text" }]);
        assert.deepEqual(urls, [`${RELAY_TASK_URL}/v1/models`, `${RELAY_TASK_URL}/v1/pricing`, `${RELAY_TEXT_URL}/v1/models`, `${RELAY_TEXT_URL}/v1/pricing`]);
    });
    await check("65535 text pricing selects Chat only without Responses and preserves user bindings", async () => {
        const names = ["chat-only", "responses-capable", "explicit-script", "explicit-protocol", "neutral-unknown"];
        const channel = { ...textChannel, baseUrl: `${RELAY_TEXT_URL}/v1/`, models: [{ name: "explicit-script", capability: "text" as const, script: "return 'custom';" }, { name: "explicit-protocol", capability: "text" as const, protocolId: "user-protocol" }] };
        axios.defaults.adapter = async (req) => {
            assert.equal(req.headers.Authorization, "Bearer test-text-key");
            return response(req, { data: req.url!.endsWith("/models") ? names.map((id) => ({ id })) : names.filter((id) => id !== "neutral-unknown").map((id) => ({ id, endpoints: id === "responses-capable" ? ["openai", "responses"] : ["openai"] })) });
        };
        const models = await fetchChannelModelDetails(channel), byName = new Map(models.map((model) => [model.name, model]));
        assert.equal(byName.get("chat-only")?.script, relayChatScript);
        assert.equal(byName.get("responses-capable")?.script, undefined);
        assert.equal(byName.get("neutral-unknown")?.script, undefined);
        assert.equal(byName.get("explicit-script")?.script, "return 'custom';");
        assert.equal(byName.get("explicit-protocol")?.protocolId, "user-protocol");
        assert.equal(byName.get("explicit-protocol")?.script, undefined);
    });
    await check("65535 Chat script streams split UTF-8/CRLF SSE using only text key and supports proxy", async () => {
        const deltas: string[] = []; let requests = 0, cancelled = false;
        useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: true, proxyUrl: "http://127.0.0.1:23210" } });
        const channel = { ...textChannel, models: [{ name: "same-model", capability: "text" as const, script: relayChatScript }] };
        globalThis.fetch = async (url, options) => {
            requests++; assert.equal(url, `http://127.0.0.1:23210/${RELAY_TEXT_URL}/v1/chat/completions`);
            assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-text-key");
            const body = JSON.parse(String(options?.body)); assert.equal(body.reasoning_effort, "high"); assert.equal(body.model, "same-model"); assert.equal(body.stream, true);
            assert.deepEqual(body.messages, [{ role: "system", content: "系统要求" }, { role: "user", content: "你好" }]);
            const bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"你"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":[{"type":"text","text":"好"}]}}]}\n\ndata: [DONE]\n\n');
            let position = 0;
            return new Response(new ReadableStream({ pull(controller) { if (position < bytes.length) { controller.enqueue(bytes.slice(position, position + 7)); position += 7; } }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
        };
        try {
            assert.equal(await requestImageQuestion({ ...config, channels: [imageChannel, channel], model: config.textModel, reasoningEffort: "high" }, [{ role: "user", content: "你好" }], (text) => deltas.push(text)), "你好");
            assert.deepEqual(deltas, ["你", "你好"]); assert.equal(requests, 1); assert(cancelled);
        } finally { useConfigStore.setState({ config: { ...defaultConfig, proxyEnabled: false } }); }
    });
    await check("65535 Chat script accepts JSON fallback and surfaces HTTP/stream errors", async () => {
        const channel = { ...textChannel, models: [{ name: "same-model", capability: "text" as const, script: relayChatScript }] };
        const selected = { ...config, channels: [imageChannel, channel], model: config.textModel };
        globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "JSON result" } }] }), { headers: { "content-type": "application/json" } });
        const deltas: string[] = [];
        assert.equal(await requestImageQuestion(selected, [], (text) => deltas.push(text)), "JSON result"); assert.deepEqual(deltas, ["JSON result"]);
        globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "synthetic chat HTTP error" } }), { status: 402, headers: { "content-type": "application/json" } });
        await assert.rejects(requestImageQuestion(selected, [], () => {}), /synthetic chat HTTP error/);
        globalThis.fetch = async () => new Response('data: {"error":{"message":"synthetic chat stream error"}}\n\n', { headers: { "content-type": "text/event-stream" } });
        await assert.rejects(requestImageQuestion(selected, [], () => {}), /synthetic chat stream error/);
        globalThis.fetch = async () => new Response('data: malformed\n\n', { headers: { "content-type": "text/event-stream" } });
        await assert.rejects(requestImageQuestion(selected, [], () => {}));
    });
    await check("65535 Chat cancellation blocks preflight and interrupts active stream", async () => {
        const channel = { ...textChannel, models: [{ name: "same-model", capability: "text" as const, script: relayChatScript }] };
        const selected = { ...config, channels: [imageChannel, channel], model: config.textModel };
        const stopped = new AbortController(); stopped.abort();
        await assert.rejects(requestImageQuestion(selected, [], () => {}, { signal: stopped.signal }));
        const controller = new AbortController(); let cancelled = false;
        globalThis.fetch = async (_url, options) => {
            assert.equal(options?.signal, controller.signal);
            return new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } });
        };
        await assert.rejects(requestImageQuestion(selected, [], () => controller.abort(), { signal: controller.signal }));
        assert(cancelled);
    });
    await check("empty capability metadata falls back to pricing instead of model-name guessing", async () => {
        axios.defaults.adapter = async (req) => response(req, { data: req.url!.endsWith("/models") ? [{ id: "custom-painter", capabilities: [] }] : [{ id: "custom-painter", endpoints: ["image"] }] });
        assert.deepEqual(await fetchChannelModelDetails(imageChannel), [{ name: "custom-painter", capability: "image" }]);
    });
    await check("malformed model list is rejected instead of overwriting selection", async () => {
        axios.defaults.adapter = async (req) => response(req, { models: [] });
        await assert.rejects(fetchChannelModelDetails(imageChannel), /data 数组/);
    });
    await check("429 exponential backoff resets after successful poll", async () => {
        let polls = 0; const saved = task(); await relayTasks.setItem(saved.id, saved);
        axios.defaults.adapter = async (req) => { polls++; if (polls === 1 || polls === 2 || polls === 4) throw httpError(req, 429, "rate limit exceeded"); return response(req, { status: polls === 5 ? "done" : "running", result_urls: ["https://images.invalid/result.png"] }); };
        await waitRelayImage(saved, "test-image-key"); assert.equal(polls, 5); assert.deepEqual(delays, [3000, 6000, 12000, 3000, 6000]);
    });
    await check("failed state stops polling, shows server error and preserves ID", async () => {
        const saved = task(); await relayTasks.setItem(saved.id, saved); let polls = 0;
        axios.defaults.adapter = async (req) => { polls++; return response(req, { status: "failed", error_code: "policy_blocked", error_message: "synthetic rejection" }); };
        await assert.rejects(waitRelayImage(saved, "test-image-key"), (error: Error) => error.message.includes(saved.id) && error.message.includes("policy_blocked") && error.message.includes("synthetic rejection"));
        assert.equal(polls, 1); assert.equal((await relayTasks.getItem<RelayTask>(saved.id))?.status, "failed");
    });
    await check("402 stops immediately and keeps recoverable ID", async () => {
        const saved = task(); await relayTasks.setItem(saved.id, saved); let polls = 0;
        axios.defaults.adapter = async (req) => { polls++; throw httpError(req, 402, "余额不足测试"); };
        await assert.rejects(waitRelayImage(saved, "test-image-key"), (error: Error) => error.message.includes("余额不足测试") && error.message.includes(saved.id));
        assert.equal(polls, 1); assert(await relayTasks.getItem(saved.id));
    });
    await check("400/401/403/503 do not silently retry submission or poll", async () => {
        for (const status of [400, 401, 403, 503]) {
            let requests = 0;
            axios.defaults.adapter = async (req) => { requests++; throw httpError(req, status, `synthetic ${status}`); };
            await assert.rejects(requestRelayImage(config, "prompt", []), new RegExp(`synthetic ${status}`));
            assert.equal(requests, 1);
            const saved = task(); await relayTasks.setItem(saved.id, saved); requests = 0;
            await assert.rejects(waitRelayImage(saved, "test-image-key"), (error: Error) => error.message.includes(`synthetic ${status}`) && error.message.includes(saved.id));
            assert.equal(requests, 1); assert(await relayTasks.getItem(saved.id));
        }
    });
    await check("done without usable result URLs stops with actionable error", async () => {
        const saved = task(); await relayTasks.setItem(saved.id, saved);
        axios.defaults.adapter = async (req) => response(req, { status: "done", result_urls: [null, "javascript:bad"] });
        await assert.rejects(waitRelayImage(saved, "test-image-key"), /未返回 result_urls/);
    });
    await check("pre-submit cancellation makes no POST", async () => {
        const controller = new AbortController(); controller.abort();
        await assert.rejects(requestRelayImage(config, "prompt", [], controller.signal), (error: Error) => error.name === "AbortError");
        assert.equal(await relayTasks.length(), 0);
    });
    await check("cancel while waiting stops poll and preserves ID", async () => {
        const saved = task(); await relayTasks.setItem(saved.id, saved); const controller = new AbortController();
        const promise = waitRelayImage(saved, "test-image-key", controller.signal); controller.abort();
        await assert.rejects(promise, (error: Error) => error.name === "AbortError");
        assert(await relayTasks.getItem(saved.id));
    });
    await check("cancel in-flight poll is not treated as task failure", async () => {
        const saved = task(); await relayTasks.setItem(saved.id, saved); const controller = new AbortController(); let polls = 0;
        axios.defaults.adapter = async () => { polls++; controller.abort(); throw new axios.CanceledError("test abort"); };
        await assert.rejects(waitRelayImage(saved, "test-image-key", controller.signal), (error: Error) => error.name === "AbortError" && error.message.includes(saved.id));
        assert.equal(polls, 1); assert.equal((await relayTasks.getItem<RelayTask>(saved.id))?.status, "pending");
    });
    await check("10-minute timeout never resubmits and preserves recoverable ID", async () => {
        const saved = task(); await relayTasks.setItem(saved.id, saved); let polls = 0;
        axios.defaults.adapter = async (req) => { assert.equal(req.method, "get"); polls++; return response(req, { status: "running" }); };
        await assert.rejects(waitRelayImage(saved, "test-image-key"), (error: Error) => error.message.includes("10 分钟") && error.message.includes(saved.id) && error.message.includes("不必重新生成"));
        assert.equal(clock, 600000); assert.equal(polls, 200); assert.equal((await relayTasks.getItem<RelayTask>(saved.id))?.status, "running");
    });
    await check("missing create ID stops without retry", async () => {
        let creates = 0; axios.defaults.adapter = async (req) => { creates++; return response(req, { status: "pending" }, 202); };
        await assert.rejects(requestRelayImage(config, "prompt", []), /没有返回任务 ID/);
        assert.equal(creates, 1); assert.equal(await relayTasks.length(), 0);
    });
    await check("imageModel fallback is recorded for task recovery", async () => {
        axios.defaults.adapter = async (req) => response(req, req.method === "post" ? { id: "fallback-model" } : { status: "done", result_urls: ["https://images.invalid/result.png"] });
        await requestRelayImage({ ...config, model: "" }, "prompt", []);
        assert.equal((await relayTasks.getItem<RelayTask>("fallback-model"))?.model, "same-model");
    });
    axios.defaults.adapter = original.adapter; globalThis.fetch = original.fetch;
    const failed = results.filter((result) => !result.passed);
    console.log(`\nNative relay checks: ${results.length - failed.length}/${results.length} passed (offline mocked transport, not a live relay acceptance).`);
    if (failed.length) process.exitCode = 1;
}
main().catch((error) => { Date.now = original.now; globalThis.setTimeout = original.timeout; axios.defaults.adapter = original.adapter; globalThis.fetch = original.fetch; console.error(error); process.exitCode = 1; });
