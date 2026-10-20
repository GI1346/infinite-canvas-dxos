import { useEffect, useRef, useState } from "react";
import { Alert, Button, Modal } from "antd";
import { relayTasks, waitRelayImage, type RelayTask } from "@/services/api/relay-tasks";
import { useConfigStore } from "@/stores/use-config-store";

export function CanvasRelayTasksModal({ open, onClose, onImages }: { open: boolean; onClose: () => void; onImages: (urls: string[], title: string) => Promise<void> }) {
    const [tasks, setTasks] = useState<RelayTask[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);
    const load = async () => { const records: RelayTask[] = []; await relayTasks.iterate<RelayTask, void>((t) => { records.push(t); }); setTasks(records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); };
    useEffect(() => { if (open) void load(); else controller.current?.abort(); }, [open]);
    useEffect(() => () => controller.current?.abort(), []);
    const resume = async (task: RelayTask) => {
        const channel = useConfigStore.getState().config.channels.find((c) => c.id === task.channelId);
        if (!channel?.apiKey.trim()) { setError("请先为任务原来的生图渠道填写 API Key；不会使用对话渠道密钥"); return; }
        setBusy(task.id); setError(""); const abort = new AbortController(); controller.current = abort;
        try { const urls = task.resultUrls?.length ? task.resultUrls : await waitRelayImage(task, channel.apiKey, abort.signal); await onImages(urls, task.model); await load(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
        finally { controller.current = null; setBusy(""); }
    };
    return <Modal title="异步生图任务" open={open} onCancel={onClose} footer={<Button disabled={Boolean(busy)} onClick={() => void load()}>刷新记录</Button>}>
        <p className="mb-3 text-sm">只查询原任务，不重复提交。关闭窗口停止本地查询，后台任务不受影响。</p>
        <div className="max-h-96 space-y-3 overflow-auto">{!tasks.length && <p>暂无异步任务记录</p>}{tasks.map((task) => <div key={task.id} className="rounded border p-3"><strong>{task.model}</strong><div className="break-all text-xs opacity-70">{task.id} · {task.status}</div><Button size="small" className="mt-2" disabled={Boolean(busy) && busy !== task.id} loading={busy === task.id} onClick={() => void resume(task)}>{task.resultUrls?.length ? "导入结果到画布" : "继续查询并导入结果"}</Button></div>)}</div>
        {busy && <Button className="mt-3" onClick={() => controller.current?.abort()}>停止查询</Button>}{error && <Alert className="mt-3" type="error" title={error} />}
    </Modal>;
}
