const { app, BrowserWindow, dialog, shell, ipcMain, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { startHarness } = require('./harness-host.cjs');
const { prepareStorage, writeJson, resetFile } = require('./storage.cjs');
const { snapshotApi, restoreApi } = require('./storage-renderer.cjs');
const legacy = path.join(app.getPath('appData'), 'Infinite Canvas DXOS');
// The chosen install directory, NOT the downloaded installer's location.
const installDirectory = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
const dataDirectory = path.join(installDirectory, 'BlinkFlowData');
const origin = 'http://127.0.0.1:17456';
let restoredApi;
try {
  const instance = path.join(dataDirectory, 'Instance');
  if (fs.existsSync(dataDirectory) && fs.lstatSync(dataDirectory).isSymbolicLink()) throw new Error('BlinkFlowData 必须是普通目录');
  fs.mkdirSync(instance, { recursive: true });
  app.setPath('userData', instance);
} catch (error) {
  dialog.showErrorBox('数据目录不可写', `请将 BlinkFlow 安装在有写入权限的目录。不会改用其他存储位置。\n${error.message}`);
  app.exit(1);
}
const root = path.join(__dirname, 'web');
const mime = { '.html': 'text/html; charset=utf-8', '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
let server, harness, harnessWindow, harnessOpening, harnessBridge, harnessProjectId, quitting = false;
const harnessRequests = new Map();
let harnessModels = null;
// The bridge receives labels and IDs only; credentials stay in the main canvas renderer.
function cleanHarnessModels(state) {
  if (!state || typeof state.projectId !== 'string' || !state.projectId || typeof state.selectedImageModel !== 'string' || !Array.isArray(state.channels)) throw new Error('无效的画布模型目录');
  return { projectId: state.projectId, selectedImageModel: state.selectedImageModel, channels: state.channels.map(channel => {
    if (!channel || typeof channel.id !== 'string' || typeof channel.name !== 'string' || !Array.isArray(channel.models)) throw new Error('无效的生图中转站');
    return { id: channel.id, name: channel.name, models: channel.models.map(model => {
      if (!model || typeof model.id !== 'string' || typeof model.name !== 'string' || model.id !== channel.id + '::' + model.name) throw new Error('无效的生图模型');
      return { id: model.id, name: model.name };
    }) };
  }) };
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  try {
    restoredApi = prepareStorage(dataDirectory, legacy);
    const profile = path.join(dataDirectory, 'Profile');
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
    app.setPath('temp', path.join(dataDirectory, 'Temp'));
    process.env.TEMP = process.env.TMP = path.join(dataDirectory, 'Temp');
    app.setAppLogsPath(path.join(dataDirectory, 'Logs'));
    app.setPath('crashDumps', path.join(dataDirectory, 'CrashDumps'));
    app.setPath('downloads', path.join(dataDirectory, 'Downloads'));
    app.commandLine.appendSwitch('disk-cache-dir', path.join(profile, 'Cache'));
  } catch (error) { dialog.showErrorBox('存储初始化失败', String(error.message || error)); app.exit(1); }
  app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    // Stable loopback origin preserves IndexedDB/localforage across restarts and upgrades.
    server = http.createServer((req, res) => {
      try {
        const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
        if (name === '/__storage') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end('<!doctype html><meta charset="utf-8"><title>BlinkFlow</title><p>正在整理本地存储…</p>'); }
        const target = path.resolve(root, '.' + name);
        if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
        const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(root, 'index.html');
        res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        fs.createReadStream(file).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
      } catch { res.writeHead(400); res.end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(17456, '127.0.0.1', resolve); });
    const win = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 650, show: false, title: 'BlinkFlow', icon: path.join(__dirname, 'assets', 'blinkflow.ico'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    let clearing = false;
    const trusted = (event) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('无效的存储操作来源');
    };
    const currentHarnessModels = () => harnessModels?.projectId === harnessProjectId ? harnessModels : null;
    const publishHarnessModels = () => { if (harnessWindow && !harnessWindow.isDestroyed()) harnessWindow.webContents.send('harness:models-changed', currentHarnessModels()); };
    const trustedHarness = (event) => {
      if (!harness || !harnessWindow || harnessWindow.isDestroyed() || event.sender !== harnessWindow.webContents || event.senderFrame !== harnessWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== new URL(harness.url).origin) throw new Error('无效的 Harness 模型操作来源');
    };
    ipcMain.on('harness:models', (event, state) => {
      try { trusted(event); harnessModels = state === null ? null : cleanHarnessModels(state); publishHarnessModels(); }
      catch { /* Reject an invalid or unrelated renderer without exposing configuration. */ }
    });
    ipcMain.handle('harness:models-get', (event) => { trustedHarness(event); return currentHarnessModels(); });
    ipcMain.handle('harness:model-select', (event, imageModel) => {
      trustedHarness(event);
      const state = currentHarnessModels();
      if (!state) throw new Error('画布已切换，请从当前画布重新打开 Harness');
      if (typeof imageModel !== 'string' || (imageModel && !state.channels.some(channel => channel.models.some(model => model.id === imageModel)))) throw new Error('生图模型已移除，请重新选择');
      harnessModels = { ...state, selectedImageModel: imageModel };
      win.webContents.send('harness:image-model', { projectId: state.projectId, imageModel });
      publishHarnessModels();
    });
    const cancelHarnessRequests = (message) => {
      for (const [id, pending] of harnessRequests) {
        if (!win.isDestroyed()) win.webContents.send('harness:cancel', id);
        pending.finish({ error: message });
      }
    };
    const ensureHarnessBridge = async () => {
      if (harnessBridge) return harnessBridge;
      const token = crypto.randomBytes(32).toString('hex');
      const bridge = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/tool' || req.headers.authorization !== 'Bearer ' + token || req.headers.origin) { res.writeHead(403); return res.end(); }
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('error', () => { if (!res.writableEnded) res.destroy(); });
        req.on('end', () => {
          let request;
          try {
            request = JSON.parse(body);
            if (!request || typeof request.tool !== 'string' || !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('无效的画布工具请求');
            if (win.isDestroyed() || new URL(win.webContents.getURL()).origin !== origin) throw new Error('请先打开 BlinkFlow 画布');
          } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: error.message })); }
          const id = crypto.randomUUID();
          const finish = (value) => {
            harnessRequests.delete(id);
            if (!res.destroyed && !res.writableEnded) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
          };
          harnessRequests.set(id, { finish });
          res.once('close', () => { if (harnessRequests.delete(id) && !win.isDestroyed()) win.webContents.send('harness:cancel', id); });
          win.webContents.send('harness:tool', { id, projectId: harnessProjectId, imageModel: currentHarnessModels()?.selectedImageModel || '', tool: request.tool, args: request.args });
        });
      });
      await new Promise((resolve, reject) => { bridge.once('error', reject); bridge.listen(0, '127.0.0.1', resolve); });
      harnessBridge = { server: bridge, token, url: 'http://127.0.0.1:' + bridge.address().port };
      return harnessBridge;
    };
    const openHarnessExternal = async (url) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !(parsed.hostname === 'deepseek.com' || parsed.hostname.endsWith('.deepseek.com') || parsed.hostname === 'github.com' || parsed.hostname === 'deepseek-harness.github.io')) throw new Error('未打开非官方 Harness 外部地址');
      await shell.openExternal(parsed.href);
    };
    ipcMain.handle('harness:open', async (event, options) => {
      trusted(event);
      if (!options || typeof options.projectId !== 'string' || !options.projectId) throw new Error('请先打开画布');
      const models = cleanHarnessModels(options.models);
      if (models.projectId !== options.projectId) throw new Error('画布模型目录与当前画布不匹配');
      while (harnessOpening) {
        await harnessOpening.catch(() => {});
        trusted(event);
        if (harnessModels?.projectId !== options.projectId) throw new Error('画布已切换，请从当前画布重新打开 Harness');
      }
      harnessModels = models;
      harnessOpening = (async () => {
        if (harness && harnessProjectId !== options.projectId) {
          cancelHarnessRequests('画布已切换，旧画布工具已停止');
          if (harnessWindow && !harnessWindow.isDestroyed()) harnessWindow.destroy();
          await harness.stop(); harness = null;
        }
        harnessProjectId = options.projectId;
        if (!harness) {
          const bridge = await ensureHarnessBridge();
          harness = await startHarness({ runtimeDirectory: app.isPackaged ? path.join(process.resourcesPath, 'harness-runtime') : path.join(__dirname, 'harness-runtime'), dataDirectory: path.join(dataDirectory, 'Harness'), bridgeUrl: bridge.url, bridgeToken: bridge.token, openExternal: openHarnessExternal });
        }
        if (!harnessWindow || harnessWindow.isDestroyed()) {
          harnessWindow = new BrowserWindow({ parent: win, width: 1100, height: 850, minWidth: 620, minHeight: 520, show: false, title: 'DeepSeek Harness · BlinkFlow', icon: path.join(__dirname, 'assets', 'blinkflow.ico'), webPreferences: { preload: path.join(__dirname, 'harness-preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:blinkflow-harness' } });
          const harnessOrigin = new URL(harness.url).origin;
          harnessWindow.webContents.setWindowOpenHandler(({ url }) => { if (url === 'about:blank') return { action: 'deny' }; void openHarnessExternal(url).catch((error) => dialog.showErrorBox('无法打开登录页面', error.message)); return { action: 'deny' }; });
          harnessWindow.webContents.on('will-navigate', (navigation, url) => { if (new URL(url).origin !== harnessOrigin) { navigation.preventDefault(); void openHarnessExternal(url).catch((error) => dialog.showErrorBox('无法打开外部页面', error.message)); } });
          harnessWindow.on('close', (close) => { if (!quitting) { close.preventDefault(); harnessWindow.hide(); } });
          harnessWindow.setMenuBarVisibility(false);
          try { await harnessWindow.loadURL(harness.url); }
          catch (error) { harnessWindow.destroy(); harnessWindow = null; throw error; }
        }
        publishHarnessModels();
        if (harnessWindow.isMinimized()) harnessWindow.restore();
        harnessWindow.show(); harnessWindow.focus();
        return { url: new URL(harness.url).origin };
      })();
      try { return await harnessOpening; }
      finally { harnessOpening = null; }
    });
    ipcMain.on('harness:response', (event, id, result) => {
      try { trusted(event); } catch { return; }
      if (typeof id !== 'string' || !result || typeof result !== 'object') return;
      harnessRequests.get(id)?.finish(result);
    });
    win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => { if (isMainFrame) cancelHarnessRequests('画布页面已切换，工具请求已停止'); });
    win.on('closed', () => { cancelHarnessRequests('画布已关闭'); app.quit(); });
    ipcMain.handle('downloads:images', async (event, files) => {
      trusted(event);
      if (!Array.isArray(files) || files.some((file) => !file || typeof file.name !== 'string' || path.basename(file.name) !== file.name || /[<>:"/\\|?*\x00-\x1f]/.test(file.name) || !(file.data instanceof ArrayBuffer))) throw new Error('无效的图片下载数据');
      if (!files.length) return { canceled: true, count: 0 };
      const selected = await dialog.showOpenDialog(win, { title: '选择批量图片保存目录', defaultPath: path.join(dataDirectory, 'Downloads'), properties: ['openDirectory', 'createDirectory'] });
      if (selected.canceled || !selected.filePaths[0]) return { canceled: true, count: 0 };
      const directory = selected.filePaths[0]; let count = 0;
      for (const file of files) {
        const parsed = path.parse(file.name); let index = 1, destination = path.join(directory, file.name);
        while (true) {
          try { await fs.promises.writeFile(destination, Buffer.from(file.data), { flag: 'wx' }); break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; destination = path.join(directory, parsed.name + ' (' + index++ + ')' + parsed.ext); }
        }
        count++;
      }
      return { canceled: false, count, directory };
    });
    ipcMain.handle('storage:info', (event) => { trusted(event); return { installDirectory, dataDirectory }; });
    ipcMain.handle('storage:open', async (event) => { trusted(event); const error = await shell.openPath(dataDirectory); if (error) throw new Error(error); });
    ipcMain.handle('storage:clear', async (event) => {
      trusted(event);
      if (clearing) throw new Error('清理已在进行');
      const result = await dialog.showMessageBox(win, { type: 'warning', buttons: ['取消', '清除并重启'], defaultId: 0, cancelId: 0, title: '清除本地数据', message: '保留 API 配置，清除其余本地数据？', detail: '将删除全部画布、素材、输入和输出图片、历史、日志、缓存、临时文件以及 BlinkFlowData/Downloads 内的下载文件，不创建备份。保留渠道、各自的 Key、模型绑定、自定义协议和 Agent 连接凭据。外部原文件不会删除。' });
      if (result.response !== 1) return false;
      clearing = true;
      try {
        // Unload all stores/tasks before taking the authoritative API snapshot.
        await win.loadURL(origin + '/__storage');
        const api = await win.webContents.executeJavaScript(`(${snapshotApi.toString()})()`);
        session.defaultSession.flushStorageData();
        writeJson(path.join(dataDirectory, resetFile), api);
        app.relaunch();
        app.quit();
        return true;
      } catch (error) { clearing = false; await win.loadURL(origin + '/config'); throw error; }
    });
    const downloads = new Set();
    session.defaultSession.on('will-download', (_event, item) => {
      const filename = path.basename(item.getFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'download';
      const parsed = path.parse(filename);
      let destination = path.join(dataDirectory, 'Downloads', filename), index = 1;
      while (fs.existsSync(destination) || downloads.has(destination)) destination = path.join(dataDirectory, 'Downloads', `${parsed.name} (${index++})${parsed.ext}`);
      downloads.add(destination);
      item.once('done', () => downloads.delete(destination));
      item.setSavePath(destination);
    });
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== 'http://127.0.0.1:17456') { event.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); } });
    if (restoredApi) {
      await win.loadURL(origin + '/__storage');
      await win.webContents.executeJavaScript(`(${restoreApi.toString()})(${JSON.stringify(restoredApi)})`);
      session.defaultSession.flushStorageData();
      fs.unlinkSync(path.join(dataDirectory, resetFile));
      restoredApi = null;
    }
    await win.loadURL(origin);
    win.setMenuBarVisibility(false);
    // Every launch starts maximized, independent of the previous window size.
    win.maximize();
    win.show();
  }).catch((error) => { dialog.showErrorBox('启动失败', String(error.message || error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; harness?.stop(); harnessBridge?.server.close(); server?.close(); });
}
