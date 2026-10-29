import axios from "axios";
import localforage from "localforage";
import { prepareRelayReferences } from "./relay-reference-images";
import { buildApiUrl, resolveModelChannel, modelOptionName, RELAY_IMAGE_URL, RELAY_TASK_URL, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export const relayTasks = localforage.createInstance({ name: "infinite-canvas", storeName: "relay_tasks" });
export type RelayTask = { id: string; channelId: string; model: string; baseUrl: string; status: string; createdAt: string; resultUrls?: string[] };
export function relayTaskBase(channel: ModelChannel) {
    if (channel.protocolId) return undefined;
    if (channel.imageTaskBaseUrl !== undefined) return channel.imageTaskBaseUrl.trim() || undefined;
    return channel.baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, "") === RELAY_IMAGE_URL ? RELAY_TASK_URL : undefined;
}
export function relayImageInput(config: AiConfig, prompt: string, references: string[]) {
    return { kind: "image", model: modelOptionName(config.model || config.imageModel), input: {
        prompt, n: Math.max(1, Math.min(15, Math.floor(Math.abs(Number(config.count)) || 1))),
        ...(config.size && config.size !== "auto" ? { size: config.size } : {}),
        ...(config.imageResolution && config.imageResolution !== "auto" ? { resolution: config.imageResolution, ...(config.size === "auto" ? { size: "auto" } : {}) } : {}),
        ...(config.quality && config.quality !== "auto" ? { quality: config.quality } : {}),
        ...(references.length ? { image_urls: references } : {}),
    } };
}
function wait(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException("已停止查询，任务 ID 已保留", "AbortError")); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) { signal.removeEventListener("abort", abort); abort(); }
    });
}
export async function waitRelayImage(task: RelayTask, apiKey: string, signal?: AbortSignal): Promise<string[]> {
    const deadline = Date.now() + 10 * 60_000;
    let delay = 3000;
    while (Date.now() < deadline) {
        await wait(Math.min(delay, deadline - Date.now()), signal);
        try {
            const { data } = await axios.get(buildApiUrl(task.baseUrl, `/tasks/${encodeURIComponent(task.id)}`), { headers: { Authorization: `Bearer ${apiKey.trim()}` }, signal, timeout: Math.max(1, deadline - Date.now()) });
            task = { ...task, status: data.status || "unknown" }; await relayTasks.setItem(task.id, task);
            if (data.status === "failed") throw new Error(`任务 ${task.id} 失败：${data.error_code || ""} ${data.error_message || ""}`);
            if (data.status === "done") {
                const urls: string[] = (Array.isArray(data.result_urls) ? data.result_urls : []).filter((u: unknown) => typeof u === "string" && /^https?:\/\//i.test(u));
                if (!urls.length) throw new Error(`任务 ${task.id} 已完成但未返回 result_urls`);
                await relayTasks.setItem(task.id, { ...task, resultUrls: urls }); return urls;
            }
            delay = 3000;
        } catch (error) {
            if (signal?.aborted) throw new DOMException(`已停止查询，任务 ID：${task.id} 已保留`, "AbortError");
            if (axios.isAxiosError(error) && error.response?.status === 429) { delay = Math.min(delay * 2, deadline - Date.now()); continue; }
            const detail = axios.isAxiosError(error) ? error.response?.data?.error?.message || error.message : error instanceof Error ? error.message : String(error);
            throw new Error(`${detail}（任务 ID：${task.id}，可在“异步任务”继续查询）`);
        }
    }
    throw new Error(`查询超过 10 分钟，任务仍可能在后台执行。任务 ID：${task.id}，请在“异步任务”继续查询，不必重新生成。`);
}
export async function requestRelayImage(config: AiConfig, prompt: string, references: string[], signal?: AbortSignal) {
    const channel = resolveModelChannel(config, config.model || config.imageModel), baseUrl = relayTaskBase(channel)!;
    if (signal?.aborted) throw new DOMException("已取消提交", "AbortError");
    const requestPrompt = [config.systemPrompt, prompt].filter(Boolean).join("\n");
    const preparedReferences = await prepareRelayReferences(references, (images) => JSON.stringify(relayImageInput(config, requestPrompt, images)), signal);
    if (signal?.aborted) throw new DOMException("已取消提交", "AbortError");
    let data;
    try {
        ({ data } = await axios.post(buildApiUrl(baseUrl, "/tasks"), relayImageInput(config, requestPrompt, preparedReferences), {
            headers: { Authorization: `Bearer ${channel.apiKey.trim()}`, "Idempotency-Key": crypto.randomUUID() }, signal, timeout: 10 * 60_000,
        }));
    } catch (error) {
        if (signal?.aborted) throw new DOMException("已取消提交", "AbortError");
        if (axios.isAxiosError(error) && error.response?.status === 413) throw new Error(`生图渠道“${channel.name}”拒绝接收：本次请求超过服务端上传限制（HTTP 413）。请减少参考图或联系中转站调整限制，未自动重复提交。`);
        if (axios.isAxiosError(error)) throw new Error(`生图渠道“${channel.name}”提交失败（HTTP ${error.response?.status || "网络错误"}）：${error.response?.data?.error?.message || error.message}`);
        throw error;
    }
    if (typeof data.id !== "string" || !data.id) throw new Error("异步接口没有返回任务 ID，未自动重复提交");
    const task: RelayTask = { id: data.id, channelId: channel.id, model: modelOptionName(config.model || config.imageModel), baseUrl, status: data.status || "pending", createdAt: new Date().toISOString() };
    await relayTasks.setItem(task.id, task);
    return waitRelayImage(task, channel.apiKey, signal);
}
