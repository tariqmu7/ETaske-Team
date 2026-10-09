import type { Category } from '../types';

/** Same limit as apps-script/Code.gs. */
export const MAX_CATEGORY = 60;

/** Categories people can still pick, A→Z. */
export function liveCategories(list: Category[]): Category[] {
  return list.filter((c) => !c.deleted).sort((a, b) => a.name.localeCompare(b.name));
}

/** The category a task names, if it is still in use. */
export function categoryOf(list: Category[], id: string | undefined): Category | null {
  if (!id) return null;
  const c = list.find((x) => x.id === id);
  return c && !c.deleted ? c : null;
}

/** A steady colour per category (same id → same hue on every screen). */
export function categoryHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
