import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, OWNER, CLIENT_ID } from './fakes.mjs';

/** A set-up back end with Tariq signed in as admin. */
function ready() {
  const env = makeEnv();
  env.context.setup();
  const admin = env.token(OWNER);
  assert.equal(env.call('me', admin).data.role, 'admin');
  return { ...env, admin };
}

/** Sign someone in and (optionally) approve them. */
function person(env, email, approve = true) {
  const t = env.token(email);
  env.call('me', t);
  if (approve) assert.equal(env.call('setUserStatus', env.admin, { email, status: 'approved' }).ok, true);
  return t;
}

// ---------------------------------------------------------------- setup

test('setup builds the folders, tabs and settings, and is safe to run twice', () => {
  const env = makeEnv();
  const first = env.context.setup();
  const root = env.drive.folders.get(first.rootFolderId);
  assert.equal(root.name, 'ETaske Team');
  assert.equal(root.parent, env.work);
  assert.equal(env.drive.folders.get(first.projectsFolderId).parent, root);
  assert.equal(env.ssFile.parents[0], root, 'the Sheet is moved into ETaske Team/');
  assert.equal(env.ss.getName(), 'ETaske Team — data');
  assert.deepEqual(env.sheets.map((s) => s.name).sort(),
    ['categories', 'files', 'members', 'messages', 'meta', 'milestones', 'projects', 'reads', 'tasks', 'updates', 'users']);
  assert.equal(env.props.get('GOOGLE_CLIENT_ID'), CLIENT_ID);
  assert.equal(env.props.get('ADMIN_EMAILS'), OWNER);
  assert.deepEqual(env.rows('meta'), [{ key: 'schemaVersion', value: '1' }]);

  env.props.set('ADMIN_EMAILS', `${OWNER},other@x.com`);
  const second = env.context.setup();
  assert.equal(second.rootFolderId, first.rootFolderId);
  assert.equal(second.projectsFolderId, first.projectsFolderId);
  assert.equal(env.drive.folders.size, 3, 'no duplicate folders');
  assert.equal(env.sheets.length, 11);
  assert.equal(env.ss.getSheetByName('users').cells.length, 1, 'header only, not doubled');
  assert.equal(env.props.get('ADMIN_EMAILS'), `${OWNER},other@x.com`, 'existing settings are kept');
  assert.equal(env.rows('meta').length, 1);
});

test('setup adds a column that is missing without touching the others', () => {
  const env = makeEnv();
  env.context.setup();
  const users = env.ss.getSheetByName('users');
  users.cells[0] = users.cells[0].filter((h) => h !== 'lastSeenAt');
  env.context.setup();
  assert.equal(users.cells[0].at(-1), 'lastSeenAt');
  assert.equal(users.cells[0][0], 'email');
});

// ---------------------------------------------------------------- transport

test('doGet answers a health check', () => {
  const env = makeEnv();
  assert.deepEqual(JSON.parse(env.context.doGet().content), { ok: true, data: { service: 'ETaske Team', schemaVersion: '1' } });
});

test('bad requests get a clear error code', () => {
  const env = ready();
  const raw = (contents) => JSON.parse(env.context.doPost({ postData: { contents } }).content);
  assert.equal(raw('not json').code, 'BAD_REQUEST');
  assert.equal(raw('[1,2]').code, 'BAD_REQUEST');
  assert.equal(JSON.parse(env.context.doPost(undefined).content).code, 'BAD_REQUEST');
  assert.equal(env.call('dropTables', env.admin).code, 'BAD_REQUEST');
  assert.equal(env.call('toString', env.admin).code, 'BAD_REQUEST', 'no prototype lookups');
  assert.equal(env.call('me', undefined).code, 'UNAUTHENTICATED');
});

test('unexpected failures hide the details', () => {
  const env = ready();
  env.ss.getSheetByName('projects').getDataRange = () => { throw new Error('Sheet projects is unreadable'); };
  const res = env.call('listProjects', env.admin);
  assert.deepEqual(res, { ok: false, error: 'Something went wrong on the server.', code: 'INTERNAL' });
  assert.ok(env.logs.some(([kind, m]) => kind === 'error' && String(m).includes('projects')));
});

