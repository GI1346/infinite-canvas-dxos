require("./channel-protocol-dom.cjs");
globalThis.AbortController = window.AbortController;
globalThis.AbortSignal = window.AbortSignal;
globalThis.Image = class {
    naturalWidth = 1001; naturalHeight = 701;
    set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this._src; }
};
for (const [key, size] of [["clientWidth", 600], ["clientHeight", 400]]) Object.defineProperty(window.HTMLElement.prototype, key, { configurable: true, get() { return this.hasAttribute("data-grid-viewport") ? size : 0; } });
