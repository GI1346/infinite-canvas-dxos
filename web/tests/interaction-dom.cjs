const { JSDOM } = require("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/", pretendToBeVisual: true });
for (const key of ["window", "document", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "Event", "MouseEvent", "KeyboardEvent", "WheelEvent", "localStorage", "getComputedStyle"]) {
    Object.defineProperty(globalThis, key, { value: key === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key], configurable: true });
}
class PointerEvent extends dom.window.MouseEvent {
    constructor(type, options = {}) { super(type, options); Object.defineProperty(this, "pointerId", { value: options.pointerId || 1 }); }
}
globalThis.PointerEvent = dom.window.PointerEvent = PointerEvent;
dom.window.HTMLElement.prototype.setPointerCapture = function (id) { this.__capturedPointerId = id; };
dom.window.HTMLElement.prototype.releasePointerCapture = function () {};
dom.window.HTMLElement.prototype.hasPointerCapture = function (id) { return this.__capturedPointerId === id; };
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
require("fake-indexeddb/auto");
