const fs = require("node:fs"), path = require("node:path");
const web = path.resolve(__dirname, ".."), root = path.resolve(web, ".."), scratch = path.join(web, ".checks/reference-compression");
fs.mkdirSync(scratch, { recursive: true });
if (!process.versions.electron) {
    const { spawnSync } = require("node:child_process");
    const env = { ...process.env, TEMP: scratch, TMP: scratch }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require(path.join(root, "desktop/node_modules/electron")), [__filename], { cwd: web, env, windowsHide: true, stdio: "inherit" });
    if (result.error) console.error(result.error);
    process.exit(result.status ?? 1);
}
const http = require("node:http"), { app, BrowserWindow } = require("electron");
const output = path.join(scratch, "browser"), profile = path.join(scratch, `profile-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile); app.setPath("logs", path.join(profile, "logs")); app.setPath("crashDumps", path.join(profile, "crashes"));
app.disableHardwareAcceleration(); app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
let server, win;
app.whenReady().then(async () => {
    const { build } = require(path.join(web, "node_modules/esbuild"));
    await build({ absWorkingDir: web, entryPoints: ["tests/relay-reference-compression.check.ts"], bundle: true, platform: "browser", format: "iife", outfile: path.join(output, "check.js"), assetNames: "[name]-[hash]", plugins: [{ name: "bundled-compression-worker", setup(build) {
        build.onResolve({ filter: /browser-image-compression\.js\?url$/ }, () => ({ path: path.join(web, "node_modules/browser-image-compression/dist/browser-image-compression.js"), namespace: "compression-worker" }));
        build.onLoad({ filter: /.*/, namespace: "compression-worker" }, (args) => ({ contents: fs.readFileSync(args.path), loader: "file" }));
    } }] });
    server = http.createServer((req, res) => {
        const name = decodeURIComponent(req.url.split("?")[0]);
        if (name === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><script src="/check.js"></script>'); return; }
        const file = path.resolve(output, `.${name}`);
        if (!file.startsWith(output + path.sep)) { res.writeHead(404); res.end(); return; }
        try { res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "application/octet-stream"); res.end(fs.readFileSync(file)); }
        catch { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`, blocked = [];
    win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        const allowed = details.url.startsWith(origin + "/") || /^(blob:|data:|devtools:)/.test(details.url);
        if (!allowed) blocked.push(details.url);
        callback({ cancel: !allowed });
    });
    await win.loadURL(origin + "/");
    const results = await win.webContents.executeJavaScript("window.compressionTestRun");
    for (const item of results) console.log(`${item.passed ? "PASS" : "FAIL"}: ${item.name}${item.detail ? "\n" + item.detail : ""}`);
    fs.writeFileSync(path.join(scratch, "results.json"), JSON.stringify({ results, blocked }, null, 2));
    console.log(`Compression checks: ${results.filter((item) => item.passed).length}/${results.length}; external requests: ${blocked.length}`);
    const passed = results.every((item) => item.passed) && blocked.length === 0;
    win.destroy(); server.close(); app.exit(passed ? 0 : 1);
}).catch((error) => { console.error(error); server?.close(); win?.destroy(); app.exit(1); });
setTimeout(() => { console.error("Compression checks timed out"); server?.close(); win?.destroy(); app.exit(1); }, 180000).unref();
