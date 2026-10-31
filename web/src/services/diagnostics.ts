import localforage from "localforage";
import { nanoid } from "nanoid";

export type DiagnosticContext = { projectId?: string; nodeId?: string; model?: string; url?: string; method?: string; status?: number; code?: string };
export type DiagnosticLog = DiagnosticContext & { id: string; time: string; source: string; message: string; stack?: string };
export const diagnosticStoreName = "diagnostic_logs";
const db = localforage.createInstance({ name: "infinite-canvas", storeName: diagnosticStoreName });
let secrets = (): string[] => [];
let queue: Promise<unknown> = Promise.resolve();
let revision = 0, storageError = "";
const listeners = new Set<() => void>();
const changed = () => { revision++; listeners.forEach((listener) => listener()); };
export const subscribeDiagnostics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const diagnosticRevision = () => revision;
export const diagnosticStorageError = () => storageError;
export const configureDiagnosticSecrets = (getSecrets: () => string[]) => { secrets = getSecrets; };

export function redactDiagnostic(value: string): string {
    let text = value;
    try { for (const secret of secrets().filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[已隐藏]"); } catch { return "错误信息脱敏失败，未保存原文"; }
    return text.replace(/data:[^\s"'<>]+/gi, "[图片内容已隐藏]")
        .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => { try { const url = new URL(raw); return url.origin + url.pathname; } catch { return "[地址已隐藏]"; } })
        .replace(/\bBearer\s+[^\s,;"'<>]+/gi, "Bearer [已隐藏]")
        .replace(/\bsk-[a-z\d_-]+/gi, "[已隐藏]")
        .replace(/(["']?(?:api[_-]?key|access[_-]?token|connect[_-]?token|authorization|password|secret|token)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, "$1[已隐藏]");
}

export function recordDiagnostic(source: string, error: unknown, context: DiagnosticContext = {}) {
    if (error && typeof error === "object" && ["AbortError", "CanceledError"].includes(String((error as Error).name))) return;
    const value = error instanceof Error ? error.message : typeof error === "string" ? error : "未知错误（未记录请求正文）";
    const entry: DiagnosticLog = {
        id: nanoid(), time: new Date().toISOString(), source: redactDiagnostic(source), message: redactDiagnostic(value),
        ...(error instanceof Error && error.stack ? { stack: redactDiagnostic(error.stack) } : {}),
        ...Object.fromEntries(Object.entries(context).filter(([key]) => ["projectId", "nodeId", "model", "url", "method", "status", "code"].includes(key)).map(([key, value]) => [key, typeof value === "string" ? redactDiagnostic(key === "url" ? value.split(/[?#]/)[0] : value) : value])),
    };
    // Individual IndexedDB records, no canvas subscription or per-frame work; a failed write never fails the user's task.
    queue = queue.then(() => db.setItem(entry.id, entry)).then(() => { storageError = ""; changed(); }).catch(() => { storageError = "错误日志保存失败，请检查本地存储空间"; changed(); });
}
export async function flushDiagnosticLogs() { await queue; }
export async function readDiagnosticLogs(): Promise<DiagnosticLog[]> {
    await flushDiagnosticLogs();
    const entries: DiagnosticLog[] = [];
    await db.iterate<DiagnosticLog, void>((entry) => { entries.push(entry); });
    return entries.sort((a, b) => b.time.localeCompare(a.time));
}
export function diagnosticText(entry: DiagnosticLog) {
    const { id: _id, stack, ...details } = entry;
    return redactDiagnostic(JSON.stringify(details, null, 2) + (stack ? "\n" + stack : ""));
}
