/**
 * ETaske Team — back end (Google Apps Script, bound to the data Sheet).
 *
 * Part 1: setup, sign-in check, users + approval, projects, members, Drive folders.
 * Part 2: messages, tasks, daily updates, uploads, sync, reads.
 *
 * The full design is docs/DESIGN.md in the repo. Every call is
 *   POST <web app URL>   body (text/plain): {"action": "...", "idToken": "...", ...args}
 * and every answer is {ok: true, data} or {ok: false, error, code}.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

var SCHEMA_VERSION = '1';

/** Drive folder "Work" that holds everything (owned by Tariq). */
var WORK_FOLDER_ID = '1mIchNegsG1Fz3rWndvQi6SGelmI3WYsG';
var ROOT_FOLDER_NAME = 'ETaske Team';
var PROJECTS_FOLDER_NAME = 'Projects';
var SPREADSHEET_NAME = 'ETaske Team — data';

/** Used by setup() only when the Script Property is not set yet. Both are public values. */
var DEFAULT_GOOGLE_CLIENT_ID = '346856045589-hknka37ibqg74a2kmfdeqhfahi7cm3ap.apps.googleusercontent.com';
var DEFAULT_ADMIN_EMAILS = 'tarekmoh123@gmail.com';

/** One tab per record type; the header row is the column order. */
var TABLES = {
  users: ['email', 'name', 'photoUrl', 'role', 'status', 'createdAt', 'approvedBy', 'lastSeenAt'],
  projects: ['id', 'name', 'description', 'folderId', 'createdBy', 'createdAt', 'archived'],
  members: ['projectId', 'email', 'role', 'addedBy', 'addedAt'],
  messages: ['id', 'projectId', 'authorEmail', 'text', 'mentions', 'replyToId', 'fileIds', 'taskId', 'createdAt', 'editedAt', 'deleted', 'kind'],
  tasks: ['id', 'projectId', 'serial', 'title', 'details', 'assigneeEmail', 'createdBy', 'status', 'percent', 'priority', 'dueDate', 'createdAt', 'updatedAt', 'doneAt'],
  updates: ['id', 'projectId', 'authorEmail', 'date', 'done', 'remaining', 'blockers', 'taskIds', 'fileIds', 'createdAt', 'updatedAt'],
  files: ['id', 'projectId', 'name', 'mimeType', 'size', 'uploaderEmail', 'messageId', 'updateId', 'createdAt'],
  reads: ['email', 'projectId', 'lastReadAt'],
  meta: ['key', 'value']
};

var USER_ROLES = ['admin', 'member'];
var USER_STATUSES = ['pending', 'approved', 'blocked'];
var MEMBER_ROLES = ['lead', 'member'];

var TASK_STATUSES = ['todo', 'doing', 'blocked', 'done'];
var TASK_PRIORITIES = ['low', 'normal', 'high'];

var MAX_NAME = 100;
var MAX_DESCRIPTION = 2000;
var MAX_TEXT = 4000;
var MAX_TITLE = 200;
var MAX_FILE_NAME = 200;
var MAX_LIST = 20;           // files / tasks attached to one message or update
var MAX_MENTIONS = 50;
var MAX_UPLOAD_CHARS = 20 * 1024 * 1024;  // base64 text, i.e. ~15 MB of file
var MESSAGE_PAGE = 200;      // messages in a first sync / one listMessages page
var UPDATE_DAYS = 30;        // days of daily updates in a first sync
var SYNC_OVERLAP_MS = 30000; // re-send the last 30 s so a row saved during a sync is never missed
var LAST_SEEN_EVERY_MS = 5 * 60 * 1000;
var LOCK_WAIT_MS = 20000;

// ---------------------------------------------------------------------------
// setup() — run once by hand from the script editor. Safe to run again.
// ---------------------------------------------------------------------------

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this script from the data Sheet (Extensions → Apps Script) and run setup again.');
  var props = PropertiesService.getScriptProperties();

  var work = DriveApp.getFolderById(WORK_FOLDER_ID);
  var root = folderById_(props.getProperty('ROOT_FOLDER_ID')) || childFolder_(work, ROOT_FOLDER_NAME);
  var projects = folderById_(props.getProperty('PROJECTS_FOLDER_ID')) || childFolder_(root, PROJECTS_FOLDER_NAME);

  var file = DriveApp.getFileById(ss.getId());
  if (!hasParent_(file, root.getId())) file.moveTo(root);
  if (ss.getName() !== SPREADSHEET_NAME) ss.rename(SPREADSHEET_NAME);

  Object.keys(TABLES).forEach(function (name) { ensureTab_(ss, name, TABLES[name]); });
  var spare = ss.getSheetByName('Sheet1');
  if (spare && ss.getSheets().length > 1 && spare.getLastRow() === 0) ss.deleteSheet(spare);

  props.setProperty('ROOT_FOLDER_ID', root.getId());
  props.setProperty('PROJECTS_FOLDER_ID', projects.getId());
  if (!props.getProperty('GOOGLE_CLIENT_ID')) props.setProperty('GOOGLE_CLIENT_ID', DEFAULT_GOOGLE_CLIENT_ID);
  if (!props.getProperty('ADMIN_EMAILS')) props.setProperty('ADMIN_EMAILS', DEFAULT_ADMIN_EMAILS);
  setMeta_('schemaVersion', SCHEMA_VERSION);

  var summary = {
    rootFolderId: root.getId(),
    projectsFolderId: projects.getId(),
    spreadsheetId: ss.getId(),
    tabs: Object.keys(TABLES),
    adminEmails: props.getProperty('ADMIN_EMAILS')
  };
  Logger.log('ETaske Team setup finished: ' + JSON.stringify(summary));
  return summary;
}

function ensureTab_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sheet.getLastRow() >= 1
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String)
    : [];
  // Add any missing columns at the end; never reorder or delete existing ones.
  var missing = headers.filter(function (h) { return current.indexOf(h) === -1; });
  if (missing.length) {
    var all = current.concat(missing);
    sheet.getRange(1, 1, 1, all.length).setNumberFormat('@').setValues([all]);
  }
  sheet.setFrozenRows(1);
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function folderById_(id) {
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

function hasParent_(file, folderId) {
  var it = file.getParents();
  while (it.hasNext()) if (it.next().getId() === folderId) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Web entry points
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, data: { service: 'ETaske Team', schemaVersion: SCHEMA_VERSION } });
}

