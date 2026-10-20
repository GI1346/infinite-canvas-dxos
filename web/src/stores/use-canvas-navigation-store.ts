import { create } from "zustand";
import { persist } from "zustand/middleware";
export const useCanvasNavigationStore = create<{ sensitivity: number; setSensitivity: (value: number) => void }>()(persist((set) => ({ sensitivity: 50, setSensitivity: (value) => set({ sensitivity: Math.max(1, Math.min(100, Math.round(value) || 1)) }) }), { name: "blinkflow:canvas-navigation" }));
export function wheelZoomFactor(delta: number, sensitivity = useCanvasNavigationStore.getState().sensitivity) { return Math.pow(1.1, -delta / 100 * sensitivity / 50); }
