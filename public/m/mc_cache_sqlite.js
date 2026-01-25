// Minechat mobile cache backend
// - App-Plus (DCloud 5+ runtime): use plus.sqlite (real local sqlite file)
// - Other environments: fallback to localStorage
(function () {
  'use strict';

  const DB_NAME = 'minechat_cache';
  const DB_PATH = '_doc/minechat_cache.db';
  const TABLE = 'kv_cache';

  let _initPromise = null;

  function hasPlusSqlite() {
    try {
      return typeof window !== 'undefined' && !!window.plus && !!window.plus.sqlite;
    } catch (e) {
      return false;
    }
  }

  function waitPlusReady() {
    try {
      if (hasPlusSqlite()) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => {
          try { document.removeEventListener('plusready', done); } catch (e) {}
          resolve();
        };
        document.addEventListener('plusready', done);
        // Safety: if plusready never fires (web), resolve anyway.
        setTimeout(() => resolve(), 300);
      });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function sqlQuote(value) {
    const s = String(value === undefined || value === null ? '' : value);
    return `'${s.replace(/'/g, "''")}'`;
  }

  function sqliteCall(fn, args) {
    return new Promise((resolve, reject) => {
      try {
        fn(
          Object.assign({}, args || {}, {
            success: (res) => resolve(res),
            fail: (err) => reject(err),
          })
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  async function ensureSqliteReady() {
    if (_initPromise) return _initPromise;

    _initPromise = (async () => {
      await waitPlusReady();
      if (!hasPlusSqlite()) return false;

      try {
        const isOpen = window.plus.sqlite.isOpenDatabase({ name: DB_NAME, path: DB_PATH });
        if (!isOpen) {
          await sqliteCall(window.plus.sqlite.openDatabase, { name: DB_NAME, path: DB_PATH });
        }
      } catch (e) {
        // If openDatabase throws, treat as unavailable.
        return false;
      }

      try {
        await sqliteCall(window.plus.sqlite.executeSql, {
          name: DB_NAME,
          sql: `CREATE TABLE IF NOT EXISTS ${TABLE} (k TEXT PRIMARY KEY, v TEXT, t INTEGER);`,
        });
      } catch (e) {
        return false;
      }

      return true;
    })();

    return _initPromise;
  }

  async function sqliteAvailable() {
    try {
      return await ensureSqliteReady();
    } catch (e) {
      return false;
    }
  }

  async function sqliteSelect(sql) {
    await ensureSqliteReady();
    return sqliteCall(window.plus.sqlite.selectSql, { name: DB_NAME, sql });
  }

  async function sqliteExec(sql) {
    await ensureSqliteReady();
    return sqliteCall(window.plus.sqlite.executeSql, { name: DB_NAME, sql });
  }

  async function getRaw(key) {
    const k = String(key || '');
    if (!k) return null;

    // Prefer sqlite when available.
    if (await sqliteAvailable()) {
      try {
        const rows = await sqliteSelect(`SELECT v,t FROM ${TABLE} WHERE k=${sqlQuote(k)} LIMIT 1;`);
        const r = Array.isArray(rows) && rows[0] ? rows[0] : null;
        if (r && (r.v !== undefined || r.t !== undefined)) {
          return { v: r.v, t: Number(r.t) || 0 };
        }
        return null;
      } catch (e) {
        // fall through to localStorage
      }
    }

    // Fallback: localStorage
    try {
      const raw = localStorage.getItem(k);
      if (!raw) return null;
      // Best-effort timestamp: embedded payload.t preferred.
      const obj = JSON.parse(raw);
      const t = obj && typeof obj === 'object' ? Number(obj.t) || 0 : 0;
      return { v: raw, t };
    } catch (e) {
      return null;
    }
  }

  async function getJson(key) {
    try {
      const r = await getRaw(key);
      if (!r || !r.v) return null;
      const obj = JSON.parse(r.v);
      return obj;
    } catch (e) {
      return null;
    }
  }

  async function setRaw(key, value, t) {
    const k = String(key || '');
    if (!k) return;
    const v = String(value === undefined || value === null ? '' : value);
    const ts = Number(t || 0) || Date.now();

    if (await sqliteAvailable()) {
      try {
        await sqliteExec(
          `INSERT OR REPLACE INTO ${TABLE} (k,v,t) VALUES (${sqlQuote(k)},${sqlQuote(v)},${Math.floor(ts)});`
        );
        return;
      } catch (e) {
        // fall through to localStorage
      }
    }

    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }

  async function setJson(key, obj, t) {
    try {
      await setRaw(key, JSON.stringify(obj), t);
    } catch (e) {}
  }

  async function remove(key) {
    const k = String(key || '');
    if (!k) return;

    if (await sqliteAvailable()) {
      try {
        await sqliteExec(`DELETE FROM ${TABLE} WHERE k=${sqlQuote(k)};`);
      } catch (e) {}
    }

    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }

  async function prunePrefix(prefix, maxEntries) {
    const p = String(prefix || '');
    const maxN = Number(maxEntries || 0) || 0;
    if (!p || maxN <= 0) return;

    if (await sqliteAvailable()) {
      try {
        const rows = await sqliteSelect(
          `SELECT k FROM ${TABLE} WHERE k LIKE ${sqlQuote(p + '%')} ORDER BY t DESC;`
        );
        const keys = (Array.isArray(rows) ? rows : []).map((r) => (r ? r.k : '')).filter(Boolean);
        if (keys.length <= maxN) return;
        const toDelete = keys.slice(maxN);
        for (const k of toDelete) {
          try {
            await sqliteExec(`DELETE FROM ${TABLE} WHERE k=${sqlQuote(k)};`);
          } catch (e) {}
        }
        return;
      } catch (e) {
        // fall through
      }
    }

    // localStorage prune best-effort (web only): skip to avoid scanning huge storage.
  }

  window.McCache = {
    init: ensureSqliteReady,
    isSqliteAvailable: sqliteAvailable,
    getRaw,
    getJson,
    setRaw,
    setJson,
    remove,
    prunePrefix,
  };

  // Kick off init in background (won't throw in web).
  try { ensureSqliteReady(); } catch (e) {}
})();
