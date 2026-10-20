const path = require("node:path");
const fs = require("node:fs");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync(".checks", { recursive: true });
const outfile = path.resolve(".checks/protocol-center.cjs");
buildSync({ entryPoints: ["tests/protocol-center.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile });
execFileSync(process.execPath, ["--require", path.resolve("tests/interaction-dom.cjs"), outfile], { stdio: "inherit" });
