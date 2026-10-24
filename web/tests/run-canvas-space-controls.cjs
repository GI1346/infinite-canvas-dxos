const path = require("node:path");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
buildSync({ entryPoints: ["tests/canvas-space-controls.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile: ".checks/canvas-space-controls.cjs" });
execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), path.resolve(".checks/canvas-space-controls.cjs")], { stdio: "inherit" });