function doPost(e) {
  try {
    var body;
    try { body = JSON.parse((e && e.postData && e.postData.contents) || ''); } catch (err) { body = null; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError_('BAD_REQUEST', 'Body must be a JSON object.');
    return json_({ ok: true, data: handle_(body) });
  } catch (err) {
    if (err && err.apiCode) return json_({ ok: false, error: err.message, code: err.apiCode });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'Something went wrong on the server.', code: 'INTERNAL' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message) {
  var err = new Error(message);
  err.apiCode = code;
  return err;
}

/**
 * Action table. `who`:
 *   any      — any verified Google account (pending and blocked too)
 *   approved — approved users
 *   admin    — approved admins
 * Project-level checks (member / lead) happen inside the handler.
 * `write: true` runs the handler under the script lock.
 */
var ACTIONS = {
  me: { who: 'any', write: true, fn: actionMe_ },
  listUsers: { who: 'admin', fn: actionListUsers_ },
  setUserStatus: { who: 'admin', write: true, fn: actionSetUserStatus_ },
  setUserRole: { who: 'admin', write: true, fn: actionSetUserRole_ },
  listProjects: { who: 'approved', fn: actionListProjects_ },
  createProject: { who: 'admin', write: true, fn: actionCreateProject_ },
  updateProject: { who: 'admin', write: true, fn: actionUpdateProject_ },
  archiveProject: { who: 'admin', write: true, fn: actionArchiveProject_ },
  listMembers: { who: 'approved', fn: actionListMembers_ },
  addMember: { who: 'approved', write: true, fn: actionAddMember_ },
  removeMember: { who: 'approved', write: true, fn: actionRemoveMember_ },
  sync: { who: 'approved', fn: actionSync_ },
  listMessages: { who: 'approved', fn: actionListMessages_ },
  postMessage: { who: 'approved', write: true, fn: actionPostMessage_ },
  editMessage: { who: 'approved', write: true, fn: actionEditMessage_ },
  deleteMessage: { who: 'approved', write: true, fn: actionDeleteMessage_ },
  createTask: { who: 'approved', write: true, fn: actionCreateTask_ },
  updateTask: { who: 'approved', write: true, fn: actionUpdateTask_ },
  postUpdate: { who: 'approved', write: true, fn: actionPostUpdate_ },
  // Not `write`: the Drive upload runs outside the lock; only the Sheet row is written under it.
  uploadFile: { who: 'approved', fn: actionUploadFile_ },
  markRead: { who: 'approved', write: true, fn: actionMarkRead_ }
};

function handle_(body) {
  var action = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
  if (!action) throw apiError_('BAD_REQUEST', 'Unknown action.');
  var identity = verifyIdToken_(body.idToken);

  var run = function () {
    resetMemo_();
    var ctx = context_(identity);
    if (action.who !== 'any') {
      if (!ctx.user || ctx.user.status === 'pending') throw apiError_('PENDING', 'Your account is waiting for admin approval.');
      if (ctx.user.status !== 'approved') throw apiError_('BLOCKED', 'Your account has been blocked.');
      if (action.who === 'admin' && !ctx.isAdmin) throw apiError_('FORBIDDEN', 'Admins only.');
    }
    return action.fn(ctx, body);
  };
  return action.write ? withLock_(run) : run();
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw apiError_('BUSY', 'The server is busy. Please try again.');
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------------------
// Sign-in: Google ID token check (cached for the token's remaining life)
// ---------------------------------------------------------------------------

var TOKEN_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

function verifyIdToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) {
    throw apiError_('UNAUTHENTICATED', 'Please sign in.');
  }
  var cache = CacheService.getScriptCache();
  var key = 'tok:' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8));
  var hit = cache.get(key);
  if (hit) {
    var cached = JSON.parse(hit);
    if (cached.exp * 1000 > Date.now()) return cached;
  }

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw apiError_('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');
  var info = JSON.parse(res.getContentText());

  var clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  var exp = Number(info.exp);
  var nowSec = Math.floor(Date.now() / 1000);
  if (!clientId || info.aud !== clientId) throw apiError_('UNAUTHENTICATED', 'This sign-in is not for this app.');
  if (TOKEN_ISSUERS.indexOf(info.iss) === -1) throw apiError_('UNAUTHENTICATED', 'This sign-in is not from Google.');
  if (String(info.email_verified) !== 'true' || !info.email) throw apiError_('UNAUTHENTICATED', 'Your Google e-mail is not verified.');
  if (!(exp > nowSec)) throw apiError_('UNAUTHENTICATED', 'Your sign-in has expired. Please sign in again.');

  var identity = {
    email: normEmail_(info.email),
    name: String(info.name || '').slice(0, MAX_NAME),
    picture: String(info.picture || ''),
    exp: exp
  };
  var ttl = Math.min(exp - nowSec, 21600);
  if (ttl > 0) cache.put(key, JSON.stringify(identity), ttl);
  return identity;
}

function context_(identity) {
  var user = findUser_(identity.email);
  var isAdmin = !!user && user.status === 'approved' && user.role === 'admin';
  return { email: identity.email, identity: identity, user: user, isAdmin: isAdmin };
}

function adminEmails_() {
  var raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  return raw.split(',').map(normEmail_).filter(Boolean);
}

function isFixedAdmin_(email) {
  return adminEmails_().indexOf(normEmail_(email)) !== -1;
}

// ---------------------------------------------------------------------------
// Sheet access. Everything is stored as plain text; rows are objects keyed by header.
// ---------------------------------------------------------------------------

var memo_ = {};
function resetMemo_() { memo_ = {}; }

function table_(name) {
  if (memo_[name]) return memo_[name];
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '" — run setup().');
  var values = sheet.getDataRange().getValues();
  var headers = (values[0] || []).map(String);
  TABLES[name].forEach(function (h) {
    if (headers.indexOf(h) === -1) throw new Error('Tab "' + name + '" has no column "' + h + '" — run setup().');
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 };
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[r][c] === null || values[r][c] === undefined ? '' : unguard_(String(values[r][c]));
    rows.push(obj);
  }
  memo_[name] = { sheet: sheet, headers: headers, rows: rows };
  return memo_[name];
}

