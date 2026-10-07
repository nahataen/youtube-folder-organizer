/* Carpetas YouTube — service worker con SQLite (background.js).
 * sql.js (SQLite compilado a WebAssembly, en vendor/sqljs) guarda la lista
 * de suscripciones en una BD real: tabla subscriptions + tabla meta.
 * La BD vive en memoria y persiste en chrome.storage.local como bytes
 * (clave ytSubsDbV1); al despertar se restaura (o migra la antigua
 * ytSubsFeedV1 una vez). Lógica tonta a propósito: el content-script decide
 * frescura; aquí solo all / replace / clear / export. */

importScripts('vendor/sqljs/sql-wasm.js');

const DB_KEY = 'ytSubsDbV1';
const LEGACY_KEY = 'ytSubsFeedV1';
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subscriptions (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL DEFAULT ''
  );`;

let SQLLib = null;
let db = null;
let saveTimer = 0;

async function ensureDb() {
  if (db) return db;
  if (!SQLLib) {
    SQLLib = await self.initSqlJs({
      locateFile: (f) => chrome.runtime.getURL('vendor/sqljs/' + f)
    });
  }
  db = new SQLLib.Database();
  db.exec(SCHEMA);
  // Restaura la BD persistida; si se corrompe, se parte de cero.
  try {
    const data = await chrome.storage.local.get(DB_KEY);
    const bytes = data[DB_KEY];
    if (Array.isArray(bytes) && bytes.length > 0) {
      db.close();
      db = new SQLLib.Database(new Uint8Array(bytes));
      db.exec(SCHEMA); // por si el esquema creció entre versiones
    } else {
      await migrateLegacy();
    }
  } catch {
    // Sin almacenamiento o bytes rotos: BD vacía en memoria.
  }
  return db;
}

// Una sola vez: la antigua caché JSON a SQLite (y se borra la vieja clave).
async function migrateLegacy() {
  try {
    const data = await chrome.storage.local.get(LEGACY_KEY);
    const stored = data[LEGACY_KEY];
    if (stored && Array.isArray(stored.subs) && stored.subs.length > 0) {
      writeReplace(stored.subs);
      writeMeta('saved_at', String(stored.at || Date.now()));
      await persistNow();
      await chrome.storage.local.remove(LEGACY_KEY);
    }
  } catch {
    // Sin legado que migrar.
  }
}

function cleanStr(v, max = 500) {
  return String(v ?? '').slice(0, max);
}

function readAll() {
  const stmt = db.prepare('SELECT key, name, url, avatar, detail FROM subscriptions ORDER BY rowid');
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function writeReplace(rows) {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM subscriptions');
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO subscriptions (key, name, url, avatar, detail) VALUES (?, ?, ?, ?, ?)'
    );
    for (const r of rows) {
      if (!r || typeof r.key !== 'string' || !r.key) continue;
      stmt.run([r.key, cleanStr(r.name, 80), cleanStr(r.url), cleanStr(r.avatar, 2000), cleanStr(r.detail, 200)]);
    }
    stmt.free();
    const now = Date.now();
    const m = db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('saved_at', ?)");
    m.run([String(now)]);
    m.free();
    db.exec('COMMIT');
  } catch {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Nada que revertir.
    }
    throw new Error('write');
  }
}

function readMeta(k) {
  const stmt = db.prepare('SELECT v FROM meta WHERE k = ?');
  stmt.bind([k]);
  const v = stmt.step() ? stmt.getAsObject().v : '';
  stmt.free();
  return v;
}

function writeMeta(k, v) {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)');
  stmt.run([k, String(v)]);
  stmt.free();
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistNow().catch(() => {});
  }, 800);
}

async function persistNow() {
  if (!db) return;
  await chrome.storage.local.set({ [DB_KEY]: Array.from(db.export()) });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.scope !== 'ytcf-subsdb') return false;
  (async () => {
    try {
      await ensureDb();
      switch (msg.op) {
        case 'all':
          sendResponse({ ok: true, rows: readAll(), savedAt: Number(readMeta('saved_at') || 0) });
          break;
        case 'replace':
          writeReplace(Array.isArray(msg.rows) ? msg.rows : []);
          schedulePersist();
          sendResponse({ ok: true });
          break;
        case 'clear':
          db.exec('DELETE FROM subscriptions');
          writeMeta('saved_at', '0');
          schedulePersist();
          sendResponse({ ok: true });
          break;
        case 'export':
          sendResponse({ ok: true, bytes: Array.from(db.export()) });
          break;
        default:
          sendResponse({ ok: false, error: 'op' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});

// Al suspender, intenta dejar la BD guardada (mejor esfuerzo).
chrome.runtime.onSuspend?.addListener(() => {
  persistNow().catch(() => {});
});