// ---------------------------------------------------------------- token check

test('tokens are rejected for the wrong app, issuer, unverified e-mail, expiry, or Google saying no', () => {
  const env = ready();
  const cases = [
    { aud: 'someone-else.apps.googleusercontent.com' },
    { iss: 'evil.example.com' },
    { email_verified: 'false' },
    { exp: String(Math.floor(Date.now() / 1000) - 5) }
  ];
  for (const extra of cases) {
    assert.equal(env.call('me', env.token('a@x.com', extra)).code, 'UNAUTHENTICATED', JSON.stringify(extra));
  }
  const t = 'tok_unknown_' + 'y'.repeat(30);
  assert.equal(env.call('me', t).code, 'UNAUTHENTICATED');
  env.tokens.set(t, 500);
  assert.equal(env.call('me', t).code, 'UNAUTHENTICATED');
  assert.equal(env.rows('users').length, 1, 'no user rows created by bad tokens');
});

test('a good token is checked with Google once, then served from the cache', () => {
  const env = ready();
  const t = env.token('cache@x.com');
  const before = env.fetches.length;
  env.call('me', t);
  env.call('me', t);
  env.call('listProjects', t);
  assert.equal(env.fetches.length - before, 1);
  for (const k of env.cache.keys()) assert.ok(!k.includes(t), 'the raw token is not used as a cache key');
});

test('e-mails are matched without case', () => {
  const env = ready();
  const t = env.token('Mixed.Case@X.com');
  assert.equal(env.call('me', t).data.email, 'mixed.case@x.com');
  assert.equal(env.call('setUserStatus', env.admin, { email: 'MIXED.case@x.com', status: 'approved' }).data.status, 'approved');
});

// ---------------------------------------------------------------- users

test('first sign-in creates a pending row; pending people can only ask "me"', () => {
  const env = ready();
  const t = env.token('new@x.com');
  const me = env.call('me', t);
  assert.equal(me.ok, true);
  assert.deepEqual([me.data.status, me.data.role, me.data.name], ['pending', 'member', 'new']);
  assert.equal(env.call('listProjects', t).code, 'PENDING');
  assert.equal(env.call('listUsers', t).code, 'PENDING');
  assert.equal(env.rows('users').length, 2, '"me" twice does not add a second row');
});

test('the owner is an approved admin from the first sign-in, and is put back if changed in the Sheet', () => {
  const env = ready();
  const row = env.ss.getSheetByName('users').cells[1];
  row[3] = 'member'; row[4] = 'blocked';
  const me = env.call('me', env.admin).data;
  assert.deepEqual([me.role, me.status], ['admin', 'approved']);
});

test('admins approve, block and promote; members cannot', () => {
  const env = ready();
  const bob = person(env, 'bob@x.com');
  assert.equal(env.rows('users').find((u) => u.email === 'bob@x.com').approvedBy, OWNER);
  assert.equal(env.call('listUsers', bob).code, 'FORBIDDEN');
  assert.equal(env.call('setUserStatus', bob, { email: 'bob@x.com', status: 'approved' }).code, 'FORBIDDEN');
  assert.equal(env.call('listUsers', env.admin).data.length, 2);

  assert.equal(env.call('setUserRole', env.admin, { email: 'bob@x.com', role: 'admin' }).data.role, 'admin');
  assert.equal(env.call('listUsers', bob).ok, true, 'bob is now an admin');

  assert.equal(env.call('setUserStatus', env.admin, { email: 'bob@x.com', status: 'blocked' }).data.status, 'blocked');
  assert.equal(env.call('listUsers', bob).code, 'BLOCKED', 'a blocked admin has no admin powers');
  assert.equal(env.call('me', bob).data.status, 'blocked', 'but can still see their own status');
});

