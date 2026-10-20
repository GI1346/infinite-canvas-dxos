const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const managedDirectories = ['Profile', 'Temp', 'Logs', 'CrashDumps', 'Downloads'];
const migrationFile = 'storage.json';
const resetFile = 'reset-api.json';

function writeJson(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function removeManaged(root, name) {
  const target = path.resolve(root, name);
  if (!inside(root, target) || !managedDirectories.includes(name)) throw new Error('无效的数据清理目录');
  // Never traverse a user-created junction or symlink during recursive deletion.
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('数据目录包含符号链接，未执行清理');
  fs.rmSync(target, { recursive: true, force: true });
}

function validateApi(api) {
  const localKeys = ['infinite-canvas:ai_config_store', 'canvas-agent-url', 'canvas-agent-token', 'canvas-agent-model'];
  const entry = (value) => Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string';
  if (api.version !== 1 || !Array.isArray(api.local) || !Array.isArray(api.protocols) || api.local.some((item) => !entry(item) || !localKeys.includes(item[0])) || api.protocols.some((item) => !entry(item) || item[0] !== 'canvas-call-protocols-v1')) throw new Error('API 保留记录损坏，未执行清理');
}

function holdDatabaseLocks(directory, handles) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('旧数据包含符号链接');
    if (item.isDirectory()) holdDatabaseLocks(file, handles);
    else if (item.name === 'LOCK') {
      // On Windows LevelDB opens LOCK without sharing; keep our handle until
      // copying finishes so an old process cannot open the database mid-copy.
      try { handles.push(fs.openSync(file, 'r+')); }
      catch { throw new Error('旧版数据库正在使用或不可读取，请先退出旧版 BlinkFlow 后重试；原数据未修改'); }
    }
  }
}

function copyVerified(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    // Chromium's instance locks are process state, not user data.
    if (/^(Singleton(Lock|Cookie|Socket)|lockfile)$/i.test(item.name)) continue;
    const from = path.join(source, item.name), to = path.join(destination, item.name);
    if (item.isSymbolicLink()) throw new Error('旧数据包含符号链接，迁移未完成，原目录未修改');
    if (item.isDirectory()) copyVerified(from, to);
    else if (item.isFile()) {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      const hash = (file) => {
        const digest = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
        try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, count)); }
        finally { fs.closeSync(fd); }
        return digest.digest('hex');
      };
      if (hash(from) !== hash(to)) throw new Error('迁移文件校验失败，原目录未修改');
    } else throw new Error('旧数据包含不支持的文件类型，原目录未修改');
  }
}

// Runs synchronously before Electron creates a session or opens any database.
function prepareStorage(root, legacy) {
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('BlinkFlowData 必须是普通目录');
  const marker = path.join(root, migrationFile), profile = path.join(root, 'Profile');
  if (fs.existsSync(profile) && fs.lstatSync(profile).isSymbolicLink()) throw new Error('Profile 必须是普通目录');
  if (!fs.existsSync(marker)) {
    if (fs.existsSync(profile) && !fs.existsSync(path.join(profile, '.blinkflow-migrated'))) throw new Error('发现未标记的数据目录，为避免覆盖，启动已停止');
    if (!fs.existsSync(profile) && fs.existsSync(legacy)) {
      const temp = path.join(root, 'Temp');
      if (fs.existsSync(temp) && fs.lstatSync(temp).isSymbolicLink()) throw new Error('Temp 必须是普通目录');
      fs.mkdirSync(temp, { recursive: true });
      const staging = fs.mkdtempSync(path.join(temp, '.migration-'));
      const handles = [];
      try {
        holdDatabaseLocks(legacy, handles);
        copyVerified(legacy, staging);
        writeJson(path.join(staging, '.blinkflow-migrated'), { version: 1 });
        fs.renameSync(staging, profile);
      } finally {
        handles.forEach((handle) => fs.closeSync(handle));
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      }
    } else if (!fs.existsSync(profile)) {
      fs.mkdirSync(profile);
      writeJson(path.join(profile, '.blinkflow-migrated'), { version: 1 });
    }
    writeJson(marker, { version: 1, migrated: true });
  } else if (JSON.parse(fs.readFileSync(marker, 'utf8')).version !== 1) throw new Error('存储标记版本不支持');
  const reset = path.join(root, resetFile);
  let api = null;
  if (fs.existsSync(reset)) {
    api = JSON.parse(fs.readFileSync(reset, 'utf8'));
    validateApi(api);
    for (const name of managedDirectories) {
      const target = path.join(root, name);
      if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('数据目录包含符号链接，未执行清理');
    }
    managedDirectories.forEach((name) => removeManaged(root, name));
  }
  for (const name of managedDirectories) {
    const directory = path.join(root, name);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('数据目录包含符号链接');
    fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(directory, `.write-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  }
  return api;
}

module.exports = { prepareStorage, writeJson, resetFile, managedDirectories };
