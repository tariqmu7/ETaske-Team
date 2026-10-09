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
  const out = person('out@x.com');
  const p = env.call('createProject', admin, { name: 'P' }).data;
  const q = env.call('createProject', admin, { name: 'Q' }).data;
  env.call('addMember', admin, { projectId: p.id, email: 'lead@x.com', role: 'lead' });
  env.call('addMember', admin, { projectId: p.id, email: 'bob@x.com' });
  env.call('addMember', admin, { projectId: q.id, email: 'out@x.com' });
  return { ...env, admin, lead, bob, out, p, q };
}

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res.data; };

test('only the lead or an admin adds a milestone; same live name is a conflict', () => {
  const env = ready();
  const pid = env.p.id;
  assert.equal(env.call('addMilestone', env.bob, { projectId: pid, name: 'Go-live' }).code, 'FORBIDDEN');
  const m = ok(env.call('addMilestone', env.lead, { projectId: pid, name: '  Go-live ', dueDate: '2026-12-01' }));
  assert.deepEqual([m.name, m.dueDate, m.deleted], ['Go-live', '2026-12-01', false]);
  const noDate = ok(env.call('addMilestone', env.admin, { projectId: pid, name: 'Design sign-off' }));
  assert.equal(noDate.dueDate, '');
  assert.equal(env.call('addMilestone', env.admin, { projectId: pid, name: 'GO-LIVE' }).code, 'CONFLICT');
  assert.equal(env.call('addMilestone', env.lead, { projectId: pid, name: 'X', dueDate: '2026-02-30' }).code, 'BAD_REQUEST');
  assert.equal(env.call('addMilestone', env.lead, { projectId: pid, name: '' }).code, 'BAD_REQUEST');
  assert.equal(env.call('addMilestone', env.out, { projectId: pid, name: 'X' }).code, 'NOT_FOUND', 'outsiders cannot');
  assert.equal(env.rows('milestones').length, 2);
});

test('tasks link to a milestone of their own project only; the link is not chat news', () => {
  const env = ready();
  const pid = env.p.id;
  const m = ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'M1' }));
  const other = ok(env.call('addMilestone', env.admin, { projectId: env.q.id, name: 'Other' }));
  const t = ok(env.call('createTask', env.bob, { projectId: pid, title: 'T', milestoneId: m.id }));
  assert.equal(t.milestoneId, m.id);
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'T', milestoneId: other.id }).code, 'BAD_REQUEST');
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'T', milestoneId: 'nope' }).code, 'BAD_REQUEST');
  const events = () => ok(env.call('sync', env.bob, { projectId: pid })).messages.length;
  const before = events();
  assert.equal(ok(env.call('updateTask', env.bob, { projectId: pid, taskId: t.id, milestoneId: '' })).milestoneId, '');
  assert.equal(ok(env.call('updateTask', env.bob, { projectId: pid, taskId: t.id, milestoneId: m.id })).milestoneId, m.id);
  assert.equal(events(), before, 'a milestone change is not chat news');
});

test('lead or admin renames, re-dates and removes; a removed milestone cannot be picked and adding its name brings it back', () => {
  const env = ready();
  const pid = env.p.id;
  const m = ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'Phse 1', dueDate: '2026-11-01' }));
  ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'Phase 2' }));
  assert.equal(env.call('editMilestone', env.bob, { projectId: pid, milestoneId: m.id, name: 'Phase 1' }).code, 'FORBIDDEN');
  const fixed = ok(env.call('editMilestone', env.lead, { projectId: pid, milestoneId: m.id, name: 'Phase 1', dueDate: '2026-11-15' }));
  assert.deepEqual([fixed.name, fixed.dueDate], ['Phase 1', '2026-11-15']);
  assert.equal(ok(env.call('editMilestone', env.lead, { projectId: pid, milestoneId: m.id, dueDate: '' })).dueDate, '');
  assert.equal(env.call('editMilestone', env.lead, { projectId: pid, milestoneId: m.id, name: 'phase 2' }).code, 'CONFLICT');
  assert.equal(env.call('editMilestone', env.lead, { projectId: pid, milestoneId: 'nope', name: 'a' }).code, 'NOT_FOUND');
  assert.equal(env.call('editMilestone', env.lead, { projectId: pid, milestoneId: m.id, deleted: 'yes' }).code, 'BAD_REQUEST');

  const t = ok(env.call('createTask', env.bob, { projectId: pid, title: 'T', milestoneId: m.id }));
  assert.equal(ok(env.call('editMilestone', env.admin, { projectId: pid, milestoneId: m.id, deleted: true })).deleted, true);
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'T2', milestoneId: m.id }).code, 'BAD_REQUEST');
  assert.equal(env.rows('tasks').find((r) => r.id === t.id).milestoneId, m.id, 'old tasks keep the id; the app shows none');
  const back = ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'PHASE 1', dueDate: '2027-01-10' }));
  assert.deepEqual([back.id, back.deleted, back.name, back.dueDate], [m.id, false, 'PHASE 1', '2027-01-10']);
});

test('sync sends milestones: all at first, then only changed ones', () => {
  const env = ready();
  const pid = env.p.id;
  const a = ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'A' }));
  ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'B' }));
  env.clock.advance(5 * MIN);
  const full = ok(env.call('sync', env.bob, { projectId: pid }));
  assert.deepEqual(full.milestones.map((m) => m.name), ['A', 'B']);
  env.clock.advance(5 * MIN);
  ok(env.call('editMilestone', env.lead, { projectId: pid, milestoneId: a.id, dueDate: '2026-12-31' }));
  env.clock.advance(5 * MIN);
  const delta = ok(env.call('sync', env.bob, { projectId: pid, since: full.next }));
  assert.deepEqual(delta.milestones.map((m) => [m.name, m.dueDate]), [['A', '2026-12-31']]);
});

test('archived projects take no milestone changes', () => {
  const env = ready();
  const pid = env.p.id;
  const m = ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'A' }));
  ok(env.call('archiveProject', env.admin, { projectId: pid, archived: true }));
  assert.notEqual(env.call('addMilestone', env.admin, { projectId: pid, name: 'B' }).ok, true);
  assert.notEqual(env.call('editMilestone', env.admin, { projectId: pid, milestoneId: m.id, name: 'C' }).ok, true);
});

test('an older Sheet without the milestones tab or column is brought up to date by itself', () => {
  const env = ready();
  const pid = env.p.id;
  const sheets = env.sheets;
  sheets.splice(sheets.findIndex((s) => s.name === 'milestones'), 1);
  const tasks = env.ss.getSheetByName('tasks');
  const col = tasks.cells[0].indexOf('milestoneId');
  tasks.cells.forEach((r) => r.splice(col, 1));
  ok(env.call('createTask', env.bob, { projectId: pid, title: 'Old style' }));
  const m = ok(env.call('addMilestone', env.lead, { projectId: pid, name: 'New' }));
  const t = ok(env.call('createTask', env.bob, { projectId: pid, title: 'New style', milestoneId: m.id }));
  assert.equal(t.milestoneId, m.id);
  assert.ok(env.ss.getSheetByName('milestones'));
  assert.deepEqual(env.rows('tasks').map((r) => r.milestoneId ?? ''), ['', m.id]);
});