function rowValues_(t, obj) {
  return t.headers.map(function (h) {
    var v = obj[h];
    return v === null || v === undefined ? '' : guard_(String(v));
  });
}

/**
 * Typed text such as "=IMPORTDATA(...)" must never become a live formula in Tariq's Sheet.
 * An invisible zero-width space in front keeps it as text (Sheets leaves that character
 * alone, unlike a leading apostrophe); it is taken off again when the row is read.
 */
var GUARD_MARK = '​';
var GUARD_NEEDED_RE = /^[=+\-​]/;
function guard_(s) { return GUARD_NEEDED_RE.test(s) ? GUARD_MARK + s : s; }
function unguard_(s) { return s.charAt(0) === GUARD_MARK ? s.slice(1) : s; }

function insertRow_(name, obj) {
  var t = table_(name);
  var rowNum = t.sheet.getLastRow() + 1;
  t.sheet.getRange(rowNum, 1, 1, t.headers.length).setNumberFormat('@').setValues([rowValues_(t, obj)]);
  var stored = { _row: rowNum };
  t.headers.forEach(function (h) { stored[h] = obj[h] === null || obj[h] === undefined ? '' : String(obj[h]); });
  t.rows.push(stored);
  return stored;
}

function saveRow_(name, row, changes) {
  var t = table_(name);
  Object.keys(changes).forEach(function (k) { row[k] = changes[k] === null || changes[k] === undefined ? '' : String(changes[k]); });
  t.sheet.getRange(row._row, 1, 1, t.headers.length).setNumberFormat('@').setValues([rowValues_(t, row)]);
  return row;
}

function deleteRow_(name, row) {
  var t = table_(name);
  t.sheet.deleteRow(row._row);
  t.rows = t.rows.filter(function (r) { return r !== row; });
  t.rows.forEach(function (r) { if (r._row > row._row) r._row -= 1; });
}

function setMeta_(key, value) {
  resetMemo_();
  var row = table_('meta').rows.filter(function (r) { return r.key === key; })[0];
  if (row) saveRow_('meta', row, { value: value });
  else insertRow_('meta', { key: key, value: value });
}

function findUser_(email) {
  email = normEmail_(email);
  return table_('users').rows.filter(function (r) { return normEmail_(r.email) === email; })[0] || null;
}

function findProject_(id) {
  return table_('projects').rows.filter(function (r) { return r.id === id; })[0] || null;
}

function findMember_(projectId, email) {
  email = normEmail_(email);
  return table_('members').rows.filter(function (r) {
    return r.projectId === projectId && normEmail_(r.email) === email;
  })[0] || null;
}

function now_() { return new Date().toISOString(); }

function normEmail_(s) { return String(s || '').trim().toLowerCase(); }

function strip_(row) {
  var out = {};
  Object.keys(row).forEach(function (k) { if (k !== '_row') out[k] = row[k]; });
  return out;
}

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

var EMAIL_RE = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function argEmail_(body, key) {
  var v = normEmail_(body[key]);
  if (!EMAIL_RE.test(v) || v.length > 254) throw apiError_('BAD_REQUEST', 'A valid e-mail is required.');
  return v;
}

function argText_(body, key, max, required) {
  var v = body[key];
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw apiError_('BAD_REQUEST', '"' + key + '" must be text.');
  v = v.trim();
  if (required && !v) throw apiError_('BAD_REQUEST', '"' + key + '" is required.');
  if (v.length > max) throw apiError_('BAD_REQUEST', '"' + key + '" is too long (max ' + max + ').');
  return v;
}

function argEnum_(body, key, allowed) {
  var v = body[key];
  if (allowed.indexOf(v) === -1) throw apiError_('BAD_REQUEST', '"' + key + '" must be one of: ' + allowed.join(', ') + '.');
  return v;
}

function argProject_(body) {
  var id = body.projectId;
  if (typeof id !== 'string' || !id) throw apiError_('BAD_REQUEST', '"projectId" is required.');
  var p = findProject_(id);
  if (!p) throw apiError_('NOT_FOUND', 'Project not found.');
  return p;
}

/** Throws unless the caller may see this project (admin, or a member of it). */
function requireProjectAccess_(ctx, project) {
  if (ctx.isAdmin) return;
  if (!findMember_(project.id, ctx.email)) throw apiError_('NOT_FOUND', 'Project not found.');
}

