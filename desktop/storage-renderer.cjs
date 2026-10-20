// Executed only in the trusted local origin, without importing application stores.
const snapshotApi = async () => {
  const local = [];
  const key = 'infinite-canvas:ai_config_store';
  const raw = localStorage.getItem(key);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!parsed.state?.config) throw new Error('API 配置格式异常，清理未执行');
    const fields = ['channelMode', 'baseUrl', 'apiKey', 'apiFormat', 'channels', 'models', 'model', 'imageModel', 'textModel', 'videoModel', 'audioModel', 'proxyEnabled', 'proxyUrl'];
    const config = Object.fromEntries(fields.filter((field) => Object.hasOwn(parsed.state.config, field)).map((field) => [field, parsed.state.config[field]]));
    local.push([key, JSON.stringify({ state: { config }, version: parsed.version ?? 0 })]);
  }
  for (const name of ['canvas-agent-url', 'canvas-agent-token', 'canvas-agent-model']) {
    const value = localStorage.getItem(name);
    if (value !== null) local.push([name, value]);
  }
  const protocols = await new Promise((resolve, reject) => {
    const request = indexedDB.open('infinite-canvas');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('call_protocols')) { db.close(); return resolve([]); }
      const tx = db.transaction('call_protocols', 'readonly');
      const get = tx.objectStore('call_protocols').get('canvas-call-protocols-v1');
      tx.onerror = () => {};
      tx.oncomplete = () => { db.close(); resolve(get.result == null ? [] : [['canvas-call-protocols-v1', get.result]]); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
  return { version: 1, local, protocols };
};

const restoreApi = async (api) => {
  for (const [key, value] of api.local) localStorage.setItem(key, value);
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('infinite-canvas');
    request.onupgradeneeded = () => request.result.createObjectStore('call_protocols');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('call_protocols', 'readwrite', { durability: 'strict' });
      for (const [key, value] of api.protocols) tx.objectStore('call_protocols').put(value, key);
      tx.onerror = () => {};
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
};
module.exports = { snapshotApi, restoreApi };
