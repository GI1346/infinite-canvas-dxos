import { useState } from "react";
import { Alert, App, Button, Checkbox, Modal, Radio } from "antd";
import { Download, Eraser, RotateCcw } from "lucide-react";
import { saveAs } from "file-saver";
import type { CleanupOptions } from "@/lib/canvas/canvas-cleanup";
import { prepareCleanup, restoreCleanupBackup, type CleanupPlan } from "@/services/canvas-cleanup";

export function CanvasCleanupModal({ open, projectId, onClose, beforeOperation }: { open: boolean; projectId: string; onClose: () => void; beforeOperation: () => () => void }) {
    const { message } = App.useApp();
    const [options, setOptions] = useState<CleanupOptions>({ images: true, history: true, logs: true, assets: false, allProjects: false });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [plan, setPlan] = useState<CleanupPlan | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [backupName, setBackupName] = useState("");
    const [resume, setResume] = useState<(() => void) | null>(null);
    const patch = (value: Partial<CleanupOptions>) => setOptions((current) => ({ ...current, ...value }));
    const close = () => {
        if (busy) return;
        resume?.(); setResume(null); setPlan(null); setConfirmed(false); setError(""); onClose();
    };
    const prepare = async () => {
        setBusy(true); setError("");
        let release: (() => void) | undefined;
        try {
            release = beforeOperation();
            const next = await prepareCleanup(projectId, options);
            const name = `canvas-cleanup-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
            saveAs(next.backup, name);
            setBackupName(name); setPlan(next); setConfirmed(false); setResume(() => release);
        } catch (reason) {
            release?.(); setError(reason instanceof Error ? reason.message : String(reason));
        } finally { setBusy(false); }
    };
    const apply = async () => {
        if (!plan || !confirmed) return;
        setBusy(true); setError("");
        try { await plan.apply(); window.location.reload(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); }
    };
    const restore = async (file: File) => {
        setBusy(true); setError("");
        let release: (() => void) | undefined;
        try {
            release = beforeOperation();
            const previous = await prepareCleanup(projectId, { images: true, history: true, logs: true, assets: true, allProjects: true });
            saveAs(previous.backup, `canvas-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
            await restoreCleanupBackup(file);
            message.success("备份已恢复，正在重新载入画布"); window.location.reload();
        } catch (reason) { release?.(); setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); }
    };
    return <Modal title="画布清理工具" open={open} onCancel={close} closable={!busy} maskClosable={false} keyboard={!busy} footer={null} centered>
        <div className="space-y-4">
            <Alert type="info" showIcon title="保留 API 中转站、密钥、自定义协议和模型配置" description="不会重置软件。保留节点、连线、表格数据、提示词和生成参数。只处理本机画布数据，不删除电脑原图或中转站、WebDAV、外部 Agent 服务上的记录。" />
            {!plan ? <>
                <Radio.Group value={options.allProjects} disabled={busy} onChange={(event) => patch({ allProjects: event.target.value })} options={[{ label: "当前画布", value: false }, { label: "全部画布", value: true }]} />
                <div className="flex flex-col gap-3">
                    <Checkbox disabled={busy} checked={options.images} onChange={(event) => patch({ images: event.target.checked })}>清理输入、输出图片及缩略图（保留空节点和连线）</Checkbox>
                    <Checkbox disabled={busy} checked={options.history} onChange={(event) => patch({ history: event.target.checked })}>清理所选画布的助手对话、批次记录及错误详情</Checkbox>
                    <Checkbox disabled={busy} checked={options.logs} onChange={(event) => patch({ logs: event.target.checked })}>清理图片 / 视频工作台的全部生成历史与日志（全局）</Checkbox>
                    <Checkbox disabled={busy || !options.images} checked={options.assets} onChange={(event) => patch({ assets: event.target.checked })}>同时删除“我的素材”里的图片（全局，默认保留）</Checkbox>
                </div>
                <p className="text-xs opacity-65">仍被其他画布、保留素材或未清理的工作台历史引用的图片不会删除；视频和音频原文件不在此次清理范围。完成后会刷新页面，当前撤销 / 重做及内存日志一并释放。</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="cursor-pointer text-sm"><RotateCcw className="mr-1 inline size-4" />导入备份恢复（先备份现状）
                        <input type="file" accept=".zip" className="hidden" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void restore(file); }} />
                    </label>
                    <Button icon={<Download className="size-4" />} loading={busy} disabled={!options.images && !options.history && !options.logs} onClick={() => void prepare()}>备份并预览清理</Button>
                </div>
            </> : <>
                <Alert type="warning" showIcon title={`将释放 ${plan.imageCount} 张本地图片，移除 ${plan.recordCount} 条工作台记录`} description="画布中选定的图片内容、对话和批次记录按勾选项处理。备份已发起下载，取消不会删除数据。" />
                <div className="break-all text-xs opacity-65">备份文件：{backupName}</div>
                <Button type="text" icon={<Download className="size-4" />} disabled={busy} onClick={() => saveAs(plan.backup, backupName)}>重新下载备份</Button>
                <Checkbox disabled={busy} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>我已保存备份，确认执行以上清理</Checkbox>
                <div className="flex justify-end gap-2"><Button disabled={busy} onClick={close}>取消</Button><Button danger icon={<Eraser className="size-4" />} disabled={!confirmed} loading={busy} onClick={() => void apply()}>执行清理并刷新</Button></div>
            </>}
            {error && <Alert type="error" showIcon title="操作未完成" description={error} />}
        </div>
    </Modal>;
}
