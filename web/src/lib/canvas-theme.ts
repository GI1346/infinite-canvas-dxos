export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#ffffff",
            dot: "rgba(68,64,60,.28)",
            line: "rgba(68,64,60,.12)",
            selectionStroke: "#1c1917",
            selectionFill: "rgba(28,25,23,.06)",
        },
        node: {
            label: "#57534e",
            fill: "#e7e5df",
            panel: "#fbfaf7",
            stroke: "#d6d3ca",
            activeStroke: "#1c1917",
            placeholder: "#8a8479",
            text: "#292524",
            muted: "#78716c",
            faint: "#a8a29e",
        },
        toolbar: {
            panel: "rgba(251,250,247,.96)",
            border: "#d6d3ca",
            item: "#57534e",
            itemHover: "#e7e5df",
            activeBg: "#e7e5df",
            activeText: "#292524",
        },
    },
    dark: {
        canvas: { background: "#161616", dot: "rgba(255,255,255,.16)", line: "rgba(255,255,255,.07)", selectionStroke: "#efefef", selectionFill: "rgba(255,255,255,.08)" },
        node: { label: "#a2a2a2", fill: "#222222", panel: "#222222", stroke: "#3a3a3a", activeStroke: "#efefef", placeholder: "#767676", text: "#efefef", muted: "#a2a2a2", faint: "#767676" },
        toolbar: { panel: "rgba(26,26,26,.97)", border: "#3a3a3a", item: "#a2a2a2", itemHover: "#2a2a2a", activeBg: "#333333", activeText: "#efefef" },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
