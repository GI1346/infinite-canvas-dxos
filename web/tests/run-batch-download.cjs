const path = require("node:path");
const fs = require("node:fs");
const { build } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync(".checks", { recursive: true });
const outfile = path.resolve(".checks/batch-download.mjs");
(async () => {
await build({
    entryPoints: ["tests/batch-download.check.tsx"], bundle: true, platform: "node", format: "esm", packages: "external", outfile,
    plugins: [{ name: "offline-original-image-storage", setup(build) {
        build.onResolve({ filter: /^(?:@\/services\/image-storage|\.\.\/.*services\/image-storage)$/ }, () => ({ path: "image-storage", namespace: "offline-media" }));
        build.onLoad({ filter: /.*/, namespace: "offline-media" }, () => ({ contents: `
            export const getImageBlob = (key) => globalThis.__batchDownloadReadBlob(key);
            export async function fetchImageBlob(url) { const response = await fetch(url); if (!response.ok) throw new Error("图片读取失败"); return response.blob(); }
        `, loader: "js" }));
    } }],
});
try { execFileSync(process.execPath, ["--require", path.resolve("tests/indexeddb-storage.cjs"), outfile], { stdio: "inherit" }); }
catch { process.exitCode = 1; }
})().catch((error) => { console.error(error); process.exitCode = 1; });