test('admins cannot lock themselves or the fixed admin out', () => {
  const env = ready();
  const bob = person(env, 'bob@x.com');
  env.call('setUserRole', env.admin, { email: 'bob@x.com', role: 'admin' });
  assert.equal(env.call('setUserStatus', env.admin, { email: OWNER, status: 'blocked' }).code, 'FORBIDDEN');
  assert.equal(env.call('setUserStatus', bob, { email: OWNER, status: 'pending' }).code, 'FORBIDDEN');
  assert.equal(env.call('setUserRole', bob, { email: OWNER, role: 'member' }).code, 'FORBIDDEN');
  assert.equal(env.call('setUserRole', bob, { email: 'bob@x.com', role: 'member' }).code, 'FORBIDDEN');
});

test('user changes are validated', () => {
  const env = ready();
  person(env, 'p@x.com', false);
  assert.equal(env.call('setUserStatus', env.admin, { email: 'p@x.com', status: 'boss' }).code, 'BAD_REQUEST');
  assert.equal(env.call('setUserStatus', env.admin, { email: 'nobody@x.com', status: 'approved' }).code, 'NOT_FOUND');
  assert.equal(env.call('setUserStatus', env.admin, { email: 'not an email', status: 'approved' }).code, 'BAD_REQUEST');
  assert.equal(env.call('setUserRole', env.admin, { email: 'p@x.com', role: 'admin' }).code, 'BAD_REQUEST', 'approve first');
});

// ---------------------------------------------------------------- projects

test('an admin creates a project with its own Drive folder and leads it', () => {
  const env = ready();
  const res = env.call('createProject', env.admin, { name: '  Ras Gharib tanks ', description: 'Phase 1' });
  assert.equal(res.ok, true);
  const p = res.data;
  assert.equal(p.name, 'Ras Gharib tanks');
  assert.equal(p.myRole, 'lead');
  const folder = env.drive.folders.get(p.folderId);
  assert.equal(folder.parent.id, env.props.get('PROJECTS_FOLDER_ID'));
  assert.equal(folder.name, `Ras Gharib tanks (${p.id.slice(0, 8)})`);
  assert.deepEqual(env.rows('members'), [{ projectId: p.id, email: OWNER, role: 'lead', addedBy: OWNER, addedAt: env.rows('members')[0].addedAt }]);
  assert.deepEqual(env.drive.shareCalls, [], 'the owner is not shared to their own folder');
  assert.equal(env.call('createProject', env.admin, { name: 'ras gharib TANKS' }).code, 'CONFLICT');
});

test('everything is stored as plain text, so Sheets never turns dates or TRUE into something else', () => {
  const env = ready();
  const p = env.call('createProject', env.admin, { name: 'P' }).data;
  env.call('archiveProject', env.admin, { projectId: p.id });
  const row = env.rows('projects')[0];
  assert.equal(typeof row.createdAt, 'string');
  assert.match(row.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row.archived, 'TRUE');
  assert.equal(typeof env.rows('users')[0].lastSeenAt, 'string');
});

test('project input is validated, and only admins create or change projects', () => {
  const env = ready();
  const bob = person(env, 'bob@x.com');
  assert.equal(env.call('createProject', env.admin, { name: '   ' }).code, 'BAD_REQUEST');
  assert.equal(env.call('createProject', env.admin, { name: 'x'.repeat(101) }).code, 'BAD_REQUEST');
  assert.equal(env.call('createProject', env.admin, { name: 42 }).code, 'BAD_REQUEST');
  assert.equal(env.call('createProject', bob, { name: 'Mine' }).code, 'FORBIDDEN');
  const p = env.call('createProject', env.admin, { name: 'P' }).data;
  assert.equal(env.call('updateProject', bob, { projectId: p.id, name: 'Q' }).code, 'FORBIDDEN');
  assert.equal(env.call('archiveProject', bob, { projectId: p.id }).code, 'FORBIDDEN');
  assert.equal(env.call('updateProject', env.admin, { projectId: 'nope', name: 'Q' }).code, 'NOT_FOUND');
});

