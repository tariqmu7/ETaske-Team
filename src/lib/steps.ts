import type { Step, Task } from '../types';

/** Same limits as apps-script/Code.gs (MAX_STEP, MAX_STEPS). */
export const MAX_STEP_NAME = 100;
export const MAX_STEPS = 30;

/** One task's live milestones, in their set order. */
export function stepsOf(steps: Step[], taskId: string): Step[] {
  return steps
    .filter((s) => s.taskId === taskId && !s.deleted)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/** Task id → { reached, total } for every task that has milestones. */
export function stepCounts(steps: Step[]): Map<string, { reached: number; total: number }> {
  const map = new Map<string, { reached: number; total: number }>();
  for (const s of steps) {
    if (s.deleted) continue;
    const c = map.get(s.taskId) ?? { reached: 0, total: 0 };
    c.total++;
    if (s.reached) c.reached++;
    map.set(s.taskId, c);
  }
  return map;
}

/** The follow-up tasks made from `taskId`, oldest first. */
export function followUpTasksOf(tasks: Task[], taskId: string): Task[] {
  return tasks
    .filter((x) => x.parentTaskId === taskId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
