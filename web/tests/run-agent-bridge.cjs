const path = require("node:path");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
const bun = process.env.BLINKFLOW_BUN || "D:\\codex\\beeftv-build-tools\\bun\\bun-windows-x64\\bun.exe";
execFileSync(bun, ["--preload", "./tests/interaction-dom.cjs", "./tests/canvas-agent-bridge.check.tsx"], { stdio: "inherit" });
