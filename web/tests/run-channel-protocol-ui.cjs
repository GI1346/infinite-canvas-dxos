const path = require("node:path");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
const outfile = path.resolve(".checks/channel-protocol-ui.cjs");
buildSync({ entryPoints: ["tests/channel-protocol-ui.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile });
execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), outfile], { stdio: "inherit" });
