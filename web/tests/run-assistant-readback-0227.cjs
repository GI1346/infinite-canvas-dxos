const path = require("node:path"), { buildSync } = require("esbuild"), { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
const outfile = path.resolve(".checks/assistant-readback-0227.cjs");
buildSync({ entryPoints: ["tests/assistant-readback-0227.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", alias: { "copy-to-clipboard": path.resolve("node_modules/copy-to-clipboard/dist/index.mjs") }, outfile });
execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), outfile], { stdio: "inherit" });