/** Admins manage every project; a project lead manages their own. */
function canManageProject_(ctx, project) {
  if (ctx.isAdmin) return true;
  var m = findMember_(project.id, ctx.email);
  return !!m && m.role === 'lead';
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

function publicUser_(u) {
  return {
    email: u.email, name: u.name, photoUrl: u.photoUrl, role: u.role, status: u.status,
    createdAt: u.createdAt, approvedBy: u.approvedBy, lastSeenAt: u.lastSeenAt
  };
}

function actionMe_(ctx) {
  var id = ctx.identity;
  var fixedAdmin = isFixedAdmin_(id.email);
  var user = ctx.user;
  var now = now_();

  if (!user) {
    user = insertRow_('users', {
      email: id.email, name: id.name, photoUrl: id.picture,
      role: fixedAdmin ? 'admin' : 'member',
      status: fixedAdmin ? 'approved' : 'pending',
      createdAt: now, approvedBy: fixedAdmin ? 'setup' : '', lastSeenAt: now
    });
  } else {
    var changes = {};
    if (fixedAdmin && (user.role !== 'admin' || user.status !== 'approved')) {
      changes.role = 'admin'; changes.status = 'approved';
      if (!user.approvedBy) changes.approvedBy = 'setup';
    }
    if (id.name && id.name !== user.name) changes.name = id.name;
    if (id.picture && id.picture !== user.photoUrl) changes.photoUrl = id.picture;
    var seen = Date.parse(user.lastSeenAt);
    if (!(seen > Date.now() - LAST_SEEN_EVERY_MS)) changes.lastSeenAt = now;
    if (Object.keys(changes).length) saveRow_('users', user, changes);
  }
  return publicUser_(user);
}

function actionListUsers_() {
  return table_('users').rows.map(publicUser_);
}

function actionSetUserStatus_(ctx, body) {
  var email = argEmail_(body, 'email');
  var status = argEnum_(body, 'status', USER_STATUSES);
  var user = findUser_(email);
  if (!user) throw apiError_('NOT_FOUND', 'No such user.');
  if (status !== 'approved' && (email === ctx.email || isFixedAdmin_(email))) {
    throw apiError_('FORBIDDEN', 'This admin cannot be blocked or set back to pending.');
  }
  if (user.status === status) return publicUser_(user);

  var changes = { status: status };
  if (status === 'approved') changes.approvedBy = ctx.email;
  saveRow_('users', user, changes);

  // Drive access follows approval: blocked/pending people lose view access to their
  // project folders; approving them again gives it back.
  var warnings = [];
  table_('members').rows.forEach(function (m) {
    if (normEmail_(m.email) !== email) return;
    var p = findProject_(m.projectId);
    if (!p || !p.folderId) return;
    var w = status === 'approved' ? shareFolder_(p.folderId, email) : unshareFolder_(p.folderId, email);
    if (w) warnings.push(w);
  });
  var out = publicUser_(user);
  if (warnings.length) out.warnings = warnings;
  return out;
}

function actionSetUserRole_(ctx, body) {
  var email = argEmail_(body, 'email');
  var role = argEnum_(body, 'role', USER_ROLES);
  var user = findUser_(email);
  if (!user) throw apiError_('NOT_FOUND', 'No such user.');
  if (role !== 'admin' && (email === ctx.email || isFixedAdmin_(email))) {
    throw apiError_('FORBIDDEN', 'This admin cannot be changed to a member.');
  }
  if (role === 'admin' && user.status !== 'approved') {
    throw apiError_('BAD_REQUEST', 'Approve this person before making them an admin.');
  }
  if (user.role !== role) saveRow_('users', user, { role: role });
  return publicUser_(user);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function projectFolderName_(name, id) {
  return name.replace(/[\\/]/g, '-') + ' (' + id.slice(0, 8) + ')';
}

function actionListProjects_(ctx, body) {
  var includeArchived = !!body.includeArchived && ctx.isAdmin;
  var members = table_('members').rows;
  var mine = {};
  var counts = {};
  members.forEach(function (m) {
    counts[m.projectId] = (counts[m.projectId] || 0) + 1;
    if (normEmail_(m.email) === ctx.email) mine[m.projectId] = m.role;
  });

  var lastRead = {};
  table_('reads').rows.forEach(function (r) {
    if (normEmail_(r.email) === ctx.email) lastRead[r.projectId] = r.lastReadAt;
  });
  var unread = {};
  var lastActivity = {};
  table_('messages').rows.forEach(function (msg) {
    if (msg.deleted === 'TRUE') return;
    if (!lastActivity[msg.projectId] || msg.createdAt > lastActivity[msg.projectId]) lastActivity[msg.projectId] = msg.createdAt;
    if (normEmail_(msg.authorEmail) === ctx.email) return;
    if (msg.createdAt > (lastRead[msg.projectId] || '')) unread[msg.projectId] = (unread[msg.projectId] || 0) + 1;
  });

  return table_('projects').rows
    .filter(function (p) {
      if (p.archived === 'TRUE' && !includeArchived) return false;
      return ctx.isAdmin || Object.prototype.hasOwnProperty.call(mine, p.id);
    })
    .map(function (p) {
      var out = strip_(p);
      out.archived = p.archived === 'TRUE';
      out.myRole = mine[p.id] || null;
      out.memberCount = counts[p.id] || 0;
      out.unread = unread[p.id] || 0;
      out.lastActivityAt = lastActivity[p.id] || p.createdAt;
      return out;
    });
}

function actionCreateProject_(ctx, body) {
  var name = argText_(body, 'name', MAX_NAME, true);
  var description = argText_(body, 'description', MAX_DESCRIPTION, false);
  var clash = table_('projects').rows.filter(function (p) {
    return p.archived !== 'TRUE' && p.name.toLowerCase() === name.toLowerCase();
  })[0];
  if (clash) throw apiError_('CONFLICT', 'A project with this name already exists.');

  var id = Utilities.getUuid();
  var parent = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PROJECTS_FOLDER_ID'));
  var folder = parent.createFolder(projectFolderName_(name, id));
  var now = now_();
  var project = insertRow_('projects', {
    id: id, name: name, description: description, folderId: folder.getId(),
    createdBy: ctx.email, createdAt: now, archived: ''
  });
  // The admin who creates a project leads it, so it shows in their chat/mention lists.
  insertRow_('members', { projectId: id, email: ctx.email, role: 'lead', addedBy: ctx.email, addedAt: now });
  var w = shareFolder_(folder.getId(), ctx.email);

  var out = strip_(project);
  out.archived = false;
  out.myRole = 'lead';
  out.memberCount = 1;
  out.unread = 0;
  out.lastActivityAt = now;
  if (w) out.warnings = [w];
  return out;
}

function actionUpdateProject_(ctx, body) {
  var project = argProject_(body);
  var changes = {};
  if (body.name !== undefined) {
    var name = argText_(body, 'name', MAX_NAME, true);
    var clash = table_('projects').rows.filter(function (p) {
      return p.id !== project.id && p.archived !== 'TRUE' && p.name.toLowerCase() === name.toLowerCase();
    })[0];
    if (clash) throw apiError_('CONFLICT', 'A project with this name already exists.');
    if (name !== project.name) changes.name = name;
  }
  if (body.description !== undefined) changes.description = argText_(body, 'description', MAX_DESCRIPTION, false);
  if (!Object.keys(changes).length) return strip_(project);

  saveRow_('projects', project, changes);
  if (changes.name && project.folderId) {
    try { DriveApp.getFolderById(project.folderId).setName(projectFolderName_(changes.name, project.id)); }
    catch (e) { console.warn('Folder rename failed for ' + project.id + ': ' + e); }
  }
  var out = strip_(project);
  out.archived = project.archived === 'TRUE';
  return out;
}

function actionArchiveProject_(ctx, body) {
  var project = argProject_(body);
  var archived = body.archived !== false;
  saveRow_('projects', project, { archived: archived ? 'TRUE' : '' });
  var out = strip_(project);
  out.archived = archived;
  return out;
}

// ---------------------------------------------------------------------------
// Members (+ view access to the project's Drive folder)
// ---------------------------------------------------------------------------

function memberView_(m) {
  var u = findUser_(m.email);
  return {
    projectId: m.projectId, email: m.email, role: m.role, addedBy: m.addedBy, addedAt: m.addedAt,
    name: u ? u.name : '', photoUrl: u ? u.photoUrl : '', status: u ? u.status : ''
  };
}

function actionListMembers_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  return table_('members').rows
    .filter(function (m) { return m.projectId === project.id; })
    .map(memberView_);
}

function actionAddMember_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  if (!canManageProject_(ctx, project)) throw apiError_('FORBIDDEN', 'Only an admin or the project lead can add people.');
  if (project.archived === 'TRUE') throw apiError_('BAD_REQUEST', 'This project is archived.');
  var email = argEmail_(body, 'email');
  var role = body.role === undefined ? 'member' : argEnum_(body, 'role', MEMBER_ROLES);
  if (role === 'lead' && !ctx.isAdmin) throw apiError_('FORBIDDEN', 'Only an admin can make someone a project lead.');

  var user = findUser_(email);
  if (!user || user.status !== 'approved') {
    throw apiError_('NOT_APPROVED', 'This person must sign in once and be approved before they can be added.');
  }

  var existing = findMember_(project.id, email);
  var member;
  if (existing) {
    if (existing.role === 'lead' && role !== 'lead' && !ctx.isAdmin) {
      throw apiError_('FORBIDDEN', 'Only an admin can change a project lead.');
    }
    member = existing.role === role ? existing : saveRow_('members', existing, { role: role });
  } else {
    member = insertRow_('members', { projectId: project.id, email: email, role: role, addedBy: ctx.email, addedAt: now_() });
  }
  var w = project.folderId ? shareFolder_(project.folderId, email) : null;
  var out = memberView_(member);
  if (w) out.warnings = [w];
  return out;
}

