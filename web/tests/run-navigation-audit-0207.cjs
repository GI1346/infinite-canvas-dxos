const { buildSync } = require("esbuild"), { execFileSync } = require("child_process"), path = require("path");
process.chdir(path.resolve(__dirname, ".."));
buildSync({ entryPoints: ["tests/navigation-audit-0207.check.tsx"], bundle: true, platform: "node", format: "cjs", packages: "external", outfile: ".checks/navigation-audit-0207.cjs" });
execFileSync(process.execPath, ["--require", "./tests/channel-protocol-dom.cjs", ".checks/navigation-audit-0207.cjs"], { stdio: "inherit" });
