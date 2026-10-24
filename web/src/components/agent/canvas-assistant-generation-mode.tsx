import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasAssistantStore, type CanvasAssistantGenerationMode } from "@/stores/use-canvas-assistant-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasAssistantGenerationMode() {
    const mode = useCanvasAssistantStore((state) => state.generationMode);
    const setMode = useCanvasAssistantStore((state) => state.setGenerationMode);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <select data-assistant-generation-mode aria-label="Agent 生成模式" title="自动生成直接执行后续生成；当前待确认任务仍需手动确认。" className="max-w-28 min-w-0 rounded px-1 py-1 text-[10px]" style={{ background: theme.node.panel, color: theme.node.muted, border: `1px solid ${theme.node.stroke}` }} value={mode} onChange={(event) => setMode(event.target.value as CanvasAssistantGenerationMode)}>
        <option value="manual">手动确认生成</option>
        <option value="auto">自动生成</option>
    </select>;
}