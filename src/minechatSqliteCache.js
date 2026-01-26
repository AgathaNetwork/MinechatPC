const fs = require('fs');
const path = require('path');

function safeMkdirp(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function safeReadFileBuffer(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function safeWriteFileBuffer(filePath, buf) {
  try {
    safeMkdirp(path.dirname(filePath));
    fs.writeFileSync(filePath, buf);
    return true;
  } catch {
    return false;
  }
}

function createMutex() {
  let last = Promise.resolve();
  return async (fn) => {
    const run = last.then(fn, fn);
    // Keep chain alive even if fn throws.
    last = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

async function createMinechatSqliteCache({ dbFilePath }) {
  if (!dbFilePath) throw new Error('dbFilePath_required');

  // Use sql.js (WASM) to avoid native module rebuild issues in Electron.
  const initSqlJs = require('sql.js');
  const wasmPath = (() => {
    try {
      return require.resolve('sql.js/dist/sql-wasm.wasm');
    } catch {
      return '';
    }
  })();
  const wasmDir = wasmPath ? path.dirname(wasmPath) : '';

  const SQL = await initSqlJs({
    locateFile: (file) => {
      try {
        if (wasmDir) return path.join(wasmDir, file);
      } catch {}
      return file;
    }
  });

  const mutex = createMutex();

  let db = null;

  function ensureDb() {
    if (db) return db;

    const buf = safeReadFileBuffer(dbFilePath);
    if (buf && buf.length) {
      db = new SQL.Database(new Uint8Array(buf));
    } else {
      db = new SQL.Database();
    }

    db.run(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        chat_id TEXT NOT NULL,
        id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY(chat_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat_idx ON messages(chat_id, idx);
    `);

    return db;
  }

  function persist() {
    try {
      if (!db) return;
      const data = db.export();
      safeWriteFileBuffer(dbFilePath, Buffer.from(data));
    } catch {
      // ignore
    }
  }

  function parseRowsToObjects(stmt, mapper) {
    const out = [];
    try {
      while (stmt.step()) {
        const row = stmt.getAsObject();
        out.push(mapper ? mapper(row) : row);
      }
    } finally {
      try { stmt.free(); } catch {}
    }
    return out;
  }

  async function getChats() {
    return mutex(async () => {
      const d = ensureDb();
      const stmt = d.prepare('SELECT json FROM chats ORDER BY updated_at_ms DESC');
      const rows = parseRowsToObjects(stmt, (r) => r.json);
      const chats = [];
      for (const raw of rows) {
        try {
          const obj = JSON.parse(String(raw || 'null'));
          if (obj && typeof obj === 'object') chats.push(obj);
        } catch {
          // ignore
        }
      }
      return chats;
    });
  }

  async function setChats(chatList) {
    return mutex(async () => {
      const d = ensureDb();
      const now = Date.now();
      const list = Array.isArray(chatList) ? chatList : [];

      d.run('BEGIN');
      try {
        d.run('DELETE FROM chats');
        const ins = d.prepare('INSERT OR REPLACE INTO chats(id, json, updated_at_ms) VALUES(?,?,?)');
        try {
          for (const c of list) {
            if (!c || c.id === undefined || c.id === null) continue;
            const id = String(c.id);
            ins.run([id, JSON.stringify(c), now]);
          }
        } finally {
          try { ins.free(); } catch {}
        }
        d.run('COMMIT');
      } catch (e) {
        try { d.run('ROLLBACK'); } catch {}
        throw e;
      }

      persist();
      return { ok: true, count: list.length };
    });
  }

  async function getMessages(chatId) {
    return mutex(async () => {
      const d = ensureDb();
      const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
      if (!cid) return [];
      const stmt = d.prepare('SELECT json FROM messages WHERE chat_id = ? ORDER BY idx ASC');
      stmt.bind([cid]);
      const rows = parseRowsToObjects(stmt, (r) => r.json);
      const msgs = [];
      for (const raw of rows) {
        try {
          const obj = JSON.parse(String(raw || 'null'));
          if (obj && typeof obj === 'object') msgs.push(obj);
        } catch {
          // ignore
        }
      }
      return msgs;
    });
  }

  async function setMessages(chatId, messageList) {
    return mutex(async () => {
      const d = ensureDb();
      const cid = chatId !== undefined && chatId !== null ? String(chatId) : '';
      if (!cid) return { ok: false, error: 'chatId_required' };
      const now = Date.now();
      const list = Array.isArray(messageList) ? messageList : [];

      d.run('BEGIN');
      try {
        d.run('DELETE FROM messages WHERE chat_id = ?', [cid]);
        const ins = d.prepare(
          'INSERT OR REPLACE INTO messages(chat_id, id, idx, json, updated_at_ms) VALUES(?,?,?,?,?)'
        );
        try {
          let idx = 0;
          for (const m of list) {
            if (!m || m.id === undefined || m.id === null) {
              idx += 1;
              continue;
            }
            const mid = String(m.id);
            ins.run([cid, mid, idx, JSON.stringify(m), now]);
            idx += 1;
          }
        } finally {
          try { ins.free(); } catch {}
        }
        d.run('COMMIT');
      } catch (e) {
        try { d.run('ROLLBACK'); } catch {}
        throw e;
      }

      persist();
      return { ok: true, count: list.length };
    });
  }

  async function clearAll() {
    return mutex(async () => {
      const d = ensureDb();
      d.run('BEGIN');
      try {
        d.run('DELETE FROM messages');
        d.run('DELETE FROM chats');
        d.run('COMMIT');
      } catch (e) {
        try { d.run('ROLLBACK'); } catch {}
        throw e;
      }
      persist();
      return { ok: true };
    });
  }

  async function close() {
    return mutex(async () => {
      try { persist(); } catch {}
      try {
        if (db) db.close();
      } catch {}
      db = null;
      return { ok: true };
    });
  }

  return {
    getChats,
    setChats,
    getMessages,
    setMessages,
    clearAll,
    close
  };
}

module.exports = {
  createMinechatSqliteCache
};
