import { useState } from "react";
import { Alert, Button, Checkbox, Modal, Radio } from "antd";
import { Eraser } from "lucide-react";
import type { CleanupOptions } from "@/lib/canvas/canvas-cleanup";
import { prepareCleanup } from "@/services/canvas-cleanup";

export function CanvasCleanupModal({ open, projectId, onClose, beforeOperation }: { open: boolean; projectId: string; onClose: () => void; beforeOperation: () => () => void }) {
    const [options, setOptions] = useState<CleanupOptions>({ images: true, history: true, logs: true, diagnostics: false, assets: false, allProjects: false });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const patch = (value: Partial<CleanupOptions>) => setOptions((current) => ({ ...current, ...value }));
    const close = () => {
        if (busy) return;
        setError(""); onClose();
    };
    const prepare = async () => {
        setBusy(true); setError("");
        let release: (() => void) | undefined;
        try {
            release = beforeOperation();
            const next = await prepareCleanup(projectId, options, false);
            await next.apply(); window.location.reload();
        } catch (reason) {
            release?.(); setError(reason instanceof Error ? reason.message : String(reason));
        } finally { setBusy(false); }
    };
    return <Modal title="画布清理工具" open={open} onCancel={close} closable={!busy} maskClosable={false} keyboard={!busy} footer={null} centered>
        <div className="space-y-4">
            <Alert type="info" showIcon title="保留 API 中转站、密钥、自定义协议和模型配置" description="不会重置软件。保留节点、连线、表格数据、提示词和生成参数。只处理本机画布数据，不删除电脑原图或中转站、WebDAV、外部 Agent 服务上的记录。" />
            <>
                <Radio.Group value={options.allProjects} disabled={busy} onChange={(event) => patch({ allProjects: event.target.value })} options={[{ label: "当前画布", value: false }, { label: "全部画布", value: true }]} />
                <div className="flex flex-col gap-3">
                    <Checkbox disabled={busy} checked={options.images} onChange={(event) => patch({ images: event.target.checked })}>清理输入、输出图片及缩略图（保留空节点和连线）</Checkbox>
                    <Checkbox disabled={busy} checked={options.history} onChange={(event) => patch({ history: event.target.checked })}>清理所选画布的助手对话、批次记录及错误详情</Checkbox>
                    <Checkbox disabled={busy} checked={options.logs} onChange={(event) => patch({ logs: event.target.checked })}>清理图片 / 视频工作台的全部生成历史与日志（全局）</Checkbox>
                    <Checkbox disabled={busy} checked={Boolean(options.diagnostics)} onChange={(event) => patch({ diagnostics: event.target.checked })}>清理错误日志（全局，不删除图片、生成历史和配置）</Checkbox>
                    <Checkbox disabled={busy || !options.images} checked={options.assets} onChange={(event) => patch({ assets: event.target.checked })}>同时删除“我的素材”里的图片（全局，默认保留）</Checkbox>
                </div>
                <p className="text-xs opacity-65">仍被其他画布、保留素材或未清理的工作台历史引用的图片不会删除；视频和音频原文件不在此次清理范围。完成后会刷新页面，当前撤销 / 重做及内存日志一并释放。</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button danger icon={<Eraser className="size-4" />} loading={busy} disabled={!options.images && !options.history && !options.logs && !options.diagnostics} onClick={() => void prepare()}>直接清理并刷新</Button>
                </div>
            </>
            {error && <Alert type="error" showIcon title="操作未完成" description={error} />}
        </div>
    </Modal>;
}
