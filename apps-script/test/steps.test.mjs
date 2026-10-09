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
  const task = env.call('createTask', amy, { projectId: p.id, title: 'Install the pump', assigneeEmail: 'bob@x.com' }).data;
  return { ...env, admin, lead, bob, amy, out, p, q, task };
}

const ok = (res) => { assert.equal(res.ok, true, JSON.stringify(res)); return res.data; };
const taskNow = (env, id) => env.rows('tasks').find((t) => t.id === id);
const events = (env) => env.rows('messages').filter((m) => m.kind === 'event').map((m) => JSON.parse(m.text));

test('a new task can come with its milestones, in order, blanks and repeats dropped', () => {
  const env = ready();
  const t = ok(env.call('createTask', env.bob, {
    projectId: env.p.id, title: 'Weld the line', steps: [' Material on site ', '', 'Fit-up', 'material on site', 'Weld', 'Test']
  }));
  const steps = ok(env.call('sync', env.amy, { projectId: env.p.id })).steps.filter((s) => s.taskId === t.id);
  assert.deepEqual(steps.map((s) => [s.name, s.position, s.reached]), [
    ['Material on site', 1, false], ['Fit-up', 2, false], ['Weld', 3, false], ['Test', 4, false]
  ]);
  assert.equal(t.percent, 0);
  assert.equal(env.call('createTask', env.bob, { projectId: env.p.id, title: 'x', steps: 'a,b' }).code, 'BAD_REQUEST');
  assert.equal(env.call('createTask', env.bob, { projectId: env.p.id, title: 'x', steps: [5] }).code, 'BAD_REQUEST');
  assert.equal(env.call('createTask', env.bob, { projectId: env.p.id, title: 'x', steps: ['y'.repeat(101)] }).code, 'BAD_REQUEST');
  const many = Array.from({ length: 31 }, (_, i) => 'S' + i);
  assert.equal(env.call('createTask', env.bob, { projectId: env.p.id, title: 'x', steps: many }).code, 'BAD_REQUEST');
});

test('ticking milestones moves the task % and to "doing", and tells the chat which one was reached', () => {
  const env = ready();
  const pid = env.p.id;
  const add = (name) => ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name }));
  const a = add('Material on site');
  const b = add('Fitted');
  add('Tested');
  assert.equal(taskNow(env, env.task.id).percent, '0', 'adding milestones alone does not move a 0 % task');

  const r = ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, reached: true }));
  assert.deepEqual([r.reached, r.reachedBy, r.position], [true, 'bob@x.com', 1]);
  let task = taskNow(env, env.task.id);
  assert.deepEqual([task.percent, task.status], ['33', 'doing']);
  const last = events(env).pop();
  assert.equal(last.reachedStep, 'Material on site');
  assert.deepEqual(last.changes, { status: { from: 'todo', to: 'doing' }, percent: { from: 0, to: 33 } });

  ok(env.call('editStep', env.bob, { projectId: pid, stepId: b.id, reached: true }));
  assert.equal(taskNow(env, env.task.id).percent, '67');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: b.id, reached: false }));
  task = taskNow(env, env.task.id);
  assert.deepEqual([task.percent, task.status], ['33', 'doing'], 'un-ticking lowers the % but keeps "doing"');
  assert.equal(events(env).pop().reachedStep, undefined);

  // Removing the one unreached milestone of two: 1 of 2 reached → 50 %.
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: b.id, deleted: true }));
  assert.equal(taskNow(env, env.task.id).percent, '50');
  const before = events(env).length;
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, reached: true }));
  assert.equal(events(env).length, before, 'nothing changed → no chat line');
});

test('a done task stays at 100 % whatever happens to its milestones', () => {
  const env = ready();
  const pid = env.p.id;
  const a = ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name: 'One' }));
  ok(env.call('updateTask', env.bob, { projectId: pid, taskId: env.task.id, status: 'done' }));
  ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name: 'Two' }));
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, reached: true }));
  const task = taskNow(env, env.task.id);
  assert.deepEqual([task.percent, task.status], ['100', 'done']);
});

test('only people who may change the task may change its milestones', () => {
  const env = ready();
  const pid = env.p.id;
  const lone = ok(env.call('createTask', env.lead, { projectId: pid, title: 'Lead only', assigneeEmail: 'lead@x.com' }));
  assert.equal(env.call('addStep', env.bob, { projectId: pid, taskId: lone.id, name: 'x' }).code, 'FORBIDDEN');
  const s = ok(env.call('addStep', env.lead, { projectId: pid, taskId: lone.id, name: 'x' }));
  assert.equal(env.call('editStep', env.bob, { projectId: pid, stepId: s.id, reached: true }).code, 'FORBIDDEN');
  ok(env.call('editStep', env.admin, { projectId: pid, stepId: s.id, reached: true }));
  // Creator (amy) and assignee (bob) of the shared task both may.
  ok(env.call('addStep', env.amy, { projectId: pid, taskId: env.task.id, name: 'A' }));
  ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name: 'B' }));
  assert.equal(env.call('addStep', env.out, { projectId: pid, taskId: env.task.id, name: 'C' }).code, 'NOT_FOUND', 'outsiders cannot');
  assert.equal(env.call('editStep', env.out, { projectId: env.q.id, stepId: s.id, reached: false }).code, 'NOT_FOUND', 'not found from another project');
});

