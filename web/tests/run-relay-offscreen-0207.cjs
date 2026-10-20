const path = require("node:path");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
buildSync({ entryPoints: ["tests/relay-offscreen-0207.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile: ".checks/relay-offscreen-0207.cjs", alias: { "@/services/image-storage": path.resolve("tests/interaction-media-mock.ts"), "@/services/file-storage": path.resolve("tests/interaction-media-mock.ts") } });
execFileSync(process.execPath, ["--require", "./tests/interaction-dom.cjs", ".checks/relay-offscreen-0207.cjs"], { stdio: "inherit" });
