import type { MouseEvent } from "react";

export function stopWorkflowControlDrag(event: MouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-node-drag-handle]")) return;
    if (target?.closest("input,textarea,select,button,a,label,table,[contenteditable]:not([contenteditable='false']),[data-node-no-drag]")) { event.stopPropagation(); return; }
    for (let element = target as HTMLElement | null; element && element !== event.currentTarget; element = element.parentElement) {
        if (element.hasAttribute("data-node-scroll") && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)) { event.stopPropagation(); return; }
    }
}
