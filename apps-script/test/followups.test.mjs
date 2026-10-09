import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, OWNER } from './fakes.mjs';

const MIN = 60 * 1000;

function ready() {
  const env = makeEnv();
  env.context.setup();
  const admin = env.token(OWNER);
  env.call('me', admin);
  const person = (email) => {
    const t = env.token(email);
    env.call('me', t);
    env.call('setUserStatus', admin, { email, status: 'approved' });
    return t;
  };
  const lead = person('lead@x.com');
  const bob = person('bob@x.com');
  const amy = person('amy@x.com');
  const out = person('out@x.com');
  const p = env.call('createProject', admin, { name: 'P' }).data;
  const q = env.call('createProject', admin, { name: 'Q' }).data;
  env.call('addMember', admin, { projectId: p.id, email: 'lead@x.com', role: 'lead' });
  env.call('addMember', admin, { projectId: p.id, email: 'bob@x.com' });
  env.call('addMember', admin, { projectId: p.id, email: 'amy@x.com' });
  env.call('addMember', admin, { projectId: q.id, email: 'out@x.com' });
  const task = env.call('createTask', bob, { projectId: p.id, title: 'Get the pump quote', assigneeEmail: 'bob@x.com' }).data;
  return { ...env, admin, lead, bob, amy, out, p, q, task };
}

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res.data; };

test('anyone in the project adds a follow-up with a note and an optional next date; it is not chat news', () => {
  const env = ready();
  const pid = env.p.id;
  const chat = () => ok(env.call('sync', env.bob, { projectId: pid })).messages.length;
  const before = chat();
  const f = ok(env.call('addFollowUp', env.amy, { projectId: pid, taskId: env.task.id, note: '  Called the supplier ', nextDate: '2026-10-12' }));
  assert.deepEqual([f.taskId, f.authorEmail, f.note, f.nextDate, f.deleted], [env.task.id, 'amy@x.com', 'Called the supplier', '2026-10-12', false]);
  assert.equal(ok(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: 'Quote received' })).nextDate, '');
  assert.equal(chat(), before, 'a follow-up does not post in the chat');
  assert.equal(env.rows('followups').length, 2);
});

test('follow-ups need a real task of this project, a note and a real date', () => {
  const env = ready();
  const pid = env.p.id;
  const other = ok(env.call('createTask', env.admin, { projectId: env.q.id, title: 'Elsewhere' }));
  assert.equal(env.call('addFollowUp', env.bob, { projectId: pid, taskId: other.id, note: 'x' }).code, 'NOT_FOUND');
  assert.equal(env.call('addFollowUp', env.bob, { projectId: pid, taskId: 'nope', note: 'x' }).code, 'NOT_FOUND');
  assert.equal(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: '   ' }).code, 'BAD_REQUEST');
  assert.equal(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: 'x', nextDate: '2026-02-30' }).code, 'BAD_REQUEST');
  assert.equal(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: 'x'.repeat(2001) }).code, 'BAD_REQUEST');
  assert.equal(env.call('addFollowUp', env.out, { projectId: pid, taskId: env.task.id, note: 'x' }).code, 'NOT_FOUND', 'outsiders cannot');
  assert.equal(env.rows('followups').length, 0);
});

test('the writer, the lead or an admin removes a follow-up; others cannot', () => {
  const env = ready();
  const pid = env.p.id;
  const add = (who) => ok(env.call('addFollowUp', who, { projectId: pid, taskId: env.task.id, note: 'n' }));
  const a = add(env.amy);
  assert.equal(env.call('deleteFollowUp', env.bob, { projectId: pid, followUpId: a.id }).code, 'FORBIDDEN');
  assert.equal(ok(env.call('deleteFollowUp', env.amy, { projectId: pid, followUpId: a.id })).deleted, true);
  assert.equal(env.call('deleteFollowUp', env.amy, { projectId: pid, followUpId: a.id }).code, 'NOT_FOUND', 'already removed');
  assert.equal(ok(env.call('deleteFollowUp', env.lead, { projectId: pid, followUpId: add(env.bob).id })).deleted, true);
  assert.equal(ok(env.call('deleteFollowUp', env.admin, { projectId: pid, followUpId: add(env.bob).id })).deleted, true);
  assert.equal(env.call('deleteFollowUp', env.out, { projectId: pid, followUpId: add(env.bob).id }).code, 'NOT_FOUND');
  assert.equal(env.rows('followups').length, 4, 'removed rows stay in the Sheet');
});

test('sync sends follow-ups: all at first, then only new or removed ones', () => {
  const env = ready();
  const pid = env.p.id;
  const a = ok(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: 'A' }));
  ok(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: 'B' }));
  env.clock.advance(5 * MIN);
  const full = ok(env.call('sync', env.amy, { projectId: pid }));
  assert.deepEqual(full.followUps.map((f) => f.note), ['A', 'B']);
  env.clock.advance(5 * MIN);
  ok(env.call('deleteFollowUp', env.bob, { projectId: pid, followUpId: a.id }));
  ok(env.call('addFollowUp', env.lead, { projectId: pid, taskId: env.task.id, note: 'C', nextDate: '2026-11-01' }));
  env.clock.advance(5 * MIN);
  const delta = ok(env.call('sync', env.amy, { projectId: pid, since: full.next }));
  assert.deepEqual(delta.followUps.map((f) => [f.note, f.deleted]), [['A', true], ['C', false]]);
});

test('archived projects take no follow-up changes; a note starting with = stays text', () => {
  const env = ready();
  const pid = env.p.id;
  const f = ok(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: '=1+1' }));
  assert.equal(ok(env.call('sync', env.bob, { projectId: pid })).followUps[0].note, '=1+1');
  ok(env.call('archiveProject', env.admin, { projectId: pid, archived: true }));
  assert.notEqual(env.call('addFollowUp', env.admin, { projectId: pid, taskId: env.task.id, note: 'x' }).ok, true);
  assert.notEqual(env.call('deleteFollowUp', env.admin, { projectId: pid, followUpId: f.id }).ok, true);
});

test('an older Sheet without the followups tab gets it by itself', () => {
  const env = ready();
  const pid = env.p.id;
  env.sheets.splice(env.sheets.findIndex((s) => s.name === 'followups'), 1);
  ok(env.call('addFollowUp', env.bob, { projectId: pid, taskId: env.task.id, note: 'First' }));
  assert.ok(env.ss.getSheetByName('followups'));
  assert.equal(ok(env.call('sync', env.bob, { projectId: pid })).followUps.length, 1);
});
