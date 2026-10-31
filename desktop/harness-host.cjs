const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/** Start the bundled official Harness, keeping credentials and sessions under BlinkFlowData. */
async function startHarness({ runtimeDirectory, dataDirectory, bridgeUrl, bridgeToken, openExternal, onLog = () => {} }) {
  const bridge = new URL(bridgeUrl);
  if (bridge.protocol !== 'http:' || bridge.hostname !== '127.0.0.1' || !bridgeToken) throw new Error('无效的画布工具连接');
  const runtime = path.join(path.resolve(runtimeDirectory), 'runtime');
  const node = path.join(path.resolve(runtimeDirectory), 'node', process.platform === 'win32' ? 'node.exe' : 'node');
  const boot = path.join(runtime, 'boot.mjs');
  for (const file of [node, boot, path.join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')]) {
    if (!fs.existsSync(file)) throw new Error('安装包缺少 DeepSeek Harness 运行组件，请重新安装完整版本');
  }
  const home = path.resolve(dataDirectory);
  const temp = path.join(home, 'Temp');
  fs.mkdirSync(temp, { recursive: true });
  const env = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'Agents'), TEMP: temp, TMP: temp, TMPDIR: temp, DSH_TELEMETRY_DISABLED: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('ELECTRON_') || key.startsWith('BLINKFLOW_HARNESS_')) delete env[key];
  const child = spawn(node, [boot], { cwd: home, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let ready = false, stopping;
  const closed = new Promise((resolve) => child.once('close', resolve));
  const log = (chunk) => {
    // The official startup URL is a bearer credential, never a diagnostic.
    const line = String(chunk).trim();
    if (line && !/dsh web:|(?:token|authorization|authorizeUrl|api.?key)\s*[:=]/i.test(line)) onLog(line);
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  const stop = () => stopping ??= (async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.send({ type: 'stop' });
    else child.kill();
    await closed;
  })();
  try {
    const url = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => { if (!ready) reject(new Error('DeepSeek Harness 启动失败（' + code + '），请查看运行日志')); });
      child.on('message', (message) => {
        if (message?.type === 'openExternal') {
          if (typeof message.url !== 'string' || typeof openExternal !== 'function') return;
          void Promise.resolve().then(() => openExternal(message.url)).catch(() => {
            onLog('无法自动打开 DeepSeek 官方授权页，请使用 Harness 登录界面的授权链接');
          });
          return;
        }
        if (message?.type === 'error' && !ready) reject(new Error(message.message || 'DeepSeek Harness 启动失败'));
        if (message?.type !== 'ready' || ready) return;
        try {
          const result = new URL(message.url);
          if (result.protocol !== 'http:' || result.hostname !== '127.0.0.1') throw new Error('Harness 返回了非本地地址');
          ready = true;
          resolve(result.href);
        } catch (error) { reject(error); }
      });
      child.once('spawn', () => child.send({ type: 'start', bridgeUrl: bridge.origin, bridgeToken }));
    });
    return { url, stop };
  } catch (error) { await stop(); throw error; }
}

module.exports = { startHarness };