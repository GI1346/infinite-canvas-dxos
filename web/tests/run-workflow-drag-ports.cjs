const path = require("node:path");
const fs = require("node:fs");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync(".checks", { recursive: true });
const outfile = path.resolve(".checks/workflow-drag-ports.cjs");
buildSync({ entryPoints: ["tests/workflow-drag-ports.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile, alias: { "@/services/image-storage": path.resolve("tests/interaction-media-mock.ts"), "@/services/file-storage": path.resolve("tests/interaction-media-mock.ts") } });
execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), outfile], { stdio: "inherit" });
