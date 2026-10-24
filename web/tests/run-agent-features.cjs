const path = require("node:path");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
const bun = process.env.BLINKFLOW_BUN || "D:\\codex\\beeftv-build-tools\\bun\\bun-windows-x64\\bun.exe";
for (const suite of ["canvas-assistant", "canvas-assistant-skills", "local-fusion", "workflow-agent-execution"]) {
    execFileSync(bun, ["--preload", "./tests/interaction-dom.cjs", `./tests/${suite}.check.tsx`], { stdio: "inherit" });
}
