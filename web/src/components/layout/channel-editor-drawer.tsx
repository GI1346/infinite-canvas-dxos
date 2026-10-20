import { Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultBaseUrlForApiFormat, guessCapability, normalizeChannelModels, RELAY_TASK_URL, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { useCallProtocolStore } from "@/stores/use-call-protocol-store";
import { relayTaskBase } from "@/services/api/relay-tasks";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const protocols = useCallProtocolStore((s) => s.protocols);
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
    }, [open, channel]);

    if (!draft) return null;

    const protocolOptions = [
        { label: "OpenAI", value: "openai" },
        { label: "Gemini", value: "gemini" },
        { label: "65535 原生异步任务", value: "relay-native" },
        ...(draft.protocolId && !protocols.some((protocol) => protocol.id === draft.protocolId) ? [{ label: `缺失：${draft.protocolId}`, value: `protocol:${draft.protocolId}` }] : []),
        ...protocols.map((protocol) => ({ label: `${protocol.label}（${t(`config.channelEditor.capabilities.${protocol.capability}`)}）`, value: `protocol:${protocol.id}` })),
    ];
    const selectedProtocol = draft.protocolId ? `protocol:${draft.protocolId}` : relayTaskBase(draft) ? "relay-native" : draft.apiFormat;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const changeProtocol = (value: string) => {
        if (value.startsWith("protocol:")) { patch({ protocolId: value.slice("protocol:".length), apiFormat: "openai", imageTaskBaseUrl: "" }); return; }
        if (value === "relay-native") { patch({ protocolId: undefined, apiFormat: "openai", imageTaskBaseUrl: draft.imageTaskBaseUrl || RELAY_TASK_URL }); return; }
        const apiFormat = value as ApiCallFormat;
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl, protocolId: undefined, imageTaskBaseUrl: "" });
    };

    const applySelection = (names: string[], fetchedModels: ChannelModel[] = []) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => {
            const existing = map.get(name), fetched = fetchedModels.find((model) => model.name === name);
            return existing ? { ...existing, ...(!existing.script && !existing.protocolId && fetched?.script ? { script: fetched.script } : {}) } : fetched || { name, capability: guessCapability(name) };
        }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability, protocolId: undefined } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.protocol")}</span>
                    <Select aria-label="渠道调用协议" className="w-full" value={selectedProtocol} options={protocolOptions} onChange={changeProtocol} />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.baseUrl")}</span>
                    <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://api.example.com" />
                </label>
                <label className="block md:col-span-2">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="sk-..." />
                </label>
            </div>

            <p className="mt-3 text-xs opacity-60">渠道协议是模型默认调用方式；模型单独绑定的协议或脚本优先。自定义协议仅用于同能力模型，其他能力请单独绑定。</p>
            {selectedProtocol === "relay-native" && <label className="mt-4 block"><span className="mb-1 block text-sm font-medium">原生异步生图任务地址（使用当前生图渠道的独立密钥）</span><Input aria-label="原生异步任务地址" value={draft.imageTaskBaseUrl || ""} placeholder={RELAY_TASK_URL} onChange={(event) => patch({ imageTaskBaseUrl: event.target.value })} /></label>}
            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Select aria-label={`${model.name} 模型协议`} size="small" style={{ width: 170 }} placeholder={model.script ? "使用模型调用脚本" : "继承渠道协议"} allowClear value={model.protocolId} options={[...(model.protocolId && !protocols.some((p) => p.id === model.protocolId) ? [{ value: model.protocolId, label: `缺失：${model.protocolId}` }] : []), ...protocols.filter((p) => p.capability === model.capability).map((p) => ({ value: p.id, label: p.label }))]} onChange={(protocolId) => setModels(draft.models.map((m) => m.name === model.name ? { ...m, protocolId } : m))} />
                                <Button size="small" disabled={Boolean(model.protocolId)} type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
