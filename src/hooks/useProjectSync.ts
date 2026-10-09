import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from './useSession';
import type { DailyUpdate, FileItem, Message, SyncResult, Task } from '../types';

/** docs/DESIGN.md §5: every 8 s while the project is on screen, every 60 s in a background tab. */
const VISIBLE_MS = 8 * 1000;
const HIDDEN_MS = 60 * 1000;
const OLDER_PAGE = 100;

/** The moment a row last changed; a sync that started earlier must not undo a newer copy. */
const messageStamp = (m: Message) => (m.editedAt > m.createdAt ? m.editedAt : m.createdAt);
const updateStamp = (u: DailyUpdate) => (u.updatedAt > u.createdAt ? u.updatedAt : u.createdAt);
const byCreated = (a: { createdAt: string }, b: { createdAt: string }) => a.createdAt.localeCompare(b.createdAt);

/** Rows merged by id, newer copy wins. Answers overlap by 30 s, so the same row often comes twice. */
function mergeById<T extends { id: string; createdAt: string }>(list: T[], incoming: T[], stamp: (x: T) => string): T[] {
  if (!incoming.length) return list;
  const map = new Map(list.map((x) => [x.id, x]));
  for (const x of incoming) {
    const old = map.get(x.id);
    if (!old || stamp(x) >= stamp(old)) map.set(x.id, x);
  }
  return [...map.values()].sort(byCreated);
}

export interface ProjectData {
  messages: Message[];
  tasks: Task[];
  updates: DailyUpdate[];
  files: FileItem[];
  /** Older messages exist on the server (scroll up / "Show older"). */
  hasMoreMessages: boolean;
  /** When I last read this project, as it was when I opened it. */
  lastReadAt: string;
}

const EMPTY: ProjectData = { messages: [], tasks: [], updates: [], files: [], hasMoreMessages: false, lastReadAt: '' };

/**
 * Keeps one project's messages, tasks, daily updates and files in step with the
 * server by polling `sync` (no push channel without Firebase). The first call
 * brings everything; later calls bring only what changed since `next`.
 * Mount it with `key={projectId}`: one hook instance serves one project.
 */
export function useProjectSync(projectId: string, call: Session['call']) {
  const [data, setData] = useState<ProjectData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  /** Last sync failure (the data on screen stays); null once a sync works again. */
  const [error, setError] = useState<unknown>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const cursor = useRef('');
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const alive = useRef(true);

  // The screen is keyed by project id, so a different project is a fresh mount.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const apply = useCallback((r: SyncResult) => {
    setData((d) => ({
      messages: mergeById(d.messages, r.messages, messageStamp),
      tasks: mergeById(d.tasks, r.tasks, (t) => t.updatedAt),
      updates: mergeById(d.updates, r.updates, updateStamp),
      files: mergeById(d.files, r.files, (f) => f.createdAt),
      hasMoreMessages: r.full ? r.hasMoreMessages : d.hasMoreMessages,
      lastReadAt: r.full ? r.lastReadAt : d.lastReadAt,
    }));
  }, []);

  /** One sync. A call made while another is running runs once more right after it. */
  const sync = useCallback((): Promise<void> => {
    if (inFlight.current) { again.current = true; return inFlight.current; }
    const run = async () => {
      try {
        const r = await call<SyncResult>('sync', { projectId, since: cursor.current || undefined });
        if (!alive.current || r.projectId !== projectId) return;
        cursor.current = r.next;
        apply(r);
        setLoaded(true);
        setError(null);
      } catch (err) {
        if (alive.current) setError(err);
      }
    };
    inFlight.current = run().finally(() => {
      inFlight.current = null;
      if (again.current && alive.current) { again.current = false; void sync(); }
    });
    return inFlight.current;
  }, [call, projectId, apply]);

  // Poll: fast while visible, slow in a background tab, at once when the tab comes back.
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped) return;
      timer = window.setTimeout(() => { void sync().finally(schedule); }, document.visibilityState === 'visible' ? VISIBLE_MS : HIDDEN_MS);
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') void sync().finally(schedule); };
    void sync().finally(schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sync]);

  /** Puts my own new or changed rows on screen at once, before the next sync brings them. */
  const putMessage = useCallback((m: Message) => setData((d) => ({ ...d, messages: mergeById(d.messages, [m], messageStamp) })), []);
  const putFile = useCallback((f: FileItem) => setData((d) => ({ ...d, files: mergeById(d.files, [f], (x) => x.createdAt) })), []);
  const putTask = useCallback((x: Task) => setData((d) => ({ ...d, tasks: mergeById(d.tasks, [x], (t) => t.updatedAt) })), []);
  const putUpdate = useCallback((u: DailyUpdate) => setData((d) => ({ ...d, updates: mergeById(d.updates, [u], updateStamp) })), []);

  const loadOlder = useCallback(async () => {
    const oldest = data.messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await call<{ messages: Message[]; hasMore: boolean }>('listMessages', { projectId, before: oldest.createdAt, limit: OLDER_PAGE });
      if (!alive.current) return;
      setData((d) => ({ ...d, messages: mergeById(d.messages, r.messages, messageStamp), hasMoreMessages: r.hasMore }));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }, [call, projectId, data.messages, loadingOlder]);

  return { ...data, loaded, error, sync, putMessage, putFile, putTask, putUpdate, loadOlder, loadingOlder };
}