test('milestone names: required, unique per task (any case), rename checks too; bad inputs refused', () => {
  const env = ready();
  const pid = env.p.id;
  const add = (name, taskId = env.task.id) => env.call('addStep', env.bob, { projectId: pid, taskId, name });
  const a = ok(add('Survey'));
  const b = ok(add('Drawings'));
  assert.equal(add('  survey ').code, 'CONFLICT');
  assert.equal(add('   ').code, 'BAD_REQUEST');
  assert.equal(add('x'.repeat(101)).code, 'BAD_REQUEST');
  assert.equal(add('x', 'nope').code, 'NOT_FOUND');
  const other = ok(env.call('createTask', env.bob, { projectId: pid, title: 'Other' }));
  ok(add('Survey', other.id));  // same name on another task is fine
  assert.equal(env.call('editStep', env.bob, { projectId: pid, stepId: b.id, name: 'SURVEY' }).code, 'CONFLICT');
  assert.equal(ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, name: 'Site survey' })).name, 'Site survey');
  assert.equal(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, reached: 'yes' }).code, 'BAD_REQUEST');
  assert.equal(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, deleted: false }).code, 'BAD_REQUEST');
  assert.equal(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, move: 'left' }).code, 'BAD_REQUEST');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, deleted: true }));
  assert.equal(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, reached: true }).code, 'NOT_FOUND', 'removed');
  ok(add('Survey'));  // the name is free again
  for (let i = 0; i < 28; i++) ok(add('S' + i));
  assert.equal(add('One too many').code, 'BAD_REQUEST');
});

test('milestones move up and down; the ends do not move', () => {
  const env = ready();
  const pid = env.p.id;
  const [a, b, c] = ['A', 'B', 'C'].map((name) => ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name })));
  const order = () => env.rows('steps').filter((s) => s.deleted !== 'TRUE')
    .sort((x, y) => Number(x.position) - Number(y.position)).map((s) => s.name).join('');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: c.id, move: 'up' }));
  assert.equal(order(), 'ACB');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: c.id, move: 'up' }));
  assert.equal(order(), 'CAB');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: c.id, move: 'up' }));
  assert.equal(order(), 'CAB');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, move: 'down' }));
  assert.equal(order(), 'CBA');
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: b.id, deleted: true }));
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, move: 'up' }));
  assert.equal(order(), 'AC');
  assert.deepEqual(env.rows('steps').filter((s) => s.deleted !== 'TRUE').map((s) => s.position).sort(), ['1', '2']);
});

test('sync sends milestones: all at first, then only changed ones', () => {
  const env = ready();
  const pid = env.p.id;
  const a = ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name: 'A' }));
  ok(env.call('addStep', env.bob, { projectId: pid, taskId: env.task.id, name: 'B' }));
  env.clock.advance(5 * MIN);
  const full = ok(env.call('sync', env.amy, { projectId: pid }));
  assert.deepEqual(full.steps.map((s) => s.name), ['A', 'B']);
  env.clock.advance(5 * MIN);
  assert.deepEqual(ok(env.call('sync', env.amy, { projectId: pid, since: full.next })).steps, []);
  ok(env.call('editStep', env.bob, { projectId: pid, stepId: a.id, reached: true }));
  const later = ok(env.call('sync', env.amy, { projectId: pid, since: full.next }));
  assert.deepEqual(later.steps.map((s) => [s.name, s.reached]), [['A', true]]);
  assert.deepEqual(later.tasks.map((t) => t.percent), [50], 'the task comes along with its new %');
});

test('a follow-up task points at the task it came from and says so in the chat', () => {
  const env = ready();
  const pid = env.p.id;
  const f = ok(env.call('createTask', env.lead, { projectId: pid, title: 'Chase the supplier', parentTaskId: env.task.id }));
  assert.equal(f.parentTaskId, env.task.id);
  assert.equal(events(env).pop().parentSerial, env.task.serial);
  const ff = ok(env.call('createTask', env.bob, { projectId: pid, title: 'Second chase', parentTaskId: f.id }));
  assert.equal(ff.parentTaskId, f.id, 'a follow-up of a follow-up is fine');
  assert.equal(ok(env.call('createTask', env.bob, { projectId: pid, title: 'Plain' })).parentTaskId, '');
  const elsewhere = ok(env.call('createTask', env.admin, { projectId: env.q.id, title: 'Q task' }));
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'x', parentTaskId: elsewhere.id }).code, 'NOT_FOUND');
  assert.equal(env.call('createTask', env.bob, { projectId: pid, title: 'x', parentTaskId: 'nope' }).code, 'NOT_FOUND');
  const synced = ok(env.call('sync', env.amy, { projectId: pid })).tasks.find((t) => t.id === f.id);
  assert.equal(synced.parentTaskId, env.task.id);
  // The link cannot be changed later through updateTask.
  ok(env.call('updateTask', env.lead, { projectId: pid, taskId: f.id, parentTaskId: '' }));
  assert.equal(taskNow(env, f.id).parentTaskId, env.task.id);
});
