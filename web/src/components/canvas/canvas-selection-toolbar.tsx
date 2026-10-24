import type { ReactNode } from "react";
import { Bot, Download, Group, Ungroup } from "lucide-react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

const SELECTION_PAD = 14;

export function CanvasSelectionToolbar({
    nodes,
    viewport,
    showToolbar,
    canGroup,
    canUngroup,
    onGroup,
    onUngroup,
    onGrid,
    onDownload,
    onAddToAgent,
    downloading = false,
}: {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    showToolbar: boolean;
    canGroup: boolean;
    canUngroup: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onGrid: () => void;
    onDownload?: () => void;
    onAddToAgent: () => void;
    downloading?: boolean;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (nodes.length < 2) return null;

    const bounds = nodeBounds(nodes);
    const left = viewport.x + bounds.left * viewport.k - SELECTION_PAD;
    const top = viewport.y + bounds.top * viewport.k - SELECTION_PAD;
    const width = (bounds.right - bounds.left) * viewport.k + SELECTION_PAD * 2;
    const height = (bounds.bottom - bounds.top) * viewport.k + SELECTION_PAD * 2;
    const showActions = showToolbar;

    return (
        <>
            <svg className="pointer-events-none absolute z-[65] overflow-visible" style={{ left, top, width, height }}>
                <rect
                    x={1}
                    y={1}
                    width={Math.max(width - 2, 0)}
                    height={Math.max(height - 2, 0)}
                    rx={16}
                    ry={16}
                    fill={theme.canvas.selectionFill}
                    stroke={theme.canvas.selectionStroke}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                />
            </svg>
            {showActions ? (
                <div
                    className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                    style={{ left: left + width / 2, top: top - 8, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <SelectionAction title="添加到 Agent" label="添加到 Agent" icon={<Bot className="size-4" />} onClick={onAddToAgent} />
                    <SelectionAction title="宫格布局" label="宫格布局" icon={<Group className="size-4" />} onClick={onGrid} />
                    {onDownload && nodes.some((node) => node.type === "image" || node.type === "group") ? <SelectionAction title="批量下载图片（选择目录）" label={downloading ? "打包中…" : "批量下载"} icon={<Download className="size-4" />} onClick={onDownload} disabled={downloading} /> : null}
                    {canGroup ? <SelectionAction title={t("canvas.nodeToolbar.groupTitle")} label={t("canvas.nodeToolbar.group")} icon={<Group className="size-4" />} onClick={onGroup} /> : null}
                    {canUngroup ? <SelectionAction title={t("canvas.nodeToolbar.ungroupTitle")} label={t("canvas.nodeToolbar.ungroup")} icon={<Ungroup className="size-4" />} onClick={onUngroup} /> : null}
                </div>
            ) : null}
        </>
    );
}

function SelectionAction({ title, label, icon, onClick, disabled }: { title: string; label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
    return (
        <Tooltip title={title} placement="top" mouseEnterDelay={0.2} color="#ffffff" styles={{ root: { color: "#242529", boxShadow: "0 8px 24px rgba(15,23,42,.16)", fontSize: 13, fontWeight: 500 } }}>
            <button type="button" className="group relative flex h-12 items-center whitespace-nowrap px-1.5 disabled:opacity-40" onClick={onClick} aria-label={title} disabled={disabled}>
                <span className="flex h-9 items-center gap-2 rounded-lg px-2.5 transition group-hover:bg-black/5 dark:group-hover:bg-white/10">
                    {icon}
                    <span>{label}</span>
                </span>
            </button>
        </Tooltip>
    );
}
