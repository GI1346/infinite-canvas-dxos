const path = require("node:path");
const fs = require("node:fs");
const { build } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, "..")); fs.mkdirSync(".checks", { recursive: true });
const outfile = path.resolve(".checks/batch-download-ui.cjs");
(async () => {
    await build({ entryPoints: ["tests/batch-download-ui.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile, plugins: [{ name: "offline-download-io", setup(build) {
        build.onResolve({ filter: /^@\/services\/image-storage$/ }, () => ({ path: "images", namespace: "offline-download" }));
        build.onResolve({ filter: /^file-saver$/ }, () => ({ path: "save", namespace: "offline-download" }));
        build.onLoad({ filter: /.*/, namespace: "offline-download" }, (args) => ({ contents: args.path === "save" ? "export const saveAs = (blob, name) => globalThis.__downloadSave(blob, name);" : "export const getImageBlob = (key) => globalThis.__downloadBlob(key); export const fetchImageBlob = (url) => { throw new Error('Offline test refused URL: '+url); };", loader: "js" }));
    } }] });
    execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), outfile], { stdio: "inherit" });
})().catch((error) => { console.error(error); process.exitCode = 1; });
