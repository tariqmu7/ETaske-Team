import type { Milestone, Task } from '../types';

/** Same limit as apps-script/Code.gs. */
export const MAX_MILESTONE = 100;

/** Milestones still in use: soonest due first, undated ones last (A→Z). */
export function liveMilestones(list: Milestone[]): Milestone[] {
  return list.filter((m) => !m.deleted).sort((a, b) =>
    (a.dueDate ? 0 : 1) - (b.dueDate ? 0 : 1) || a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

/** The milestone a task names, if it is still in use. */
export function milestoneOf(list: Milestone[], id: string | undefined): Milestone | null {
  if (!id) return null;
  const m = list.find((x) => x.id === id);
  return m && !m.deleted ? m : null;
}

export interface MilestoneProgress {
  total: number;
  done: number;
  /** Average progress of its tasks (a done task counts 100); 0 when it has none. */
  percent: number;
  /** Due date passed and not every task is done. */
  late: boolean;
}

/** How far a milestone is, worked out from the tasks linked to it. */
export function milestoneProgress(m: Milestone, tasks: Task[], today: string): MilestoneProgress {
  const mine = tasks.filter((x) => x.milestoneId === m.id);
  const done = mine.filter((x) => x.status === 'done').length;
  const sum = mine.reduce((s, x) => s + (x.status === 'done' ? 100 : x.percent), 0);
  const percent = mine.length ? Math.round(sum / mine.length) : 0;
  return { total: mine.length, done, percent, late: !!m.dueDate && m.dueDate < today && (mine.length === 0 || done < mine.length) };
}
