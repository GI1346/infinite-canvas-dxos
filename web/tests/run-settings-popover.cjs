const path = require("node:path");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
const outfile = path.resolve(".checks/settings-popover.cjs");
buildSync({ entryPoints: ["tests/settings-popover.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile });
execFileSync(process.execPath, ["--require", path.resolve("tests/channel-protocol-dom.cjs"), outfile], { stdio: "inherit" });
