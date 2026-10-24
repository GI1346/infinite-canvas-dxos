import { wheelZoomFactor } from "@/stores/use-canvas-navigation-store";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type InfiniteCanvasProps = {
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    tool: "select" | "pan";
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onCanvasContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onConnectionCutStart?: (event: React.PointerEvent<HTMLDivElement>) => boolean;
    isCuttingConnections?: boolean;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
};

export function InfiniteCanvas({ containerRef, viewport, tool, backgroundMode = "lines", onViewportChange, onCanvasMouseDown, onCanvasDeselect, onCanvasContextMenu, onConnectionCutStart, isCuttingConnections = false, onDrop, children }: InfiniteCanvasProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const panState = useRef({
        isPanning: false,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
        startedOnBackground: false,
    });
    const spaceRef = useRef(false);
    const typingSpaceRef = useRef(false);
    const suppressClickRef = useRef(false);
    const cuttingRef = useRef(isCuttingConnections);
    cuttingRef.current = isCuttingConnections;
    const viewportRef = useRef(viewport);
    const paintedRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const committedRef = useRef(viewport);
    const callbacks = useRef({ onViewportChange, onCanvasDeselect });
    callbacks.current = { onViewportChange, onCanvasDeselect };
    const paint = (next: ViewportTransform) => {
        if (paintedRef.current) paintedRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.k})`;
        const grid = gridRef.current?.firstElementChild as HTMLElement | null;
        if (grid) grid.style.backgroundPosition = `${next.x % (48 * next.k)}px ${next.y % (48 * next.k)}px`;
    };
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useLayoutEffect(() => {
        if (panState.current.isPanning) return;
        viewportRef.current = viewport;
        committedRef.current = viewport;
        paint(viewport);
    }, [viewport]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
        },
        [],
    );

    useEffect(() => {
        const isTextEditing = (target: EventTarget | null) => {
            if (!(target instanceof Element)) return false;
            const input = target.closest("input");
            if (input instanceof HTMLInputElement) return !input.readOnly && !input.disabled && !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"].includes(input.type);
            const textarea = target.closest("textarea");
            if (textarea instanceof HTMLTextAreaElement) return !textarea.readOnly && !textarea.disabled;
            const editable = target.closest("[contenteditable]");
            return Boolean(editable && editable.getAttribute("contenteditable") !== "false");
        };
        const isCanvasKeyTarget = (target: EventTarget | null) => {
            if (!(target instanceof Element)) return true;
            if (target.closest(".ant-modal") || Array.from(document.querySelectorAll<HTMLElement>(".ant-modal-wrap")).some((modal) => getComputedStyle(modal).display !== "none")) return false; // Modal gestures still own repeats/keyup after a focused button is blurred.
            return containerRef.current?.parentElement?.contains(target) || target === document.body || target === document.documentElement || Boolean(target.closest("[data-canvas-overlay],[data-canvas-no-zoom],.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,[data-connection-create-menu]"));
        };
        const captureSpace = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation(); // Stop native button activation and other global shortcut listeners, including repeats/keyup.
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || (!spaceRef.current && !isCanvasKeyTarget(event.target))) return;
            if (!spaceRef.current && isTextEditing(event.target)) {
                typingSpaceRef.current = true; // Keep normal typing, but recognize a following Space + left drag as a pan.
                return;
            }
            captureSpace(event);
            if (spaceRef.current) return;
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            spaceRef.current = true;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            if (spaceRef.current) captureSpace(event);
            typingSpaceRef.current = false;
            spaceRef.current = false;
            setIsSpacePressed(false);
        };

        const handleBlur = () => {
            const wasPanning = panState.current.isPanning;
            spaceRef.current = false;
            typingSpaceRef.current = false;
            setIsSpacePressed(false);
            panState.current.isPanning = false;
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            const next = nextViewportRef.current || viewportRef.current;
            nextViewportRef.current = null; viewportRef.current = next; committedRef.current = next; paint(next);
            if (wasPanning) callbacks.current.onViewportChange(next);
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("blur", handleBlur);
        };
    }, [containerRef]);

    const handleWheel = (event: WheelEvent) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown") || (target?.closest("[data-canvas-no-zoom]") && !target.closest("[data-node-id]"))) return;

        if (cuttingRef.current) { event.preventDefault(); event.stopPropagation(); return; }

        event.preventDefault();
        event.stopPropagation();
        const current = nextViewportRef.current || viewportRef.current;
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        nextViewportRef.current = null;
        const delta = -event.deltaY;
        const factor = wheelZoomFactor(-delta);
        const newScale = Math.min(Math.max(current.k * factor, 0.05), 5);
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldX = (mouseX - current.x) / current.k;
        const worldY = (mouseY - current.y) / current.k;

        const next = {
            x: mouseX - worldX * newScale,
            y: mouseY - worldY * newScale,
            k: newScale,
        };
        if (panState.current.isPanning) {
            panState.current.initialX += next.x - current.x;
            panState.current.initialY += next.y - current.y;
        }
        viewportRef.current = next; committedRef.current = next; paint(next);
        onViewportChange(next);
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-canvas-overlay],.ant-modal,.ant-popover,.ant-dropdown") || (target?.closest("[data-canvas-no-zoom]") && !target.closest("[data-node-id]"))) return;
        if (target?.closest("[data-connection-create-menu]")) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const shouldPan = event.button === 1 || (event.button === 0 && (spaceRef.current || typingSpaceRef.current || (tool === "pan" && isBackgroundClick)));

        if (event.button === 0 && event.ctrlKey && !spaceRef.current && !typingSpaceRef.current && !target?.closest("input,textarea,select,button,a,[role='button'],[contenteditable]:not([contenteditable='false']),[data-node-toolbar],[data-node-handle]")) {
            if (onConnectionCutStart?.(event)) {
                event.preventDefault(); event.stopPropagation(); suppressClickRef.current = true; cuttingRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId); return;
            }
        }

        if (shouldPan) {
            if (typingSpaceRef.current) {
                spaceRef.current = true;
                setIsSpacePressed(true);
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }
            suppressClickRef.current = true;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            panState.current = {
                isPanning: true,
                startX: event.clientX,
                startY: event.clientY,
                initialX: viewportRef.current.x,
                initialY: viewportRef.current.y,
                hasMoved: false,
                startedOnBackground: isBackgroundClick,
            };
            // Cancel a focus animation immediately; pan frames remain compositor-only.
            callbacks.current.onViewportChange(viewportRef.current);
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        suppressClickRef.current = false;
        if (event.button === 0 && isBackgroundClick) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
        }
    };

    const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target instanceof Element ? event.target : null;
        if (event.defaultPrevented || target?.closest("[data-node-id],[data-connection-id],[data-canvas-overlay],[data-canvas-no-zoom],[data-connection-create-menu],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,input,textarea,select,[contenteditable]:not([contenteditable='false'])")) return;
        event.preventDefault();
        onCanvasContextMenu?.(event);
    };

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            if (!panState.current.isPanning) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            nextViewportRef.current = {
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: viewportRef.current.k,
            };
            if (frameRef.current) return;
            frameRef.current = requestAnimationFrame(() => {
                frameRef.current = null;
                const next = nextViewportRef.current;
                nextViewportRef.current = null;
                if (next) {
                    viewportRef.current = next; paint(next);
                    const previous = committedRef.current;
                    if (Math.abs(next.x - previous.x) / next.k >= 256 || Math.abs(next.y - previous.y) / next.k >= 256) { committedRef.current = next; callbacks.current.onViewportChange(next); }
                }
            });
        };

        const handlePointerUp = () => {
            if (!panState.current.isPanning) return;

            if (!panState.current.hasMoved && panState.current.startedOnBackground) {
                callbacks.current.onCanvasDeselect?.();
            }
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
            const next = nextViewportRef.current || viewportRef.current;
            nextViewportRef.current = null; viewportRef.current = next; committedRef.current = next; paint(next);
            callbacks.current.onViewportChange(next);
            panState.current.isPanning = false;
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);
            document.body.style.cursor = "";
        };
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Prevent canvas scrolling from moving the page while preserving native scrolling inside overlays and dialogs.
        const preventWheelScroll = (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest(".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown") || (target?.closest("[data-canvas-no-zoom]") && !target.closest("[data-node-id]"))) return;
            handleWheel(event);
        };
        container.addEventListener("wheel", preventWheelScroll, { passive: false, capture: true });
        return () => container.removeEventListener("wheel", preventWheelScroll, true);
    }, [containerRef, viewport, onViewportChange]);

    const activeTool = isSpacePressed ? "pan" : tool;
    const cursor = isCuttingConnections ? "crosshair" : isPanning ? "grabbing" : activeTool === "pan" ? "grab" : undefined;

    return (
        <div
            ref={containerRef}
            className="relative h-full w-full select-none overflow-clip"
            style={{ background: theme.canvas.background, cursor }}
            onPointerDownCapture={handlePointerDown}
            onMouseDownCapture={(event) => { if (panState.current.isPanning || cuttingRef.current) { event.preventDefault(); event.stopPropagation(); } }}
            onClickCapture={(event) => { if (suppressClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressClickRef.current = false; } }}
            onContextMenu={handleContextMenu}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
        >
            <div ref={gridRef} className="pointer-events-none absolute inset-0"><CanvasGrid viewport={viewport} mode={backgroundMode} /></div>
            <div
                ref={paintedRef}
                data-canvas-world
                className="absolute origin-top-left will-change-transform"
                style={{
                    transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.k})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function CanvasGrid({ viewport, mode }: { viewport: ViewportTransform; mode: CanvasBackgroundMode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    if (mode === "blank") return null;

    const gridSize = 48 * viewport.k;
    const x = viewport.x % gridSize;
    const y = viewport.y % gridSize;
    const dotSize = viewport.k < 0.12 ? 0.8 : 1.15;
    const backgroundImage =
        mode === "dots" ? `radial-gradient(circle, ${theme.canvas.dot} ${dotSize}px, transparent ${dotSize + 0.2}px)` : `linear-gradient(${theme.canvas.line} 1px, transparent 1px), linear-gradient(90deg, ${theme.canvas.line} 1px, transparent 1px)`;

    return (
        <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                backgroundImage,
                backgroundSize: `${gridSize}px ${gridSize}px`,
                backgroundPosition: `${x}px ${y}px`,
            }}
        />
    );
}