test('renaming a project renames its folder; archiving hides it from the list', () => {
  const env = ready();
  const p = env.call('createProject', env.admin, { name: 'Old' }).data;
  env.call('createProject', env.admin, { name: 'Other' });
  assert.equal(env.call('updateProject', env.admin, { projectId: p.id, name: 'Other' }).code, 'CONFLICT');
  const up = env.call('updateProject', env.admin, { projectId: p.id, name: 'New', description: 'd' }).data;
  assert.deepEqual([up.name, up.description], ['New', 'd']);
  assert.equal(env.drive.folders.get(p.folderId).name, `New (${p.id.slice(0, 8)})`);

  env.call('archiveProject', env.admin, { projectId: p.id });
  assert.deepEqual(env.call('listProjects', env.admin).data.map((x) => x.name), ['Other']);
  assert.equal(env.call('listProjects', env.admin, { includeArchived: true }).data.length, 2);
  env.call('archiveProject', env.admin, { projectId: p.id, archived: false });
  assert.equal(env.call('listProjects', env.admin).data.length, 2);
});

test('members see only their projects, with unread counts and last activity', () => {
  const env = ready();
  const bob = person(env, 'bob@x.com');
  const a = env.call('createProject', env.admin, { name: 'A' }).data;
  env.call('createProject', env.admin, { name: 'B' });
  assert.deepEqual(env.call('listProjects', bob).data, []);
  env.call('addMember', env.admin, { projectId: a.id, email: 'bob@x.com' });

  // Messages and reads come in part 2; write rows straight into the tabs to check the counts.
  const msgs = env.ss.getSheetByName('messages');
  const msg = (id, author, at, deleted = '') => msgs.cells.push([id, a.id, author, 'hi', '', '', '', '', at, '', deleted]);
  msg('m1', OWNER, '2026-10-09T08:00:00.000Z');
  msg('m2', OWNER, '2026-10-09T09:00:00.000Z');
  msg('m3', 'bob@x.com', '2026-10-09T09:30:00.000Z');
  msg('m4', OWNER, '2026-10-09T10:00:00.000Z', 'TRUE');
  env.ss.getSheetByName('reads').cells.push(['bob@x.com', a.id, '2026-10-09T08:30:00.000Z']);

  const list = env.call('listProjects', bob).data;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].name, list[0].myRole, list[0].memberCount, list[0].unread, list[0].lastActivityAt],
    ['A', 'member', 2, 1, '2026-10-09T09:30:00.000Z']);
  assert.equal(env.call('listProjects', env.admin).data.find((x) => x.name === 'A').unread, 1, 'owner: only bob\'s message is unread');
  assert.equal(env.call('listProjects', env.admin).data.length, 2, 'admins see every project');
});

// ---------------------------------------------------------------- members

test('adding a member needs an approved account and shares the project folder with them', () => {
  const env = ready();
  const p = env.call('createProject', env.admin, { name: 'P' }).data;
  person(env, 'wait@x.com', false);
  assert.equal(env.call('addMember', env.admin, { projectId: p.id, email: 'wait@x.com' }).code, 'NOT_APPROVED');
  assert.equal(env.call('addMember', env.admin, { projectId: p.id, email: 'ghost@x.com' }).code, 'NOT_APPROVED');

  person(env, 'bob@x.com');
  const m = env.call('addMember', env.admin, { projectId: p.id, email: 'bob@x.com' }).data;
  assert.deepEqual([m.email, m.role, m.name, m.status], ['bob@x.com', 'member', 'bob', 'approved']);
  assert.deepEqual(env.drive.folders.get(p.folderId).viewers, ['bob@x.com']);

  env.call('addMember', env.admin, { projectId: p.id, email: 'bob@x.com', role: 'lead' });
  assert.equal(env.rows('members').filter((r) => r.email === 'bob@x.com').length, 1, 'adding again changes the role, no duplicate');
  assert.equal(env.rows('members').find((r) => r.email === 'bob@x.com').role, 'lead');
  assert.deepEqual(env.drive.folders.get(p.folderId).viewers, ['bob@x.com'], 'not shared twice');
});

