// Isolated real-Electron storage test; never uses the user's profile or keys.
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { prepareStorage, writeJson, resetFile } = require('../storage.cjs');
const { snapshotApi, restoreApi } = require('../storage-renderer.cjs');
const testRoot = path.resolve(__dirname, '../../.checks/storage-runtime');
const phase = process.argv[2];
const data = path.join(testRoot, 'BlinkFlowData');
const api = prepareStorage(data, path.join(testRoot, 'absent-legacy'));
app.setPath('userData', path.join(data, 'Profile'));
app.setPath('sessionData', path.join(data, 'Profile'));
app.setPath('temp', path.join(data, 'Temp'));
app.setAppLogsPath(path.join(data, 'Logs'));
app.setPath('crashDumps', path.join(data, 'CrashDumps'));
app.whenReady().then(async () => {
  const server = http.createServer((_req, res) => res.end('<!doctype html><p>Isolated storage test</p>'));
  const portFile = path.join(testRoot, 'port');
  await new Promise((resolve) => server.listen(phase === 'seed' ? 0 : Number(fs.readFileSync(portFile, 'utf8')), '127.0.0.1', resolve));
  if (phase === 'seed') fs.writeFileSync(portFile, String(server.address().port));
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  if (phase === 'seed') {
    const sample = { version: 1, local: [['infinite-canvas:ai_config_store', JSON.stringify({ state: { config: { channels: [{ id: 'image', apiKey: 'fake-image' }, { id: 'text', apiKey: 'fake-text' }] } }, version: 0 })]], protocols: [['canvas-call-protocols-v1', JSON.stringify({ state: { protocols: [{ id: 'native', script: 'test-script' }] }, version: 0 })]] };
    await win.webContents.executeJavaScript(`(${restoreApi.toString()})(${JSON.stringify(sample)})`);
    await win.webContents.executeJavaScript(`localStorage.setItem('remove-history','test-history')`);
    const snapshot = await win.webContents.executeJavaScript(`(${snapshotApi.toString()})()`);
    writeJson(path.join(data, resetFile), snapshot);
    for (const directory of ['Downloads', 'Logs', 'Temp']) fs.writeFileSync(path.join(data, directory, 'remove-me'), 'test');
  } else {
    assert(api, 'pending cleanup read before session startup');
    await win.webContents.executeJavaScript(`(${restoreApi.toString()})(${JSON.stringify(api)})`);
    const restored = await win.webContents.executeJavaScript(`(${snapshotApi.toString()})()`);
    assert.deepEqual(restored, api);
    assert.equal(await win.webContents.executeJavaScript(`localStorage.getItem('remove-history')`), null);
    for (const directory of ['Downloads', 'Logs', 'Temp']) assert(!fs.existsSync(path.join(data, directory, 'remove-me')));
    fs.unlinkSync(path.join(data, resetFile));
  }
  session.defaultSession.flushStorageData();
  assert.equal(app.getPath('sessionData'), path.join(data, 'Profile'));
  console.log(`Real Electron storage ${phase} passed: native Chromium profile, localStorage, IndexedDB protocol, independent keys and managed files.`);
  fs.writeFileSync(path.join(testRoot, phase + '-passed'), 'passed');
  win.destroy(); server.close(); app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
