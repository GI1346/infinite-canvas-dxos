export type AssistantDockLayout = { orbX: number; orbY: number; x: number; y: number; height: number };
export type AssistantDockViewport = { width: number; height: number };

export function clampAssistantDock(layout: AssistantDockLayout, viewport: AssistantDockViewport): AssistantDockLayout {
    const width = Math.min(420, Math.max(0, viewport.width - 16));
    const height = Math.min(Math.max(240, layout.height), Math.max(0, viewport.height - 16));
    return {
        orbX: Math.max(8, Math.min(layout.orbX, viewport.width - 64)),
        orbY: Math.max(8, Math.min(layout.orbY, viewport.height - 64)),
        x: Math.max(8, Math.min(layout.x, viewport.width - width - 8)),
        y: Math.max(8, Math.min(layout.y, viewport.height - height - 8)),
        height,
    };
}

// Re-anchor after moving the orb; a stored independent panel position must not win.
export function anchorAssistantDock(layout: AssistantDockLayout, viewport: AssistantDockViewport): AssistantDockLayout {
    const next = clampAssistantDock(layout, viewport);
    const width = Math.min(420, Math.max(0, viewport.width - 16));
    const x = next.orbX - width - 12 >= 8 ? next.orbX - width - 12 : next.orbX + 68;
    return clampAssistantDock({ ...next, x, y: next.orbY + 28 - next.height / 2 }, viewport);
}

export function moveAssistantDock(layout: AssistantDockLayout, dx: number, dy: number, mode: "orb" | "panel" | "resize", viewport: AssistantDockViewport): AssistantDockLayout {
    if (mode === "orb") return anchorAssistantDock({ ...layout, orbX: layout.orbX + dx, orbY: layout.orbY + dy }, viewport);
    if (mode === "resize") return clampAssistantDock({ ...layout, height: layout.height + dy }, viewport);
    const next = clampAssistantDock({ ...layout, x: layout.x + dx, y: layout.y + dy }, viewport);
    return clampAssistantDock({ ...next, orbX: layout.orbX + next.x - layout.x, orbY: layout.orbY + next.y - layout.y }, viewport);
}