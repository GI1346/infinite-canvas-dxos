// Real production main/preload IPC, with an isolated profile and a stubbed native picker.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
const fixture = fs.mkdtempSync(path.resolve(__dirname, '../../.checks/downloads-runtime-0207-'));
const picked = path.join(fixture, 'user-selected-directory');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
fs.mkdirSync(picked);
fs.mkdirSync(path.join(fixture, 'web'));
fs.mkdirSync(path.join(fixture, 'mock-appdata'));
app.setPath('appData', path.join(fixture, 'mock-appdata'));
for (const name of ['main.cjs', 'preload.cjs', 'storage.cjs', 'storage-renderer.cjs']) {
  let source = fs.readFileSync(path.join(__dirname, '..', name));
  // The production port must not share or interrupt the user's desktop session.
  if (name === 'main.cjs') source = Buffer.from(source.toString().replaceAll('17456', '17807'));
  fs.writeFileSync(path.join(fixture, name), source);
}
fs.writeFileSync(path.join(fixture, 'web', 'index.html'), '<!doctype html><meta charset="utf-8"><title>Isolated downloads acceptance</title>');
let cancel = true, pickerCalls = 0, checked = false;
dialog.showOpenDialog = async (_win, options) => {
  pickerCalls++;
  assert.equal(options.title, '选择批量图片保存目录');
  assert.deepEqual(options.properties, ['openDirectory', 'createDirectory']);
  assert.equal(options.defaultPath, path.join(fixture, 'BlinkFlowData', 'Downloads'));
  return { canceled: cancel, filePaths: cancel ? [] : [picked] };
};
dialog.showErrorBox = (title, message) => { console.error(title, message); app.exit(1); };
app.on('browser-window-created', (_event, win) => {
  win.hide();
  win.webContents.on('did-finish-load', async () => {
    if (checked || new URL(win.webContents.getURL()).pathname !== '/') return;
    checked = true;
    const run = (code) => win.webContents.executeJavaScript(code);
    const files = JSON.stringify([{ name: '自定义重命名图片.png', bytes: [...png] }, { name: '第二张图片.png', bytes: [...png] }]);
    const save = () => run(`window.blinkflowDownloads.saveImages(${files}.map(f => ({ name: f.name, data: new Uint8Array(f.bytes).buffer })))`);
    try {
      assert.equal(await run('typeof window.blinkflowDownloads.saveImages'), 'function');
      assert.equal(await run('typeof window.require'), 'undefined');
      const info = await run('window.blinkflowStorage.info()');
      assert.equal(info.dataDirectory, path.join(fixture, 'BlinkFlowData'));
      assert.deepEqual(await save(), { canceled: true, count: 0 });
      assert.deepEqual(fs.readdirSync(picked), []);
      assert.deepEqual(fs.readdirSync(path.join(info.dataDirectory, 'Downloads')), []);
      cancel = false;
      fs.writeFileSync(path.join(picked, '自定义重命名图片.png'), 'existing file must remain');
      const result = await save();
      assert.deepEqual(result, { canceled: false, count: 2, directory: picked });
      assert.equal(fs.readFileSync(path.join(picked, '自定义重命名图片.png'), 'utf8'), 'existing file must remain');
      assert.deepEqual(fs.readFileSync(path.join(picked, '自定义重命名图片 (1).png')), png);
      assert.deepEqual(fs.readFileSync(path.join(picked, '第二张图片.png')), png);
      assert.deepEqual(fs.readdirSync(path.join(info.dataDirectory, 'Downloads')), []);
      const calls = pickerCalls;
      assert.deepEqual(await run('window.blinkflowDownloads.saveImages([])'), { canceled: true, count: 0 });
      assert.equal(pickerCalls, calls);
      for (const name of ['../outside.png', 'C:\\outside.png', 'bad/name.png']) {
        const rejection = await run(`window.blinkflowDownloads.saveImages([{ name: ${JSON.stringify(name)}, data: new ArrayBuffer(1) }]).then(() => '', e => e.message)`);
        assert.ok(rejection.includes('无效的图片下载数据'));
      }
      const typeRejection = await run(`window.blinkflowDownloads.saveImages([{ name: 'bad.png', data: [1, 2] }]).then(() => '', e => e.message)`);
      assert.ok(typeRejection.includes('无效的图片下载数据'));
      assert.equal(pickerCalls, calls);
      const other = new BrowserWindow({ show: false, webPreferences: { preload: path.join(fixture, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
      await other.loadURL('http://127.0.0.1:17807');
      const trustRejection = await other.webContents.executeJavaScript(`window.blinkflowDownloads.saveImages([]).then(() => '', e => e.message)`);
      assert.ok(trustRejection.includes('无效的存储操作来源'));
      other.destroy();
      const report = { passed: true, completedAt: new Date().toISOString(), fixture, productionMain: true, productionPreload: true, isolatedPort: 17807, runtimeSwitches: process.argv.filter(value => value.startsWith('--')), pickerCalls, checks: ['isolated installation storage', 'context-isolated preload IPC', 'native picker options (dialog stubbed)', 'cancel writes nothing', 'selected folder preserves original PNG bytes', 'Chinese renamed filenames', 'existing file preserved with collision suffix', 'no default-directory fallback', 'empty selection does not open picker', 'invalid filenames and byte type rejected', 'untrusted browser window IPC rejected'] };
      fs.writeFileSync(path.resolve(__dirname, '../../.checks/downloads-runtime-0207-result.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
      win.destroy(); app.quit();
    } catch (error) {
      fs.writeFileSync(path.join(fixture, 'error.txt'), error.stack);
      console.error(error);
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()); app.exit(1);
    }
  });
});
setTimeout(() => { console.error('Downloads runtime acceptance timed out'); app.exit(1); }, 30000).unref();
require(path.join(fixture, 'main.cjs'));
