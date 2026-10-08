// In-memory stand-ins for the Apps Script services Code.gs uses, so the back end can be
// exercised with `node --test apps-script/test` before it is pasted into Google.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');

export const OWNER = 'tarekmoh123@gmail.com';
export const CLIENT_ID = '346856045589-hknka37ibqg74a2kmfdeqhfahi7cm3ap.apps.googleusercontent.com';
export const WORK_ID = '1mIchNegsG1Fz3rWndvQi6SGelmI3WYsG';

function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
}

class FakeSheet {
  constructor(name) { this.name = name; this.cells = []; this.formats = {}; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() { return this.cells.length; }
  getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, r.length), 0); }
  setFrozenRows(n) { this.frozen = n; }
  deleteRow(n) { this.cells.splice(n - 1, 1); }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(row, col, nr = 1, nc = 1) {
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < nr; r++) {
          const line = [];
          for (let c = 0; c < nc; c++) {
            const v = (sheet.cells[row - 1 + r] || [])[col - 1 + c];
            line.push(v === undefined ? '' : v);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        if (values.length !== nr || values.some((l) => l.length !== nc)) throw new Error('setValues: size mismatch');
        for (let r = 0; r < nr; r++) {
          while (sheet.cells.length < row + r) sheet.cells.push([]);
          for (let c = 0; c < nc; c++) {
            const fmt = sheet.formats[`${row + r}:${col + c}`];
            let v = values[r][c];
            // Mimic Sheets: without plain-text format, ISO dates and TRUE get converted.
            if (fmt !== '@' && typeof v === 'string' && (/^\d{4}-\d{2}-\d{2}T/.test(v) || v === 'TRUE')) v = { converted: v };
            sheet.cells[row - 1 + r][col - 1 + c] = v;
          }
        }
        return this;
      },
      setNumberFormat(f) {
        for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) sheet.formats[`${row + r}:${col + c}`] = f;
        return this;
      }
    };
  }
}

class FakeFolder {
  constructor(drive, name, parent) {
    this.drive = drive; this.id = 'fold_' + randomUUID().slice(0, 8); this.name = name;
    this.parent = parent; this.viewers = []; this.editors = [];
    drive.folders.set(this.id, this);
  }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getFoldersByName(n) { return iterator([...this.drive.folders.values()].filter((f) => f.parent === this && f.name === n)); }
  createFolder(n) { return new FakeFolder(this.drive, n, this); }
  getViewers() { return this.viewers.map((e) => ({ getEmail: () => e })); }
  getEditors() { return this.editors.map((e) => ({ getEmail: () => e })); }
  addViewer(e) {
    if (e.endsWith('@not-google.test')) throw new Error('Invalid argument: email');
    this.drive.shareCalls.push(['add', this.id, e]);
    this.viewers.push(e); return this;
  }
  removeViewer(e) { this.drive.shareCalls.push(['remove', this.id, e]); this.viewers = this.viewers.filter((v) => v !== e); return this; }
}

export function makeEnv() {
  const drive = { folders: new Map(), shareCalls: [] };
  const work = new FakeFolder(drive, 'Work', null);
  drive.folders.delete(work.id);
  work.id = WORK_ID;
  drive.folders.set(WORK_ID, work);

  const sheets = [new FakeSheet('Sheet1')];
  const ssFile = { id: 'ss_1', parents: [work], moveTo(f) { this.parents = [f]; }, getParents() { return iterator(this.parents); } };
  const ss = {
    name: 'Untitled spreadsheet',
    getId: () => ssFile.id,
    getName() { return this.name; },
    rename(n) { this.name = n; },
    getSheets: () => sheets.slice(),
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet(n) { const s = new FakeSheet(n); sheets.push(s); return s; },
    deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); }
  };

  const props = new Map();
  const cache = new Map();
  const tokens = new Map(); // id_token -> tokeninfo JSON (or a number = HTTP error code)
  const fetches = [];
  const logs = [];

  const context = {
    console: { log() {}, warn: (m) => logs.push(['warn', m]), error: (m) => logs.push(['error', m]) },
    Logger: { log: (m) => logs.push(['log', m]) },
    JSON, Date, Math, Object, Array, String, Number, Error, RegExp,
    encodeURIComponent, decodeURIComponent,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    DriveApp: {
      getFolderById(id) { const f = drive.folders.get(id); if (!f) throw new Error('No item with the given ID'); return f; },
      getFileById(id) { if (id !== ssFile.id) throw new Error('No file'); return ssFile; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); return e && e.until > Date.now() ? e.v : null; },
        put: (k, v, ttl) => { if (k.length > 250) throw new Error('key too long'); cache.set(k, { v, until: Date.now() + ttl * 1000 }); }
      })
    },
    UrlFetchApp: {
      fetch(url) {
        fetches.push(url);
        const tok = decodeURIComponent(url.split('id_token=')[1]);
        const info = tokens.get(tok);
        const code = info === undefined ? 400 : typeof info === 'number' ? info : 200;
        return { getResponseCode: () => code, getContentText: () => (code === 200 ? JSON.stringify(info) : '{"error":"invalid_token"}') };
      }
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...createHash(alg).update(s, 'utf8').digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url')
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => OWNER }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => ({ content: s, mime: null, setMimeType(m) { this.mime = m; return this; } })
    }
  };
  vm.createContext(context);
  vm.runInContext(CODE, context, { filename: 'Code.gs' });

  let n = 0;
  /** Register a valid Google token for `email` and return it. */
  function token(email, extra = {}) {
    const t = `tok_${++n}_${'x'.repeat(30)}`;
    tokens.set(t, {
      aud: CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true',
      name: email.split('@')[0], picture: `https://pic/${email}`,
      exp: String(Math.floor(Date.now() / 1000) + 3600), ...extra
    });
    return t;
  }

  /** POST like the browser does; returns the parsed {ok, data | error, code}. */
  function call(action, idToken, args = {}) {
    const out = context.doPost({ postData: { contents: JSON.stringify({ action, idToken, ...args }) } });
    if (out.mime !== 'application/json') throw new Error('response is not JSON');
    return JSON.parse(out.content);
  }

  /** Read a tab back as objects (what is really in the Sheet). */
  function rows(tab) {
    const s = ss.getSheetByName(tab);
    const [head, ...rest] = s.cells;
    return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }

  return { context, ss, sheets, ssFile, drive, work, props, cache, tokens, fetches, logs, token, call, rows };
}
