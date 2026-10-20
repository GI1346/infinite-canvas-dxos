const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
for (const name of ["canvas-cleanup", "cleanup-storage"]) {
    const outfile = `.checks/${name}.mjs`;
    buildSync({ entryPoints: [`tests/${name}.check.ts`], bundle: true, platform: "node", format: "esm", packages: "external", outfile });
    execFileSync(process.execPath, ["--require", "./tests/indexeddb-storage.cjs", outfile], { stdio: "inherit" });
}
