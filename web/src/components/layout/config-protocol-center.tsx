import { App, Button, Input, Select } from "antd";
import { useState } from "react";
import { useCopyText } from "@/hooks/use-copy-text";
import { parseCallProtocols, type CallCapability, type CanvasCallProtocol } from "@/lib/canvas-call-protocol";
import { getPluginAuthoringPrompt, getPluginTemplates } from "@/services/api/model-plugin";
import { useCallProtocolStore } from "@/stores/use-call-protocol-store";
import { useConfigStore } from "@/stores/use-config-store";

function download(value: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "canvas-protocols.json"; a.click(); URL.revokeObjectURL(url);
}

export function ConfigProtocolCenter() {
    const { message } = App.useApp();
    const copy = useCopyText();
    const protocols = useCallProtocolStore((s) => s.protocols);
    const save = useCallProtocolStore((s) => s.save);
    const remove = useCallProtocolStore((s) => s.remove);
    const channels = useConfigStore((s) => s.config.channels);
    const [draft, setDraft] = useState("");
    const [capability, setCapability] = useState<CallCapability>("image");
    const [selected, setSelected] = useState("");
    const [diagnostic, setDiagnostic] = useState("");
    const guard = (fn: () => void) => { try { fn(); setDiagnostic(""); } catch (e) { setDiagnostic(e instanceof Error ? e.message : String(e)); } };
    const template = (script: string): CanvasCallProtocol => ({ format: "canvas-call/v1", id: `my-${capability}-relay`, label: "我的中转站协议", capability, script });
    const authoring = `${getPluginAuthoringPrompt(capability, "由用户选择的模型")}\n\n这是开源 infinite-canvas 的调用脚本协议，不是 DX 协议。根据附带的中转站官方 API 文档输出一个 JSON 对象：${JSON.stringify({ format: "canvas-call/v1", id: "my-relay", label: "中转站名称", capability, script: "完整可运行的异步函数体" })}。script 复用上述变量和 request/http/poll；自定义鉴权请使用 request（不自动附加 Bearer），URL 可用 baseUrl 拼接完整路径（不要猜测或重复添加 /v1）。认证从 apiKey 读取，模型从 model 读取。不要把实际密钥、真实站点配置或用户数据写进协议。异步任务按文档调用 poll 并显式配置 intervalMs/timeoutMs，失败状态抛出错误，signal 传递取消。不要生成文档没有的重试或接口。只返回 JSON，不用 Markdown。`;
    return <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <aside className="space-y-3">
            <h2 className="font-semibold">自定义中转站协议</h2>
            <p className="text-xs text-muted-foreground">复用画布原生调用脚本。地址和密钥仍在「服务商」中配置；协议可绑定到多个模型。</p>
            <Button block onClick={() => { setSelected(""); setDraft(""); setDiagnostic(""); }}>新建协议</Button>
            <label className="block"><span className="text-xs">能力类型</span><Select className="mt-1 w-full" value={capability} onChange={setCapability} options={[{ value: "image", label: "图像" }, { value: "video", label: "视频" }, { value: "text", label: "文本" }, { value: "audio", label: "音频" }]} /></label>
            {protocols.map((p) => <Button key={p.id} block type={p.id === selected ? "primary" : "text"} onClick={() => { setSelected(p.id); setCapability(p.capability); setDraft(JSON.stringify(p, null, 2)); setDiagnostic(""); }}>{p.label} · {p.capability}</Button>)}
            <Button block onClick={() => download({ format: "canvas-protocol-bundle/v1", protocols })}>导出协议（不含站点密钥）</Button>
            <label className="block cursor-pointer text-sm">导入 JSON 文件<input aria-label="导入协议" type="file" accept=".json,application/json" className="mt-1 block w-full text-xs" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { const text = await file.text(); guard(() => { const items = parseCallProtocols(text); save(items); setDraft(text); message.success(`已导入 ${items.length} 条协议`); }); } e.target.value = ""; }} /></label>
        </aside>
        <section className="min-w-0 space-y-4">
            <div className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">1. 复制规则 → 2. 附中转站 API 文档交给 AI → 3. 粘贴 JSON 保存</h3>
                <p className="mt-2 text-xs text-muted-foreground">支持自定义鉴权、Header、请求体、返回解析及异步轮询；不使用 DX 的 schema 或运行时。</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => copy(authoring)}>复制给 AI</Button>{getPluginTemplates()[capability].map((t) => <Button key={t.label} onClick={() => setDraft(JSON.stringify(template(t.script), null, 2))}>{t.label} 模板</Button>)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button onClick={() => guard(() => setDraft(JSON.stringify(JSON.parse(draft), null, 2)))}>格式化</Button>
                <Button onClick={() => guard(() => { parseCallProtocols(draft); message.success("JSON 与脚本语法通过；未发出网络请求"); })}>校验</Button>
                <Button onClick={() => copy(`${authoring}\n请修复协议，诊断：${diagnostic || "请按原始 API 文档检查字段、鉴权与返回格式"}。本报告不附协议原稿和密钥。`)}>复制 AI 修复报告</Button>
                <Button type="primary" onClick={() => guard(() => { const items = parseCallProtocols(draft); save(items); setSelected(items[0].id); message.success("协议已保存，请在服务商的模型行选择此协议"); })}>保存协议</Button>
                {selected && <Button danger onClick={() => {
                    if (channels.some((c) => c.models.some((m) => m.protocolId === selected))) { setDiagnostic("此协议仍被模型使用，请先在服务商中解除绑定再删除"); return; }
                    remove(selected); setSelected(""); setDraft("");
                }}>删除</Button>}
            </div>
            {diagnostic && <p role="alert" className="text-sm text-destructive">{diagnostic}</p>}
            <Input.TextArea aria-label="自定义协议 JSON" value={draft} onChange={(e) => setDraft(e.target.value)} rows={22} spellCheck={false} placeholder="粘贴 AI 返回的 canvas-call/v1 JSON" style={{ fontFamily: "monospace" }} />
            <p className="text-xs text-muted-foreground">保存后到「服务商 → 编辑 → 模型行」选择协议。选择“默认 / 调用脚本”可恢复原画布调用方式。保存与校验不会调用中转站。</p>
        </section>
    </div>;
}
