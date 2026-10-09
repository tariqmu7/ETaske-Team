import type { TFunction } from 'i18next';
import type { Task, TaskPriority, TaskStatus, User } from '../types';

/** Same limits as apps-script/Code.gs. */
export const MAX_TASK_TITLE = 200;
export const MAX_TASK_TEXT = 4000;
export const TASK_STATUSES: TaskStatus[] = ['todo', 'doing', 'blocked', 'done'];
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high'];

export function taskStatusLabel(t: TFunction, s: TaskStatus | undefined): string {
  switch (s) {
    case 'todo': return t('To do');
    case 'doing': return t('In progress');
    case 'blocked': return t('Blocked (task status)');
    case 'done': return t('Done');
    default: return '';
  }
}

export function taskPriorityLabel(t: TFunction, p: TaskPriority): string {
  switch (p) {
    case 'low': return t('Low');
    case 'high': return t('High');
    default: return t('Normal');
  }
}

/** The badge class for a status (index.css badge colours). */
export function taskStatusClass(s: TaskStatus): string {
  switch (s) {
    case 'doing': return 'badge-inprogress';
    case 'blocked': return 'badge-urgent';
    case 'done': return 'badge-done';
    default: return 'badge-closed';
  }
}

/** Not done and its due day (YYYY-MM-DD) is before `today` (the reader's own calendar day). */
export function isLate(task: Task, today: string): boolean {
  return task.status !== 'done' && !!task.dueDate && task.dueDate < today;
}

const STATUS_ORDER: Record<TaskStatus, number> = { blocked: 0, doing: 1, todo: 2, done: 3 };
const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

/** Late first, then blocked → in progress → to do → done, then nearest due day, then priority, then serial. */
export function compareTasks(a: Task, b: Task, today: string): number {
  const late = Number(isLate(b, today)) - Number(isLate(a, today));
  if (late) return late;
  const status = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (status) return status;
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  if (priority) return priority;
  return a.serial.localeCompare(b.serial, undefined, { numeric: true });
}

/** Mirrors canEditTask_ on the server: the assignee, the creator, the project lead or an admin. */
export function canEditTask(task: Task, me: User, isLead: boolean): boolean {
  const email = me.email.toLowerCase();
  return me.role === 'admin' || isLead || task.createdBy.toLowerCase() === email || task.assigneeEmail.toLowerCase() === email;
}