function actionRemoveMember_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  if (!canManageProject_(ctx, project)) throw apiError_('FORBIDDEN', 'Only an admin or the project lead can remove people.');
  var email = argEmail_(body, 'email');
  var member = findMember_(project.id, email);
  if (!member) throw apiError_('NOT_FOUND', 'This person is not in the project.');
  if (member.role === 'lead' && !ctx.isAdmin) throw apiError_('FORBIDDEN', 'Only an admin can remove a project lead.');

  deleteRow_('members', member);
  var w = project.folderId ? unshareFolder_(project.folderId, email) : null;
  var out = { projectId: project.id, email: email, removed: true };
  if (w) out.warnings = [w];
  return out;
}

// ---------------------------------------------------------------------------
// Drive sharing. Never "anyone with the link" — only named Google accounts.
// Problems come back as warnings: the Sheet change still stands.
// ---------------------------------------------------------------------------

function ownerEmail_() {
  return normEmail_(Session.getEffectiveUser().getEmail());
}

function shareFolder_(folderId, email) {
  if (normEmail_(email) === ownerEmail_()) return null;
  try {
    var folder = DriveApp.getFolderById(folderId);
    var already = folder.getViewers().concat(folder.getEditors()).some(function (u) { return normEmail_(u.getEmail()) === normEmail_(email); });
    if (!already) folder.addViewer(email);
    return null;
  } catch (e) {
    console.warn('Share failed ' + folderId + ' → ' + email + ': ' + e);
    return 'Could not give ' + email + ' access to the project files. Is it a Google account?';
  }
}

function unshareFolder_(folderId, email) {
  if (normEmail_(email) === ownerEmail_()) return null;
  try {
    var folder = DriveApp.getFolderById(folderId);
    var isViewer = folder.getViewers().some(function (u) { return normEmail_(u.getEmail()) === normEmail_(email); });
    if (isViewer) folder.removeViewer(email);
    return null;
  } catch (e) {
    console.warn('Unshare failed ' + folderId + ' → ' + email + ': ' + e);
    return 'Could not remove ' + email + ' from the project files folder. Check its sharing in Drive.';
  }
}

// ===========================================================================
// Part 2 — messages, tasks, daily updates, files, sync, reads
// ===========================================================================

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cellList_(s) { return s ? String(s).split(',') : []; }

function requireOpenProject_(project) {
  if (project.archived === 'TRUE') throw apiError_('BAD_REQUEST', 'This project is archived.');
}

function projectRows_(name, projectId) {
  return table_(name).rows.filter(function (r) { return r.projectId === projectId; });
}

/** A row of `name` in this project, or null. Ids from other projects are not found. */
function findInProject_(name, projectId, id) {
  if (typeof id !== 'string' || !id) return null;
  return table_(name).rows.filter(function (r) { return r.id === id && r.projectId === projectId; })[0] || null;
}

/** Optional id argument that must name a row of `name` in this project. */
function argRef_(body, key, name, project, what) {
  var id = body[key];
  if (id === undefined || id === null || id === '') return null;
  var row = findInProject_(name, project.id, id);
  if (!row) throw apiError_('NOT_FOUND', what + ' was not found.');
  return row;
}

/** Optional list of ids that must all be rows of `name` in this project. */
function argIdList_(body, key, name, project, max) {
  var v = body[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw apiError_('BAD_REQUEST', '"' + key + '" must be a list.');
  if (v.length > max) throw apiError_('BAD_REQUEST', '"' + key + '" has too many items (max ' + max + ').');
  var out = [];
  v.forEach(function (id) {
    if (!findInProject_(name, project.id, id)) throw apiError_('BAD_REQUEST', '"' + key + '" names something that is not in this project.');
    if (out.indexOf(id) === -1) out.push(id);
  });
  return out;
}

/** @mentions: e-mails of project members only; anyone else is dropped. */
function argMentions_(body, project) {
  var v = body.mentions;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_MENTIONS) throw apiError_('BAD_REQUEST', '"mentions" must be a list of e-mails.');
  var out = [];
  v.forEach(function (e) {
    var email = normEmail_(e);
    if (findMember_(project.id, email) && out.indexOf(email) === -1) out.push(email);
  });
  return out;
}

