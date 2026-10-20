import { Alert, Button, Progress, Spin } from "antd";
import type { TFunction } from "i18next";
import { Database, HardDrive, Layers3, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { readLocalStorageUsage, type LocalStorageUsage } from "@/services/local-storage-usage";
import type { DesktopStorageInfo } from "@/services/desktop-storage";

const storeLabelKeys: Record<string, string> = {
    app_state: "appState",
    image_files: "images",
    image_previews: "imagePreviews",
    media_files: "media",
    image_generation_logs: "imageLogs",
    video_generation_logs: "videoLogs",
    agent_chat_messages: "agentMessages",
    prompt_cache: "promptCache",
};

export function ConfigLocalStorage({ active }: { active: boolean }) {
    const { t } = useTranslation();
    const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [desktop, setDesktop] = useState<DesktopStorageInfo | null>(null);
    const [storageError, setStorageError] = useState("");
    const [clearing, setClearing] = useState(false);

    useEffect(() => {
        if (active && window.blinkflowStorage) {
            void window.blinkflowStorage.info().then(setDesktop).catch((reason) => setStorageError(String(reason)));
        }
    }, [active]);

    const clearStorage = async () => {
        setClearing(true);
        setStorageError("");
        try { await window.blinkflowStorage?.clear(); }
        catch (reason) { setStorageError(reason instanceof Error ? reason.message : String(reason)); }
        finally { setClearing(false); }
    };

    const refresh = useCallback(async () => {
        setLoading(true);
        setError("");
        try {
            setUsage(await readLocalStorageUsage());
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("config.localStorage.readFailed"));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (active && !usage) void refresh();
    }, [active, refresh, usage]);

    const indexedDbBytes = usage?.contentBytes ?? 0;
    const percent = usage?.quota ? Math.min(100, (usage.usage / usage.quota) * 100) : 0;

    return (
        <div className="space-y-3">
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4" />存储位置与清理</div>
                {desktop ? <>
                    <div className="mt-3 text-xs text-stone-500">程序安装目录</div>
                    <div className="mt-1 break-all font-mono text-xs select-text">{desktop.installDirectory}</div>
                    <div className="mt-3 text-xs text-stone-500">数据目录（跟随安装位置）</div>
                    <div className="mt-1 break-all font-mono text-xs select-text">{desktop.dataDirectory}</div>
                    <p className="mt-3 text-xs text-stone-500">画布、图片、素材、历史、日志、配置、缓存、临时文件及应用内下载都存放于此。已有桌面版数据仅首次迁移，以后打开不重复迁移；不会搬动外部原文件或其他服务的数据。</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button onClick={() => { void window.blinkflowStorage?.open().catch((reason) => setStorageError(String(reason))); }}>打开数据目录</Button>
                        <Button danger loading={clearing} onClick={() => void clearStorage()}>清除其他数据，保留 API 配置</Button>
                    </div>
                    <p className="mt-2 text-xs text-stone-500">清理将删除全部画布、图片、历史、日志、缓存和数据目录内下载等，直接清除、不做备份，并重启。渠道、独立密钥、模型绑定、自定义协议及 Agent 连接凭据保留。</p>
                </> : <p className="mt-3 text-xs text-stone-500">{window.blinkflowStorage ? "正在读取桌面存储路径…" : "当前是浏览器版，数据由浏览器管理；安装后的桌面版会将数据放在所选安装目录内，并提供保留 API 配置的清理工具。"}</p>}
                {storageError ? <Alert className="mt-3" type="error" showIcon title="存储操作失败" description={storageError} /> : null}
            </section>
            <section className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <Database className="size-4" />
                            {t("config.localStorage.title")}
                        </div>
                        <div className="mt-1 text-xs text-stone-500">{t("config.localStorage.description")}</div>
                    </div>
                    <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={() => void refresh()}>
                        {t("config.localStorage.refresh")}
                    </Button>
                </div>
                {error ? <Alert className="mt-4" type="error" showIcon message={t("config.localStorage.readFailed")} description={error} /> : null}
                {!usage && loading ? (
                    <div className="flex min-h-48 items-center justify-center"><Spin /></div>
                ) : usage ? (
                    <>
                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <StorageMetric icon={<Database className="size-4" />} label={t("config.localStorage.indexedDbUsage")} value={formatStorageBytes(indexedDbBytes)} hint={t("config.localStorage.contentEstimate")} />
                            <StorageMetric icon={<HardDrive className="size-4" />} label={t("config.localStorage.siteUsage")} value={formatStorageBytes(usage.usage)} hint={t("config.localStorage.siteUsageHint")} />
                            <StorageMetric icon={<Layers3 className="size-4" />} label={t("config.localStorage.quota")} value={formatStorageBytes(usage.quota)} hint={usage.quota ? t("config.localStorage.quotaHint") : t("config.localStorage.quotaUnavailable")} />
                        </div>
                        {usage.quota ? (
                            <div className="mt-4">
                                <div className="mb-1 flex justify-between text-xs text-stone-500">
                                    <span>{t("config.localStorage.quotaProgress")}</span>
                                    <span className="tabular-nums">{percent.toFixed(2)}%</span>
                                </div>
                                <Progress percent={percent} showInfo={false} />
                            </div>
                        ) : null}
                    </>
                ) : null}
            </section>
            {usage?.databases.map((database) => (
                <section key={database.name} className="overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{t("config.localStorage.mainDatabase")}</div>
                            <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{database.name} · v{database.version}</div>
                        </div>
                        <div className="shrink-0 text-sm font-medium tabular-nums">{formatStorageBytes(database.bytes)}</div>
                    </div>
                    <div className="divide-y divide-stone-200 dark:divide-stone-800">
                        {database.stores.map((store) => (
                            <div key={store.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate font-medium">{storeLabel(store.name, t)}</div>
                                    <div className="mt-0.5 truncate font-mono text-[11px] text-stone-500">{store.name}</div>
                                </div>
                                <div className="text-right text-xs text-stone-500 tabular-nums">{t("config.localStorage.records", { count: store.records })}</div>
                                <div className="w-20 text-right font-medium tabular-nums">{formatStorageBytes(store.bytes)}</div>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function StorageMetric({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg bg-stone-100/70 p-3 dark:bg-stone-900/70">
            <div className="flex items-center gap-2 text-xs text-stone-500">{icon}{label}</div>
            <div className="mt-2 text-xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 text-[11px] text-stone-500">{hint}</div>
        </div>
    );
}

function storeLabel(name: string, t: TFunction) {
    const key = storeLabelKeys[name];
    return key ? t(`config.localStorage.stores.${key}`) : name;
}

function formatStorageBytes(bytes: number | null) {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
