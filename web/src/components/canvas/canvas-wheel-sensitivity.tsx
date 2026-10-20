import { useCanvasNavigationStore } from "@/stores/use-canvas-navigation-store";
export function CanvasWheelSensitivity() {
 const { sensitivity, setSensitivity } = useCanvasNavigationStore();
 return <label data-canvas-overlay data-canvas-no-zoom className="flex items-center justify-between gap-4 border-t pt-3" onPointerDown={(event) => event.stopPropagation()}>
 <span>滚轮缩放灵敏度</span><input aria-label="滚轮缩放灵敏度" type="range" min={1} max={100} value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} /><input aria-label="滚轮缩放灵敏度数值" className="w-16 rounded border px-2" type="number" min={1} max={100} value={sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} /></label>;
}
