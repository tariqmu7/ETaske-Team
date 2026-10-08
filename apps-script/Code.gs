/**
 * ETaske Team — back end (Google Apps Script, bound to the data Sheet).
 *
 * Part 1: setup, sign-in check, users + approval, projects, members, Drive folders.
 * Part 2 (messages, tasks, updates, uploads, sync, reads) adds its handlers to ACTIONS.
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
  messages: ['id', 'projectId', 'authorEmail', 'text', 'mentions', 'replyToId', 'fileIds', 'taskId', 'createdAt', 'editedAt', 'deleted'],
  tasks: ['id', 'projectId', 'serial', 'title', 'details', 'assigneeEmail', 'createdBy', 'status', 'percent', 'priority', 'dueDate', 'createdAt', 'updatedAt', 'doneAt'],
  updates: ['id', 'projectId', 'authorEmail', 'date', 'done', 'remaining', 'blockers', 'taskIds', 'fileIds', 'createdAt'],
  files: ['id', 'projectId', 'name', 'mimeType', 'size', 'uploaderEmail', 'messageId', 'updateId', 'createdAt'],
  reads: ['email', 'projectId', 'lastReadAt'],
  meta: ['key', 'value']
};

var USER_ROLES = ['admin', 'member'];
var USER_STATUSES = ['pending', 'approved', 'blocked'];
var MEMBER_ROLES = ['lead', 'member'];

var MAX_NAME = 100;
var MAX_DESCRIPTION = 2000;
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
  removeMember: { who: 'approved', write: true, fn: actionRemoveMember_ }
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
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[r][c] === null || values[r][c] === undefined ? '' : String(values[r][c]);
    rows.push(obj);
  }
  memo_[name] = { sheet: sheet, headers: headers, rows: rows };
  return memo_[name];
}

function rowValues_(t, obj) {
  return t.headers.map(function (h) {
    var v = obj[h];
    return v === null || v === undefined ? '' : String(v);
  });
}

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
