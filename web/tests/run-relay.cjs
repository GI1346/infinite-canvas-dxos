const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
let failed = false;
for (const name of ["relay-native", "relay-workflow"]) {
    const outfile = `.checks/${name}.mjs`;
    try {
        buildSync({ entryPoints: [`tests/${name}.check.ts`], bundle: true, platform: "node", format: "esm", packages: "external", outfile });
        execFileSync(process.execPath, ["--require", "./tests/indexeddb-storage.cjs", outfile], { stdio: "inherit" });
    } catch { failed = true; }
}
if (failed) process.exitCode = 1;
