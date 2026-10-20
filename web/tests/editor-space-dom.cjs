require("./channel-protocol-dom.cjs");
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 600; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 450; } });
window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 450, right: 600, bottom: 450, toJSON() {} }; };
globalThis.Image = class {
    constructor() { this.width = this.naturalWidth = 1200; this.height = this.naturalHeight = 900; }
    set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
    get src() { return this._src; }
};
window.HTMLCanvasElement.prototype.getContext = function () {
    if (this.__context) return this.__context;
    const context = { canvas: this, marks: 0, clearRect() { this.marks = 0; }, beginPath() {}, arc() {}, moveTo() {}, lineTo() {}, fill() { this.marks++; }, stroke() { this.marks++; }, drawImage() {}, fillRect() {}, getImageData() { return { data: new Uint8ClampedArray([0, 0, 0, this.marks ? 255 : 0]) }; } };
    return this.__context = context;
};
window.HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/png;base64,AA=="; };
