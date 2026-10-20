const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
// Keep the existing profile when changing the visible product brand.
app.setPath('userData', path.join(app.getPath('appData'), 'Infinite Canvas DXOS'));
const root = path.join(__dirname, 'web');
const mime = { '.html': 'text/html; charset=utf-8', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let server;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    // Stable loopback origin preserves IndexedDB/localforage across restarts and upgrades.
    server = http.createServer((req, res) => {
      try {
        const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        const target = path.resolve(root, '.' + name);
        if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
        const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
        res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        fs.createReadStream(file).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
      } catch { res.writeHead(400); res.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(17456, '127.0.0.1', resolve); });
    const win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 650, title: 'BlinkFlow', icon: path.join(__dirname, 'assets', 'blinkflow.ico'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== 'http://127.0.0.1:17456') { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
    await win.loadURL('http://127.0.0.1:17456');
    win.setMenuBarVisibility(false);
  }).catch((error) => { dialog.showErrorBox('启动失败', String(error.message || error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => server?.close());
}
