import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A small Harness-only preference; never copy channel credentials or model lists. */
export const useHarnessModelStore = create<{ imageModel: string; setImageModel: (imageModel: string) => void }>()(
    persist((set) => ({ imageModel: "", setImageModel: (imageModel) => set({ imageModel }) }), {
        name: "blinkflow_harness_image_model",
        partialize: ({ imageModel }) => ({ imageModel }),
    }),
);