test('a project lead can add and remove members, but not leads; members cannot manage; outsiders cannot see', () => {
  const env = ready();
  const p = env.call('createProject', env.admin, { name: 'P' }).data;
  const lead = person(env, 'lead@x.com');
  const mem = person(env, 'mem@x.com');
  const out = person(env, 'out@x.com');
  person(env, 'new@x.com');
  env.call('addMember', env.admin, { projectId: p.id, email: 'lead@x.com', role: 'lead' });
  env.call('addMember', env.admin, { projectId: p.id, email: 'mem@x.com' });

  assert.equal(env.call('addMember', lead, { projectId: p.id, email: 'new@x.com' }).ok, true);
  assert.equal(env.call('addMember', lead, { projectId: p.id, email: 'out@x.com', role: 'lead' }).code, 'FORBIDDEN');
  assert.equal(env.call('removeMember', lead, { projectId: p.id, email: OWNER }).code, 'FORBIDDEN', 'a lead cannot remove another lead');
  assert.equal(env.call('addMember', mem, { projectId: p.id, email: 'out@x.com' }).code, 'FORBIDDEN');
  assert.equal(env.call('removeMember', mem, { projectId: p.id, email: 'new@x.com' }).code, 'FORBIDDEN');

  assert.equal(env.call('listMembers', mem, { projectId: p.id }).data.length, 4, 'members can see who is in the project');
  assert.equal(env.call('listMembers', out, { projectId: p.id }).code, 'NOT_FOUND', 'outsiders are not told the project exists');
  assert.equal(env.call('addMember', out, { projectId: p.id, email: 'out@x.com' }).code, 'NOT_FOUND');

  assert.equal(env.call('removeMember', lead, { projectId: p.id, email: 'new@x.com' }).data.removed, true);
  assert.ok(!env.drive.folders.get(p.folderId).viewers.includes('new@x.com'), 'folder access removed');
  assert.equal(env.call('removeMember', lead, { projectId: p.id, email: 'new@x.com' }).code, 'NOT_FOUND');
  assert.equal(env.call('listMembers', mem, { projectId: p.id }).data.length, 3);
});

test('archived projects take no new members', () => {
  const env = ready();
  const p = env.call('createProject', env.admin, { name: 'P' }).data;
  person(env, 'bob@x.com');
  env.call('archiveProject', env.admin, { projectId: p.id });
  assert.equal(env.call('addMember', env.admin, { projectId: p.id, email: 'bob@x.com' }).code, 'BAD_REQUEST');
});

test('blocking someone takes away their folder access; approving again gives it back', () => {
  const env = ready();
  const a = env.call('createProject', env.admin, { name: 'A' }).data;
  const b = env.call('createProject', env.admin, { name: 'B' }).data;
  person(env, 'bob@x.com');
  env.call('addMember', env.admin, { projectId: a.id, email: 'bob@x.com' });
  env.call('addMember', env.admin, { projectId: b.id, email: 'bob@x.com' });
  const viewers = () => [a, b].map((p) => env.drive.folders.get(p.folderId).viewers.includes('bob@x.com'));
  assert.deepEqual(viewers(), [true, true]);
  env.call('setUserStatus', env.admin, { email: 'bob@x.com', status: 'blocked' });
  assert.deepEqual(viewers(), [false, false]);
  env.call('setUserStatus', env.admin, { email: 'bob@x.com', status: 'approved' });
  assert.deepEqual(viewers(), [true, true]);
});

test('a sharing problem is reported as a warning, the member is still added', () => {
  const env = ready();
  const p = env.call('createProject', env.admin, { name: 'P' }).data;
  person(env, 'someone@not-google.test');
  const res = env.call('addMember', env.admin, { projectId: p.id, email: 'someone@not-google.test' });
  assert.equal(res.ok, true);
  assert.match(res.data.warnings[0], /Could not give/);
  assert.equal(env.rows('members').length, 2);
});
