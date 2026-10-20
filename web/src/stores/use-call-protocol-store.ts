import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import localforage from "localforage";
import { validateCallProtocol, type CanvasCallProtocol } from "@/lib/canvas-call-protocol";

const db = localforage.createInstance({ name: "infinite-canvas", storeName: "call_protocols" });
export const useCallProtocolStore = create<{
    protocols: CanvasCallProtocol[];
    save: (items: CanvasCallProtocol[]) => void;
    remove: (id: string) => void;
}>()(persist((set) => ({
    protocols: [],
    save: (items) => {
        const validated = items.map(validateCallProtocol);
        set((s) => ({ protocols: [...s.protocols.filter((p) => !validated.some((v) => v.id === p.id)), ...validated] }));
    },
    remove: (id) => set((s) => ({ protocols: s.protocols.filter((p) => p.id !== id) })),
}), { name: "canvas-call-protocols-v1", storage: createJSONStorage(() => db) }));
