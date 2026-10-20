const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareStorage, writeJson, resetFile, managedDirectories } = require('../storage.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blinkflow-storage-check-'));
try {
  const root = path.join(temporary, '安装位置', 'BlinkFlowData'), legacy = path.join(temporary, '旧数据');
  fs.mkdirSync(path.join(legacy, 'IndexedDB'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'IndexedDB', 'sample.ldb'), Buffer.from([0, 255, 3, 45]));
  fs.writeFileSync(path.join(legacy, 'Preferences'), 'old settings');
  fs.writeFileSync(path.join(legacy, 'lockfile'), 'old instance');
  assert.equal(prepareStorage(root, legacy), null);
  assert.deepEqual(fs.readFileSync(path.join(root, 'Profile', 'IndexedDB', 'sample.ldb')), Buffer.from([0, 255, 3, 45]));
  assert(!fs.existsSync(path.join(root, 'Profile', 'lockfile')));
  assert.equal(fs.readFileSync(path.join(legacy, 'Preferences'), 'utf8'), 'old settings');
  fs.writeFileSync(path.join(root, 'Profile', 'Preferences'), 'new settings');
  fs.writeFileSync(path.join(legacy, 'Preferences'), 'stale source');
  prepareStorage(root, legacy);
  assert.equal(fs.readFileSync(path.join(root, 'Profile', 'Preferences'), 'utf8'), 'new settings');
  for (const directory of managedDirectories) fs.writeFileSync(path.join(root, directory, 'delete-me'), 'data');
  fs.writeFileSync(path.join(temporary, 'outside.txt'), 'untouched');
  const api = { version: 1, local: [['canvas-agent-token', 'test-not-secret']], protocols: [['canvas-call-protocols-v1', 'protocol']] };
  writeJson(path.join(root, resetFile), api);
  assert.deepEqual(prepareStorage(root, legacy), api);
  for (const directory of managedDirectories) assert.deepEqual(fs.readdirSync(path.join(root, directory)), []);
  assert.equal(fs.readFileSync(path.join(temporary, 'outside.txt'), 'utf8'), 'untouched');
  assert(fs.existsSync(path.join(root, resetFile)), 'recovery survives until renderer restore succeeds');
  fs.unlinkSync(path.join(root, resetFile));
  prepareStorage(root, legacy);
  assert(!fs.existsSync(path.join(root, 'Profile', 'Preferences')), 'cleanup never remigrates stale source');
  writeJson(path.join(root, resetFile), { version: 2 });
  fs.writeFileSync(path.join(root, 'Profile', 'retained'), 'keep');
  assert.throws(() => prepareStorage(root, legacy), /损坏/);
  assert(fs.existsSync(path.join(root, 'Profile', 'retained')));
  const conflict = path.join(temporary, 'conflict');
  fs.mkdirSync(path.join(conflict, 'Profile'), { recursive: true });
  assert.throws(() => prepareStorage(conflict, legacy), /避免覆盖/);
  console.log('Storage filesystem checks passed: migration bytes, one-time marker, source retention, full managed cleanup, API recovery, no remigration, invalid recovery and conflict protection.');
} finally {
  // The exact freshly-created test workspace only; never actual application data.
  if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('blinkflow-storage-check-')) throw new Error('Invalid test cleanup target');
  fs.rmSync(temporary, { recursive: true, force: true });
}