var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD that is a real calendar day, or '' when optional and empty. */
function argDate_(body, key, required) {
  var v = body[key];
  if (!required && (v === undefined || v === null || v === '')) return '';
  if (typeof v !== 'string' || !DATE_RE.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')) ||
      new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) {
    throw apiError_('BAD_REQUEST', '"' + key + '" must be a date like 2026-10-09.');
  }
  return v;
}

function argPercent_(body) {
  var v = body.percent;
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) throw apiError_('BAD_REQUEST', '"percent" must be a number from 0 to 100.');
  return Math.round(v);
}

/** '' (nobody) or the e-mail of a member of this project. */
function argAssignee_(body, project) {
  var v = body.assigneeEmail;
  if (v === undefined || v === null || v === '') return '';
  var email = argEmail_(body, 'assigneeEmail');
  if (!findMember_(project.id, email)) throw apiError_('BAD_REQUEST', 'The person you assign must be a member of this project.');
  return email;
}

/** Sets messageId / updateId on files that are not linked to anything yet. */
function linkFiles_(fileIds, field, value) {
  fileIds.forEach(function (id) {
    var f = table_('files').rows.filter(function (r) { return r.id === id; })[0];
    if (!f || f[field]) return;
    var change = {};
    change[field] = value;
    saveRow_('files', f, change);
  });
}

// ---------------------------------------------------------------------------
// What the app receives
// ---------------------------------------------------------------------------

function messageView_(m) {
  var deleted = m.deleted === 'TRUE';
  var isEvent = m.kind === 'event';
  var out = {
    id: m.id, projectId: m.projectId, authorEmail: m.authorEmail,
    kind: isEvent ? 'event' : 'text',
    text: deleted || isEvent ? '' : m.text,
    mentions: deleted ? [] : cellList_(m.mentions),
    replyToId: m.replyToId, fileIds: deleted ? [] : cellList_(m.fileIds), taskId: m.taskId,
    createdAt: m.createdAt, editedAt: m.editedAt, deleted: deleted
  };
  if (isEvent && !deleted) {
    try { out.event = JSON.parse(m.text); } catch (e) { out.event = null; }
  }
  return out;
}

function taskView_(t) {
  var out = strip_(t);
  out.percent = Number(t.percent) || 0;
  return out;
}

function updateView_(u) {
  var out = strip_(u);
  out.taskIds = cellList_(u.taskIds);
  out.fileIds = cellList_(u.fileIds);
  return out;
}

function fileView_(f) {
  var out = strip_(f);
  out.size = Number(f.size) || 0;
  out.url = 'https://drive.google.com/file/d/' + f.id + '/view';
  out.thumbnailUrl = /^image\//.test(f.mimeType) ? 'https://drive.google.com/thumbnail?id=' + f.id + '&sz=w800' : '';
  return out;
}

/** The moment a row last changed — what `sync` compares with `since`. */
function messageStamp_(m) { return m.editedAt > m.createdAt ? m.editedAt : m.createdAt; }
function updateStamp_(u) { return u.updatedAt > u.createdAt ? u.updatedAt : u.createdAt; }

function byCreated_(a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; }

// ---------------------------------------------------------------------------
// sync — everything in one project changed since `since`
// ---------------------------------------------------------------------------

/**
 * First call (no `since`): all tasks and files, the last MESSAGE_PAGE messages and the last
 * UPDATE_DAYS days of daily updates. Later calls: send back `next` as `since` and get only
 * what changed. Each answer overlaps the previous one by SYNC_OVERLAP_MS (a row saved while
 * a sync was reading is never lost), so the app merges rows by `id`, newer copy wins.
 */
function actionSync_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  var next = now_();
  var since = '';
  if (body.since !== undefined && body.since !== null && body.since !== '') {
    var t = typeof body.since === 'string' ? Date.parse(body.since) : NaN;
    if (isNaN(t)) throw apiError_('BAD_REQUEST', '"since" must be a time from a previous sync.');
    since = new Date(t - SYNC_OVERLAP_MS).toISOString();
  }

  var messages = projectRows_('messages', project.id).sort(byCreated_);
  var hasMoreMessages = false;
  if (since) {
    messages = messages.filter(function (m) { return messageStamp_(m) > since; });
  } else if (messages.length > MESSAGE_PAGE) {
    messages = messages.slice(-MESSAGE_PAGE);
    hasMoreMessages = true;
  }

  var tasks = projectRows_('tasks', project.id);
  var updates = projectRows_('updates', project.id);
  var files = projectRows_('files', project.id);
  if (since) {
    tasks = tasks.filter(function (x) { return x.updatedAt > since; });
    updates = updates.filter(function (u) { return updateStamp_(u) > since; });
    files = files.filter(function (f) { return f.createdAt > since; });
  } else {
    var fromDay = new Date(Date.now() - UPDATE_DAYS * 86400000).toISOString().slice(0, 10);
    updates = updates.filter(function (u) { return u.date >= fromDay; });
  }

  var read = table_('reads').rows.filter(function (r) {
    return r.projectId === project.id && normEmail_(r.email) === ctx.email;
  })[0];

  return {
    projectId: project.id,
    next: next,
    full: !since,
    hasMoreMessages: hasMoreMessages,
    lastReadAt: read ? read.lastReadAt : '',
    messages: messages.map(messageView_),
    tasks: tasks.sort(byCreated_).map(taskView_),
    updates: updates.sort(byCreated_).map(updateView_),
    files: files.sort(byCreated_).map(fileView_)
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Older messages for scrolling up: the `limit` messages just before `before`. */
function actionListMessages_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  if (typeof body.before !== 'string' || isNaN(Date.parse(body.before))) throw apiError_('BAD_REQUEST', '"before" must be a message time.');
  var limit = body.limit === undefined ? 50 : body.limit;
  if (typeof limit !== 'number' || !(limit >= 1 && limit <= MESSAGE_PAGE)) throw apiError_('BAD_REQUEST', '"limit" must be 1 to ' + MESSAGE_PAGE + '.');
  limit = Math.floor(limit);
  var older = projectRows_('messages', project.id)
    .filter(function (m) { return m.createdAt < body.before; })
    .sort(byCreated_);
  return { messages: older.slice(-limit).map(messageView_), hasMore: older.length > limit };
}

