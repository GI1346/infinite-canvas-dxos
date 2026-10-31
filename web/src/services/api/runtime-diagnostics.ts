import axios from "axios";
import { configureDiagnosticSecrets, recordDiagnostic, type DiagnosticContext } from "@/services/diagnostics";
import { useConfigStore } from "@/stores/use-config-store";

let installed = false;
function apiDetail(data: unknown): string {
    if (!data || typeof data !== "object") return "";
    const value = data as { error?: { message?: unknown }; message?: unknown; detail?: unknown; error_message?: unknown };
    const message = value.error?.message || value.message || value.detail || value.error_message;
    return typeof message === "string" ? message : "";
}
export function installRuntimeDiagnostics() {
    if (installed) return;
    installed = true;
    configureDiagnosticSecrets(() => {
        const { config, webdav } = useConfigStore.getState();
        return [config.apiKey, ...config.channels.map((channel) => channel.apiKey), webdav.password, localStorage.getItem("canvas-agent-token") || ""].map((value) => value.trim()).filter(Boolean);
    });
    axios.interceptors.response.use((response) => response, (error) => {
        if (!axios.isCancel(error)) recordDiagnostic("HTTP 请求", new Error(apiDetail(error.response?.data) || error.message || "网络请求失败"), {
            url: error.config?.url, method: error.config?.method, status: error.response?.status, code: error.code,
        });
        return Promise.reject(error);
    });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method || (input instanceof Request ? input.method : "GET");
        const context: DiagnosticContext = { url, method };
        try {
            const response = await original(input, init);
            if (!response.ok) {
                recordDiagnostic("HTTP 请求", `HTTP ${response.status} ${response.statusText}`, { ...context, status: response.status });
            }
            return response;
        } catch (error) { recordDiagnostic("网络请求", error, context); throw error; }
    };
    window.addEventListener("error", (event) => {
        if (event instanceof ErrorEvent) recordDiagnostic("程序异常", event.error || event.message, { url: event.filename });
    });
    window.addEventListener("unhandledrejection", (event) => recordDiagnostic("未处理异常", event.reason));
}
