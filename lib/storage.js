// Lightweight resilience layer: persistent storage, IDB snapshots, auto-restore
// Exposes global StorageSafe with init(), snapshotNow(), snapshotLater()
(function(){
  const DB_NAME = 'lyricsmith-store';
  const DB_VERSION = 1;
  const SNAP_MAX = 20;            // keep last N snapshots
  const SNAP_MIN_INTERVAL = 15e3; // min 15s between snapshots
  const PERIODIC_INTERVAL = 2 * 60e3; // periodic every 2 minutes

  let db = null;
  let lastSnapAt = 0;
  let lastHash = null;
  let debouncer = null;
  let inited = false;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = req.result;
        if (!d.objectStoreNames.contains('kv')) {
          d.createObjectStore('kv', { keyPath: 'key' });
        }
        if (!d.objectStoreNames.contains('snapshots')) {
          const store = d.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }

  async function kvGet(key) {
    try {
      await openDB();
      return await new Promise((res, rej) => {
        const r = tx('kv').get(key);
        r.onsuccess = () => res(r.result?.value);
        r.onerror = () => rej(r.error);
      });
    } catch { return undefined; }
  }
  async function kvSet(key, value) {
    try {
      await openDB();
      await new Promise((res, rej) => {
        const r = tx('kv', 'readwrite').put({ key, value });
        r.onsuccess = () => res();
        r.onerror = () => rej(r.error);
      });
    } catch {}
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }

  function showToast(msg, type='info') {
    try {
      let c = document.querySelector('.toast-container');
      if (!c) {
        c = document.createElement('div');
        c.className = 'toast-container';
        document.body.appendChild(c);
      }
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.textContent = msg;
      c.appendChild(el);
      setTimeout(() => el.classList.add('show'), 10);
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
    } catch {}
  }

  async function persistRequest() {
    if (!navigator.storage?.persist) return false;
    try {
      const already = await navigator.storage.persisted();
      if (already) { await kvSet('persisted', true); return true; }
      const granted = await navigator.storage.persist();
      await kvSet('persisted', !!granted);
      if (granted) showToast('Storage pinned for persistence', 'success');
      return granted;
    } catch { return false; }
  }

  async function estimateCheck() {
    if (!navigator.storage?.estimate) return;
    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      if (quota > 0 && usage / quota > 0.85) {
        showToast('Storage nearly full — export or clear space', 'warning');
      }
    } catch {}
  }

  async function addSnapshot(reason='auto', overrideData=null) {
    await openDB();
    const songsStr = overrideData != null ? String(overrideData) : safeGetLocal('songs', '[]');
    const now = Date.now();
    const h = hashString(songsStr);
    if (h === lastHash && now - lastSnapAt < SNAP_MIN_INTERVAL) return; // unchanged
    lastHash = h;
    lastSnapAt = now;
    const meta = { ts: now, reason, bytes: songsStr.length };
    await new Promise((res, rej) => {
      const s = tx('snapshots', 'readwrite');
      const req = s.add({ ...meta, data: songsStr });
      req.onsuccess = async () => {
        // rotate old if over max
        try {
          const idx = s.index('ts');
          const all = [];
          idx.openCursor(null, 'next').onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { all.push({ pk: cursor.primaryKey }); cursor.continue(); }
            else {
              const over = Math.max(0, all.length - SNAP_MAX);
              if (!over) return res();
              let deleted = 0;
              all.slice(0, over).forEach(({ pk }) => {
                s.delete(pk).onsuccess = () => { deleted++; if (deleted === over) res(); };
              });
            }
          };
        } catch { res(); }
      };
      req.onerror = () => rej(req.error);
    });
  }

  async function restoreLatestIfNeeded() {
    try {
      const current = safeGetLocal('songs', null);
      if (current && current !== '[]') return false;
      await openDB();
      const latest = await new Promise((res) => {
        const s = tx('snapshots');
        const idx = s.index('ts');
        const req = idx.openCursor(null, 'prev');
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) res(cursor.value);
          else res(null);
        };
        req.onerror = () => res(null);
      });
      if (latest?.data) {
        safeSetLocal('songs', latest.data);
        showToast('Recovered library from backup', 'success');
        return true;
      }
    } catch {}
    return false;
  }

  function safeSetLocal(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch(e){ console.warn('localStorage set failed', e); return false; }
  }
  function safeGetLocal(key, fallback='') {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; }
    catch(e){ return fallback; }
  }

  async function init() {
    if (inited) return;
    inited = true;
    try { await openDB(); } catch {}
    persistRequest();
    estimateCheck();
    await restoreLatestIfNeeded();

    // seed snapshot state
    const data = safeGetLocal('songs', '[]');
    lastHash = hashString(data);
    lastSnapAt = Date.now();
    addSnapshot('init');

    // periodic snapshots
    setInterval(() => addSnapshot('periodic'), PERIODIC_INTERVAL);

    // flush when losing visibility / unloading
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') addSnapshot('hidden');
    });
    window.addEventListener('beforeunload', () => { addSnapshot('unload'); });
  }

  const API = {
    init,
    snapshotNow: (reason) => addSnapshot(reason || 'manual'),
    snapshotWithData: (data, reason) => addSnapshot(reason || 'manual', data),
    snapshotLater: (reason) => {
      clearTimeout(debouncer);
      debouncer = setTimeout(() => addSnapshot(reason || 'debounced'), 800);
    }
  };

  // attach
  window.StorageSafe = API;

  // auto-init ASAP
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
