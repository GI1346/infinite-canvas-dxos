require("./channel-protocol-dom.cjs");

globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 600; } });
Object.defineProperty(window.HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 450; } });
window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 600, height: 450, right: 600, bottom: 450, toJSON() {} }; };

// A command-recording 2D mock: tests assert real renderer commands, not browser rasterization.
window.HTMLCanvasElement.prototype.getContext = function () {
    if (this.__paintContext) return this.__paintContext;
    const saved = [], context = {
        canvas: this, rendered: [], path: [], globalCompositeOperation: "source-over", globalAlpha: 1,
        strokeStyle: "#000000", fillStyle: "#000000", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
        font: "10px sans-serif", textAlign: "start", textBaseline: "alphabetic",
        state() { return Object.fromEntries(["globalCompositeOperation", "globalAlpha", "strokeStyle", "fillStyle", "lineWidth", "lineCap", "lineJoin", "font", "textAlign", "textBaseline"].map((key) => [key, this[key]])); },
        save() { saved.push(this.state()); }, restore() { Object.assign(this, saved.pop()); },
        clearRect() { this.rendered = []; }, beginPath() { this.path = []; },
        moveTo(...args) { this.path.push(["moveTo", ...args]); }, lineTo(...args) { this.path.push(["lineTo", ...args]); },
        arc(...args) { this.path.push(["arc", ...args]); }, ellipse(...args) { this.path.push(["ellipse", ...args]); }, closePath() { this.path.push(["closePath"]); },
        fill() { this.rendered.push({ op: "fill", path: structuredClone(this.path), ...this.state() }); },
        stroke() { this.rendered.push({ op: "stroke", path: structuredClone(this.path), ...this.state() }); },
        strokeRect(...args) { this.rendered.push({ op: "strokeRect", args, ...this.state() }); },
        fillText(...args) { this.rendered.push({ op: "fillText", args, ...this.state() }); },
        drawImage(source, ...args) { this.rendered.push({ op: "drawImage", source: source instanceof window.HTMLCanvasElement ? "layer" : source.src, args, layer: source instanceof window.HTMLCanvasElement ? structuredClone(source.getContext("2d").rendered) : undefined }); },
    };
    return this.__paintContext = context;
};
window.HTMLCanvasElement.prototype.toDataURL = function (mime) { return `data:${mime};base64,${Buffer.from(JSON.stringify({ width: this.width, height: this.height, commands: this.getContext("2d").rendered })).toString("base64")}`; };
globalThis.__paintNetworkCalls = 0;
globalThis.fetch = async () => { globalThis.__paintNetworkCalls++; throw new Error("Unexpected network call in local image tools"); };