function actionPostMessage_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  requireOpenProject_(project);
  var text = argText_(body, 'text', MAX_TEXT, false);
  var fileIds = argIdList_(body, 'fileIds', 'files', project, MAX_LIST);
  if (!text && !fileIds.length) throw apiError_('BAD_REQUEST', 'Write a message or attach a file.');
  var replyTo = argRef_(body, 'replyToId', 'messages', project, 'The message you are replying to');
  var task = argRef_(body, 'taskId', 'tasks', project, 'The task');

  var msg = insertRow_('messages', {
    id: Utilities.getUuid(), projectId: project.id, authorEmail: ctx.email, text: text,
    mentions: argMentions_(body, project).join(','), replyToId: replyTo ? replyTo.id : '',
    fileIds: fileIds.join(','), taskId: task ? task.id : '',
    createdAt: now_(), editedAt: '', deleted: '', kind: ''
  });
  linkFiles_(fileIds, 'messageId', msg.id);
  return messageView_(msg);
}

/** The message named by `messageId`, checked: it exists, is not deleted, the caller may change it. */
function ownMessage_(ctx, body, project) {
  var msg = findInProject_('messages', project.id, body.messageId);
  if (!msg || msg.deleted === 'TRUE') throw apiError_('NOT_FOUND', 'Message not found.');
  if (normEmail_(msg.authorEmail) !== ctx.email && !ctx.isAdmin) {
    throw apiError_('FORBIDDEN', 'Only the person who wrote a message (or an admin) can change it.');
  }
  return msg;
}

function actionEditMessage_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  requireOpenProject_(project);
  var msg = ownMessage_(ctx, body, project);
  if (msg.kind === 'event') throw apiError_('FORBIDDEN', 'Task lines cannot be edited.');
  var text = argText_(body, 'text', MAX_TEXT, false);
  if (!text && !msg.fileIds) throw apiError_('BAD_REQUEST', 'A message without a file needs some text. Delete it instead.');
  var changes = { text: text, editedAt: now_() };
  if (body.mentions !== undefined) changes.mentions = argMentions_(body, project).join(',');
  saveRow_('messages', msg, changes);
  return messageView_(msg);
}

/** Hidden from everyone in the app; the text stays in the Sheet for the record. */
function actionDeleteMessage_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  var msg = ownMessage_(ctx, body, project);
  if (msg.kind === 'event' && !ctx.isAdmin) throw apiError_('FORBIDDEN', 'Only an admin can remove a task line.');
  saveRow_('messages', msg, { deleted: 'TRUE', editedAt: now_() });
  return messageView_(msg);
}

/** A short chat line about a task. The text is data; the app words it in the reader's language. */
function postEvent_(ctx, project, task, event, replyToId) {
  return insertRow_('messages', {
    id: Utilities.getUuid(), projectId: project.id, authorEmail: ctx.email,
    text: JSON.stringify(event), mentions: event.assigneeEmail || '', replyToId: replyToId || '',
    fileIds: '', taskId: task.id, createdAt: now_(), editedAt: '', deleted: '', kind: 'event'
  });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** T-001, T-002 … counted per project in the `meta` tab. */
function nextSerial_(projectId) {
  var key = 'taskSerial:' + projectId;
  var row = table_('meta').rows.filter(function (r) { return r.key === key; })[0];
  var n = (row ? parseInt(row.value, 10) || 0 : 0) + 1;
  if (row) saveRow_('meta', row, { value: String(n) });
  else insertRow_('meta', { key: key, value: String(n) });
  return 'T-' + (n < 1000 ? ('00' + n).slice(-3) : String(n));
}

/** Admins, the project lead, whoever made the task and whoever it is assigned to. */
function canEditTask_(ctx, project, task) {
  return canManageProject_(ctx, project) ||
    normEmail_(task.createdBy) === ctx.email || normEmail_(task.assigneeEmail) === ctx.email;
}

/**
 * Any member may create a task. `fromMessageId` turns a chat message into a task: the
 * "task created" line is posted as a reply to that message.
 */
function actionCreateTask_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  requireOpenProject_(project);
  var title = argText_(body, 'title', MAX_TITLE, true);
  var details = argText_(body, 'details', MAX_TEXT, false);
  var assignee = argAssignee_(body, project);
  var status = body.status === undefined ? 'todo' : argEnum_(body, 'status', TASK_STATUSES);
  var priority = body.priority === undefined ? 'normal' : argEnum_(body, 'priority', TASK_PRIORITIES);
  var percent = body.percent === undefined ? 0 : argPercent_(body);
  var dueDate = argDate_(body, 'dueDate', false);
  var from = argRef_(body, 'fromMessageId', 'messages', project, 'The message');
  if (from && from.deleted === 'TRUE') throw apiError_('NOT_FOUND', 'The message was not found.');
  if (status === 'done') percent = 100;

  var now = now_();
  var task = insertRow_('tasks', {
    id: Utilities.getUuid(), projectId: project.id, serial: nextSerial_(project.id),
    title: title, details: details, assigneeEmail: assignee, createdBy: ctx.email,
    status: status, percent: String(percent), priority: priority, dueDate: dueDate,
    createdAt: now, updatedAt: now, doneAt: status === 'done' ? now : ''
  });
  postEvent_(ctx, project, task, {
    type: 'taskCreated', serial: task.serial, title: title, assigneeEmail: assignee, status: status, dueDate: dueDate
  }, from ? from.id : '');
  return taskView_(task);
}

