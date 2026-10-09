import type { FollowUp, Task } from '../types';

/** Same limit as apps-script/Code.gs. */
export const MAX_FOLLOWUP = 2000;

/** One task's live follow-ups, newest first. */
export function followUpsOf(list: FollowUp[], taskId: string): FollowUp[] {
  return list.filter((f) => f.taskId === taskId && !f.deleted).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Overdue = the day passed; today = chase it today; soon = a later day. */
export type FollowUpState = 'overdue' | 'today' | 'soon';

/**
 * Each task's next follow-up day: the newest live entry's `nextDate` (an entry without one
 * means nothing is pending). Done tasks have none.
 */
export function nextFollowUps(list: FollowUp[], tasks: Task[]): Map<string, string> {
  const newest = new Map<string, FollowUp>();
  for (const f of list) {
    if (f.deleted) continue;
    const cur = newest.get(f.taskId);
    if (!cur || f.createdAt > cur.createdAt) newest.set(f.taskId, f);
  }
  const out = new Map<string, string>();
  for (const task of tasks) {
    const f = newest.get(task.id);
    if (f?.nextDate && task.status !== 'done') out.set(task.id, f.nextDate);
  }
  return out;
}

export function followUpState(day: string, today: string): FollowUpState {
  return day < today ? 'overdue' : day === today ? 'today' : 'soon';
}
