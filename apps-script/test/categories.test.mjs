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

test('any member adds a category; the same name (any case) is not added twice', () => {
  const env = ready();
  const pid = env.p.id;
  const a = ok(env.call('addCategory', env.bob, { projectId: pid, name: '  Design ' }));
  assert.equal(a.name, 'Design');
  assert.equal(ok(env.call('addCategory', env.lead, { projectId: pid, name: 'design' })).id, a.id);
  ok(env.call('addCategory', env.bob, { projectId: pid, name: 'Site work' }));
  assert.equal(env.rows('categories').length, 2);
  assert.equal(env.call('addCategory', env.out, { projectId: pid, name: 'X' }).code, 'NOT_FOUND', 'outsiders cannot');
  assert.equal(env.call('addCategory', env.bob, { projectId: pid, name: '' }).code, 'BAD_REQUEST');
  assert.equal(env.call('addCategory', env.bob, { projectId: pid, name: 'x'.repeat(61) }).code, 'BAD_REQUEST');
});

test('tasks carry a category of their own project only', () => {
  const env = ready();
  const pid = env.p.id;
  const cat = ok(env.call('addCategory', env.bob, { projectId: pid, name: 'Design' }));
  const other = ok(env.call('addCategory', env.out, { projectId: env.q.id, name: 'Other' }));
  const t = ok(env.call('createTask', env.bob, { projectId: pid, title: 'T', categoryId: cat.id }));
  assert.equal(t.categoryId, cat.id);
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'T', categoryId: other.id }).code, 'BAD_REQUEST');
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'T', categoryId: 'nope' }).code, 'BAD_REQUEST');
  const events = () => ok(env.call('sync', env.bob, { projectId: pid })).messages.length;
  const before = events();
  assert.equal(ok(env.call('updateTask', env.bob, { projectId: pid, taskId: t.id, categoryId: '' })).categoryId, '');
  assert.equal(events(), before, 'a category change is not chat news');
});

test('only lead or admin renames or removes; removed categories cannot be picked, adding the name brings it back', () => {
  const env = ready();
  const pid = env.p.id;
  const cat = ok(env.call('addCategory', env.bob, { projectId: pid, name: 'Desgin' }));
  ok(env.call('addCategory', env.bob, { projectId: pid, name: 'Site' }));
  assert.equal(env.call('editCategory', env.bob, { projectId: pid, categoryId: cat.id, name: 'Design' }).code, 'FORBIDDEN');
  assert.equal(ok(env.call('editCategory', env.lead, { projectId: pid, categoryId: cat.id, name: 'Design' })).name, 'Design');
  assert.equal(env.call('editCategory', env.lead, { projectId: pid, categoryId: cat.id, name: 'site' }).code, 'CONFLICT');
  assert.equal(env.call('editCategory', env.lead, { projectId: pid, categoryId: 'nope', name: 'a' }).code, 'NOT_FOUND');

  const gone = ok(env.call('editCategory', env.admin, { projectId: pid, categoryId: cat.id, deleted: true }));
  assert.equal(gone.deleted, true);
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'T', categoryId: cat.id }).code, 'BAD_REQUEST');
  const back = ok(env.call('addCategory', env.bob, { projectId: pid, name: 'DESIGN' }));
  assert.deepEqual([back.id, back.deleted], [cat.id, false]);
});

test('sync sends categories: all at first, then only changed ones', () => {
  const env = ready();
  const pid = env.p.id;
  const a = ok(env.call('addCategory', env.bob, { projectId: pid, name: 'A' }));
  ok(env.call('addCategory', env.bob, { projectId: pid, name: 'B' }));
  env.clock.advance(5 * MIN);
  const full = ok(env.call('sync', env.bob, { projectId: pid }));
  assert.deepEqual(full.categories.map((c) => c.name), ['A', 'B']);
  env.clock.advance(5 * MIN);
  ok(env.call('editCategory', env.lead, { projectId: pid, categoryId: a.id, name: 'A2' }));
  env.clock.advance(5 * MIN);
  const delta = ok(env.call('sync', env.bob, { projectId: pid, since: full.next }));
  assert.deepEqual(delta.categories.map((c) => c.name), ['A2']);
});

test('an older Sheet without the new tab or column is brought up to date by itself', () => {
  const env = ready();
  const pid = env.p.id;
  // Simulate the live Sheet made by the previous version: no categories tab, no categoryId column.
  const sheets = env.sheets;
  sheets.splice(sheets.findIndex((s) => s.name === 'categories'), 1);
  const tasks = env.ss.getSheetByName('tasks');
  const col = tasks.cells[0].indexOf('categoryId');
  tasks.cells.forEach((r) => r.splice(col, 1));
  ok(env.call('createTask', env.bob, { projectId: pid, title: 'Old style' }));
  const cat = ok(env.call('addCategory', env.bob, { projectId: pid, name: 'New' }));
  const t = ok(env.call('createTask', env.bob, { projectId: pid, title: 'New style', categoryId: cat.id }));
  assert.equal(t.categoryId, cat.id);
  assert.ok(env.ss.getSheetByName('categories'));
  assert.deepEqual(env.rows('tasks').map((r) => r.categoryId ?? ''), ['', cat.id]);
});
