const path = require("node:path");
const fs = require("node:fs");
const { buildSync } = require("esbuild");
const { execFileSync } = require("node:child_process");
process.chdir(path.resolve(__dirname, ".."));
fs.mkdirSync(".checks", { recursive: true });
const files = fs.readdirSync("tests").filter((name) => name.endsWith(".test.ts"));
let failed = false;
for (const name of files) {
    const outfile = path.resolve(".checks", `${name.slice(0, -3)}.mjs`);
    try {
        buildSync({ entryPoints: [path.join("tests", name)], bundle: true, platform: "node", format: "esm", packages: "external", outfile, alias: { "bun:test": path.resolve("tests/bun-test-node-shim.ts") } });
        execFileSync(process.execPath, ["--require", path.resolve("tests/node-storage.cjs"), outfile], { stdio: "inherit" });
    } catch { failed = true; }
}
console.log(`${failed ? "FAIL" : "PASS"} existing unit suites on Node: ${files.length} files`);
if (failed) process.exitCode = 1;
