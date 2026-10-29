import { create } from "zustand";
import { persist } from "zustand/middleware";

import { inferMediaScale } from "@/lib/media-size";
import type { AiConfig } from "@/stores/use-config-store";

type ImageSettings = Pick<AiConfig, "size" | "quality" | "imageResolution">;
type CanvasImageSettingsStore = {
    settings: ImageSettings | null;
    remember: (settings: Pick<AiConfig, "size" | "quality">) => void;
};

export const useCanvasImageSettingsStore = create<CanvasImageSettingsStore>()(
    persist(
        (set) => ({
            settings: null,
            remember: ({ size, quality }) => set({ settings: { size, quality, imageResolution: inferMediaScale(size) } }),
        }),
        { name: "infinite-canvas:canvas_image_settings", partialize: (state) => ({ settings: state.settings }) },
    ),
);
