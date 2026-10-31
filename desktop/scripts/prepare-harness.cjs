const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

// Reproducible Windows x64 bundle: official npm packages and official Node only.
const VERSION = '24.14.0';
const ZIP = `node-v${VERSION}-win-x64.zip`;
const SHA256 = '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66';
const NODE_SHA256 = '63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088';
const root = path.resolve(__dirname, '..', 'harness-runtime');
const cache = path.join(root, '.cache');
const runtime = path.join(root, 'runtime');
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const exists = (file) => fs.access(file).then(() => true, () => false);
const run = (exe, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(exe, args, { windowsHide: true, stdio: 'inherit', ...options });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} exited with ${code}`)));
});

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This installer runtime is Windows x64 only');
  const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'package.json'), 'utf8'));
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-app-boot']) {
    if (manifest.dependencies?.[name] !== '0.2.1-alpha.3') throw new Error(`${name} version does not match the pinned runtime`);
  }
  if (!await exists(path.join(runtime, 'package-lock.json'))) throw new Error('Committed runtime/package-lock.json is required');
  await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, ZIP);
  if (!await exists(archive)) {
    const response = await fetch(`https://nodejs.org/dist/v${VERSION}/${ZIP}`);
    if (!response.ok) throw new Error(`Official Node download failed: HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (sha256(data) !== SHA256) throw new Error('Official Node archive SHA256 mismatch');
    await fs.writeFile(archive + '.tmp', data);
    await fs.rename(archive + '.tmp', archive);
  }
  if (sha256(await fs.readFile(archive)) !== SHA256) throw new Error('Cached Node archive SHA256 mismatch');
  const unpack = await fs.mkdtemp(path.join(cache, 'node-unpack-'));
  const env = { ...process.env, TEMP: cache, TMP: cache, BLINKFLOW_NODE_ZIP: archive, BLINKFLOW_NODE_UNPACK: unpack };
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BLINKFLOW_NODE_ZIP -DestinationPath $env:BLINKFLOW_NODE_UNPACK'], { env });
  const nodeDir = path.join(unpack, `node-v${VERSION}-win-x64`);
  const node = path.join(nodeDir, 'node.exe');
  if (sha256(await fs.readFile(node)) !== NODE_SHA256) throw new Error('Extracted official node.exe SHA256 mismatch');
  const npmCache = path.join(cache, 'npm');
  const npmConfig = path.join(cache, 'npm-empty.config');
  await fs.writeFile(npmConfig, '');
  await run(node, [path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), 'ci', '--omit=dev', '--no-audit', '--no-fund', '--cache', npmCache, '--registry', 'https://registry.npmjs.org/'], {
    cwd: runtime,
    env: { ...process.env, TEMP: cache, TMP: cache, PATH: nodeDir + path.delimiter + process.env.PATH, npm_config_cache: npmCache, npm_config_userconfig: npmConfig, npm_config_update_notifier: 'false' },
  });
  const target = path.join(root, 'node');
  await fs.mkdir(target, { recursive: true });
  const backup = path.join(cache, 'node-backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  for (const [source, filename] of [['node.exe', 'node.exe'], ['LICENSE', 'LICENSE.node.txt']]) {
    const destination = path.join(target, filename);
    if (await exists(destination)) {
      await fs.mkdir(backup, { recursive: true });
      await fs.copyFile(destination, path.join(backup, filename));
    }
    await fs.copyFile(path.join(nodeDir, source), destination + '.tmp');
    await fs.rename(destination + '.tmp', destination);
  }
  console.log(`Official DeepSeek Harness 0.2.1-alpha.3 + Node ${VERSION} prepared in ${root}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });