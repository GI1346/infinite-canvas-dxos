require("./interaction-dom.cjs");
globalThis.FileReader = window.FileReader;
globalThis.Image = window.Image;
globalThis.ShadowRoot = window.ShadowRoot;
globalThis.SVGElement = window.SVGElement;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
