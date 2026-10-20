const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { restoreApi, snapshotApi } = require('../storage-renderer.cjs');
const fixture = path.resolve(__dirname, '../../.checks/main-storage-runtime');
const phase = process.argv[2];
fs.mkdirSync(path.join(fixture, 'web'), { recursive: true });
fs.mkdirSync(path.join(fixture, 'mock-appdata'), { recursive: true });
app.setPath('appData', path.join(fixture, 'mock-appdata'));
for (const name of ['main.cjs', 'preload.cjs', 'storage.cjs', 'storage-renderer.cjs']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(fixture, name));
fs.writeFileSync(path.join(fixture, 'web', 'index.html'), '<!doctype html><meta charset="utf-8"><p>Isolated main-process acceptance</p>');
dialog.showErrorBox = (title, message) => { fs.writeFileSync(path.join(fixture, 'error'), title + ': ' + message); app.exit(1); };
dialog.showMessageBox = async () => ({ response: 1 });
app.relaunch = () => {};
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.on('did-finish-load', async () => {
    if (new URL(win.webContents.getURL()).pathname !== '/') return;
    try {
      const info = await win.webContents.executeJavaScript('window.blinkflowStorage.info()');
      assert.equal(info.installDirectory, fixture);
      assert.equal(info.dataDirectory, path.join(fixture, 'BlinkFlowData'));
      assert.equal(app.getPath('userData'), path.join(info.dataDirectory, 'Profile'));
      assert.equal(app.getPath('sessionData'), app.getPath('userData'));
      if (phase === 'seed') {
        const config = JSON.stringify({ state: { config: { channels: [{ id: 'image', apiKey: 'fake-image' }, { id: 'text', apiKey: 'fake-text' }] } }, version: 0 });
        await win.webContents.executeJavaScript(`(${restoreApi.toString()})(${JSON.stringify({ version: 1, local: [['infinite-canvas:ai_config_store', config]], protocols: [['canvas-call-protocols-v1', 'fake-protocol']] })})`);
        await win.webContents.executeJavaScript(`localStorage.setItem('history', 'delete-me')`);
        fs.writeFileSync(path.join(info.dataDirectory, 'Downloads', 'delete-me'), 'test');
        // Actual Blob download through the real production will-download handler.
        await win.webContents.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['download-test'])); a.download = '验收图片.txt'; a.click(); })()`);
        await new Promise((resolve, reject) => {
          const timer = setInterval(() => { if (fs.existsSync(path.join(info.dataDirectory, 'Downloads', '验收图片.txt'))) { clearInterval(timer); resolve(); } }, 20);
          setTimeout(() => { clearInterval(timer); reject(new Error('download acceptance timed out')); }, 5000).unref();
        });
        assert.equal(fs.readFileSync(path.join(info.dataDirectory, 'Downloads', '验收图片.txt'), 'utf8'), 'download-test');
        fs.writeFileSync(path.join(fixture, 'seed-passed'), 'paths, preload, native download, reset scheduling');
        await win.webContents.executeJavaScript('window.blinkflowStorage.clear()');
      } else {
        const api = await win.webContents.executeJavaScript(`(${snapshotApi.toString()})()`);
        assert.deepEqual(JSON.parse(api.local[0][1]).state.config.channels.map((channel) => channel.apiKey), ['fake-image', 'fake-text']);
        assert.equal(api.protocols[0][1], 'fake-protocol');
        assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('history')`), null);
        assert.deepEqual(fs.readdirSync(path.join(info.dataDirectory, 'Downloads')), []);
        assert(!fs.existsSync(path.join(info.dataDirectory, 'reset-api.json')));
        fs.writeFileSync(path.join(fixture, 'restore-passed'), 'actual main startup restored independent keys/protocol; removed history/downloads; reset consumed');
        win.destroy(); app.quit();
      }
    } catch (error) { fs.writeFileSync(path.join(fixture, 'error'), error.stack); BrowserWindow.getAllWindows().forEach((window) => window.destroy()); app.exit(1); }
  });
});
require(path.join(fixture, 'main.cjs'));
