const path = require("node:path");
const fs = require("node:fs");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync(".checks", { recursive: true });
const outfile = path.resolve(".checks/llm-node.mjs");
buildSync({ entryPoints: ["tests/llm-node.check.tsx"], bundle: true, platform: "node", format: "esm", packages: "external", outfile, define: { "import.meta.env.VITE_DEV_PLUGINS": '""' } });
try { execFileSync(process.execPath, ["--require", path.resolve("tests/llm-node-dom.cjs"), outfile], { stdio: "inherit" }); }
catch { process.exitCode = 1; }
