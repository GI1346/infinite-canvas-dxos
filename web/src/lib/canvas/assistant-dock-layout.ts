export type AssistantWindow = { x: number; y: number; width: number; height: number };
export type AssistantDockLayout = { orbX: number; orbY: number; x: number; y: number; height: number; width?: number; inputHeight?: number };
export type AssistantDockViewport = { width: number; height: number };
export type AssistantResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function clampAssistantWindow(rect: AssistantWindow, viewport: AssistantDockViewport): AssistantWindow {
    const width = Math.min(Math.max(320, rect.width), Math.max(0, viewport.width - 16));
    const height = Math.min(Math.max(240, rect.height), Math.max(0, viewport.height - 16));
    return { x: Math.max(8, Math.min(rect.x, viewport.width - width - 8)), y: Math.max(8, Math.min(rect.y, viewport.height - height - 8)), width, height };
}

export function resizeAssistantWindow(rect: AssistantWindow, dx: number, dy: number, direction: AssistantResizeDirection, viewport: AssistantDockViewport): AssistantWindow {
    const west = direction.includes("w"), north = direction.includes("n");
    const width = direction.includes("e") || west ? Math.max(Math.min(320, viewport.width - 16), Math.min(rect.width + (west ? -dx : dx), west ? rect.x + rect.width - 8 : viewport.width - rect.x - 8)) : rect.width;
    const height = direction.includes("s") || north ? Math.max(Math.min(240, viewport.height - 16), Math.min(rect.height + (north ? -dy : dy), north ? rect.y + rect.height - 8 : viewport.height - rect.y - 8)) : rect.height;
    return clampAssistantWindow({ x: west ? rect.x + rect.width - width : rect.x, y: north ? rect.y + rect.height - height : rect.y, width, height }, viewport);
}

export function clampAssistantDock(layout: AssistantDockLayout, viewport: AssistantDockViewport): AssistantDockLayout {
    const rect = clampAssistantWindow({ ...layout, width: layout.width ?? 420 }, viewport);
    return { ...layout, ...rect, orbX: Math.max(8, Math.min(layout.orbX, viewport.width - 64)), orbY: Math.max(8, Math.min(layout.orbY, viewport.height - 64)) };
}

// Moving the orb moves the associated panel; resizing the panel keeps its chosen position.
export function anchorAssistantDock(layout: AssistantDockLayout, viewport: AssistantDockViewport): AssistantDockLayout {
    const next = clampAssistantDock(layout, viewport), width = next.width!;
    const x = next.orbX - width - 12 >= 8 ? next.orbX - width - 12 : next.orbX + 68;
    return clampAssistantDock({ ...next, x, y: next.orbY + 28 - next.height / 2 }, viewport);
}

export function moveAssistantDock(layout: AssistantDockLayout, dx: number, dy: number, mode: "orb" | "panel" | "resize", viewport: AssistantDockViewport): AssistantDockLayout {
    if (mode === "orb") return anchorAssistantDock({ ...layout, orbX: layout.orbX + dx, orbY: layout.orbY + dy }, viewport);
    if (mode === "resize") return clampAssistantDock({ ...layout, height: layout.height + dy }, viewport);
    const next = clampAssistantDock({ ...layout, x: layout.x + dx, y: layout.y + dy }, viewport);
    return clampAssistantDock({ ...next, orbX: layout.orbX + next.x - layout.x, orbY: layout.orbY + next.y - layout.y }, viewport);
}