function actionUpdateTask_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  requireOpenProject_(project);
  var task = findInProject_('tasks', project.id, body.taskId);
  if (!task) throw apiError_('NOT_FOUND', 'Task not found.');
  if (!canEditTask_(ctx, project, task)) {
    throw apiError_('FORBIDDEN', 'Only the person assigned, the person who made the task, the project lead or an admin can change it.');
  }

  var next = {};
  if (body.title !== undefined) next.title = argText_(body, 'title', MAX_TITLE, true);
  if (body.details !== undefined) next.details = argText_(body, 'details', MAX_TEXT, false);
  if (body.assigneeEmail !== undefined) next.assigneeEmail = argAssignee_(body, project);
  if (body.status !== undefined) next.status = argEnum_(body, 'status', TASK_STATUSES);
  if (body.percent !== undefined) next.percent = String(argPercent_(body));
  if (body.priority !== undefined) next.priority = argEnum_(body, 'priority', TASK_PRIORITIES);
  if (body.dueDate !== undefined) next.dueDate = argDate_(body, 'dueDate', false);

  var now = now_();
  if (next.status === 'done' && task.status !== 'done') { next.doneAt = now; next.percent = '100'; }
  if (next.status && next.status !== 'done' && task.status === 'done') next.doneAt = '';

  var changes = {};
  Object.keys(next).forEach(function (k) { if (next[k] !== task[k]) changes[k] = next[k]; });
  if (!Object.keys(changes).length) return taskView_(task);

  // Status, progress and who does it are news for the team; wording edits are not.
  var news = {};
  if ('status' in changes) news.status = { from: task.status, to: changes.status };
  if ('percent' in changes) news.percent = { from: Number(task.percent) || 0, to: Number(changes.percent) };
  if ('assigneeEmail' in changes) news.assigneeEmail = { from: task.assigneeEmail, to: changes.assigneeEmail };

  changes.updatedAt = now;
  saveRow_('tasks', task, changes);
  if (Object.keys(news).length) {
    postEvent_(ctx, project, task, {
      type: 'taskUpdated', serial: task.serial, title: task.title,
      assigneeEmail: news.assigneeEmail ? news.assigneeEmail.to : '', changes: news
    });
  }
  return taskView_(task);
}

// ---------------------------------------------------------------------------
// Daily updates — one per person per project per day; posting again replaces it
// ---------------------------------------------------------------------------

function actionPostUpdate_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  requireOpenProject_(project);
  // The app sends the user's own calendar day; one day ahead of UTC is allowed for time zones.
  var date = argDate_(body, 'date', true);
  var tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (date > tomorrow) throw apiError_('BAD_REQUEST', 'An update cannot be for a future day.');
  var done = argText_(body, 'done', MAX_TEXT, false);
  var remaining = argText_(body, 'remaining', MAX_TEXT, false);
  var blockers = argText_(body, 'blockers', MAX_TEXT, false);
  if (!done && !remaining && !blockers) throw apiError_('BAD_REQUEST', 'Write what you did, what is left, or what is blocking you.');
  var taskIds = argIdList_(body, 'taskIds', 'tasks', project, MAX_LIST);
  var fileIds = argIdList_(body, 'fileIds', 'files', project, MAX_LIST);

  var now = now_();
  var fields = {
    done: done, remaining: remaining, blockers: blockers,
    taskIds: taskIds.join(','), fileIds: fileIds.join(','), updatedAt: now
  };
  var existing = projectRows_('updates', project.id).filter(function (u) {
    return u.date === date && normEmail_(u.authorEmail) === ctx.email;
  })[0];
  var row;
  if (existing) {
    row = saveRow_('updates', existing, fields);
  } else {
    fields.id = Utilities.getUuid();
    fields.projectId = project.id;
    fields.authorEmail = ctx.email;
    fields.date = date;
    fields.createdAt = now;
    row = insertRow_('updates', fields);
  }
  linkFiles_(fileIds, 'updateId', row.id);
  return updateView_(row);
}

// ---------------------------------------------------------------------------
// Files — saved in the project's Drive folder; the app then attaches the returned
// id to a message or an update
// ---------------------------------------------------------------------------

var MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;
var BASE64_RE = /^[A-Za-z0-9+\/]+={0,2}$/;

function actionUploadFile_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  requireOpenProject_(project);
  var name = argText_(body, 'name', MAX_FILE_NAME, true).replace(/[\\\/]/g, '-');
  var mimeType = body.mimeType === undefined || body.mimeType === '' ? 'application/octet-stream' : body.mimeType;
  if (typeof mimeType !== 'string' || mimeType.length > 100 || !MIME_RE.test(mimeType)) throw apiError_('BAD_REQUEST', '"mimeType" is not valid.');

  var data = body.data;
  if (typeof data !== 'string' || !data) throw apiError_('BAD_REQUEST', 'The file is empty.');
  if (data.length > MAX_UPLOAD_CHARS) throw apiError_('BAD_REQUEST', 'The file is too big (max about 15 MB).');
  data = data.replace(/^data:[^,]*;base64,/, '').replace(/\s/g, '');
  if (!BASE64_RE.test(data) || data.length % 4 !== 0) throw apiError_('BAD_REQUEST', 'The file was not sent correctly.');
  var bytes = Utilities.base64Decode(data);
  if (!bytes.length) throw apiError_('BAD_REQUEST', 'The file is empty.');

  var file = DriveApp.getFolderById(project.folderId).createFile(Utilities.newBlob(bytes, mimeType, name));
  try {
    return withLock_(function () {
      resetMemo_();
      return fileView_(insertRow_('files', {
        id: file.getId(), projectId: project.id, name: name, mimeType: mimeType, size: String(bytes.length),
        uploaderEmail: ctx.email, messageId: '', updateId: '', createdAt: now_()
      }));
    });
  } catch (err) {
    // With no Sheet row nobody can find the file, so do not leave it behind in Drive.
    try { file.setTrashed(true); } catch (e) { console.warn('Could not trash orphan upload ' + file.getId() + ': ' + e); }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Reads — drive the unread counts in listProjects
// ---------------------------------------------------------------------------

function actionMarkRead_(ctx, body) {
  var project = argProject_(body);
  requireProjectAccess_(ctx, project);
  var now = now_();
  var row = table_('reads').rows.filter(function (r) {
    return r.projectId === project.id && normEmail_(r.email) === ctx.email;
  })[0];
  if (row) saveRow_('reads', row, { lastReadAt: now });
  else insertRow_('reads', { email: ctx.email, projectId: project.id, lastReadAt: now });
  return { projectId: project.id, lastReadAt: now };
}
