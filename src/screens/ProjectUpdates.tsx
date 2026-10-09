import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Check, FileText, Flag, ImagePlus, Loader2, Pencil, X } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { ChatImage, FileChip } from '../components/FileViews';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { errorText } from '../lib/errors';
import { MAX_FILE_BYTES, formatSize, shrinkImage, toBase64 } from '../lib/files';
import { clockTime, dayLabel, displayName, localDay } from '../lib/format';
import { stepsOf } from '../lib/steps';
import { MAX_TASK_TEXT, TASK_STATUSES, canEditTask, compareTasks, taskStatusClass, taskStatusLabel } from '../lib/tasks';
import type { DailyUpdate, FileItem, Member, Step, Task, TaskStatus, User } from '../types';

type Sync = ReturnType<typeof useProjectSync>;

/** Same as MAX_LIST in apps-script/Code.gs: files or tasks on one update. */
const MAX_LIST = 20;

interface Props {
  projectId: string;
  me: User;
  call: Session['call'];
  sync: Sync;
  members: Member[];
  people: Map<string, { name: string; photoUrl: string }>;
  isLead: boolean;
  archived: boolean;
}

class TooBig extends Error {}

/** Daily "what I did / what is left / what blocks me": today's form, who has not posted, the team's feed by day. */
export function ProjectUpdates({ projectId, me, call, sync, members, people, isLead, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const myEmail = me.email.toLowerCase();
  const today = localDay(Date.now());
  const [editing, setEditing] = useState(false);

  const fileById = useMemo(() => new Map(sync.files.map((f) => [f.id, f])), [sync.files]);
  const taskById = useMemo(() => new Map(sync.tasks.map((x) => [x.id, x])), [sync.tasks]);
  // Milestones a person reached on a task that day: shown under that task on their day's card.
  const reachedByDay = useMemo(() => {
    const map = new Map<string, Step[]>();
    for (const s of sync.steps) {
      if (s.deleted || !s.reached || !s.reachedAt) continue;
      const key = `${s.taskId}|${s.reachedBy.toLowerCase()}|${localDay(s.reachedAt)}`;
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [sync.steps]);
  const mine = sync.updates.find((u) => u.date === today && u.authorEmail.toLowerCase() === myEmail) ?? null;

  const postedToday = useMemo(() => new Set(sync.updates.filter((u) => u.date === today).map((u) => u.authorEmail.toLowerCase())), [sync.updates, today]);
  const team = members.filter((m) => m.status !== 'blocked');
  const missing = team.filter((m) => !postedToday.has(m.email.toLowerCase()));

  // Newest day first; inside a day, most recently changed first.
  const days = useMemo(() => {
    const map = new Map<string, DailyUpdate[]>();
    for (const u of sync.updates) map.set(u.date, [...(map.get(u.date) ?? []), u]);
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, list: list.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt)) }));
  }, [sync.updates]);

  const words = { today: t('Today'), yesterday: t('Yesterday') };
  const showForm = !archived && sync.loaded && (!mine || editing);

  return (
    <div className="project-pane">
      {showForm && (
        <UpdateForm
          key={mine?.id ?? 'new'}
          projectId={projectId}
          call={call}
          sync={sync}
          me={me}
          isLead={isLead}
          today={today}
          existing={mine}
          fileById={fileById}
          onDone={() => setEditing(false)}
          onCancel={mine ? () => setEditing(false) : undefined}
        />
      )}

      {!archived && sync.loaded && mine && !editing && (
        <div className="update-posted" role="status">
          <Check style={{ width: 16, height: 16, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{t('Your update for today is posted.')}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Pencil style={{ width: 14, height: 14 }} />{t('Edit')}</button>
        </div>
      )}

      {sync.loaded && team.length > 0 && (
        <div className="update-missing">
          <div className="update-missing-head">
            <span>{t('Posted today: {{done}} of {{total}}', { done: team.length - missing.length, total: team.length })}</span>
            <span className="progress-bar update-missing-bar" aria-hidden="true">
              <span className="progress-fill" style={{ display: 'block', width: `${Math.round(((team.length - missing.length) / team.length) * 100)}%` }} />
            </span>
          </div>
          {missing.length > 0 ? (
            <>
            <div className="update-missing-label">{t('Not posted yet today')}</div>
            <ul className="update-missing-list" aria-label={t('Not posted yet today')}>
              {missing.map((m) => (
                <li key={m.email}>
                  <Avatar name={m.name} email={m.email} photoUrl={m.photoUrl} size={22} />
                  <bdi>{m.name || displayName(m.email, people)}</bdi>
                </li>
              ))}
            </ul>
            </>
          ) : (
            <div className="text-muted" style={{ fontSize: 13 }}>{t('Everyone has posted today.')}</div>
          )}
        </div>
      )}

      {!sync.loaded && (
        <div className="chat-loading" aria-busy="true" style={{ padding: 40 }}>
          <div className="spinner" /><span className="text-muted">{t('Loading…')}</span>
        </div>
      )}

      {sync.loaded && days.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><CalendarCheck style={{ width: 28, height: 28 }} /></div>
          <div className="empty-state-title">{t('No daily updates yet')}</div>
          <div className="empty-state-sub">{archived ? t('This project is archived.') : t('Each person writes what they did today and what is left. The first one is yours.')}</div>
        </div>
      )}

      {days.map(({ date, list }) => (
        <section key={date} className="update-day">
          <h2 className="update-day-head">{dayLabel(`${date}T12:00:00`, lang, words)}</h2>
          {list.map((u) => {
            const author = u.authorEmail.toLowerCase();
            const person = people.get(author);
            const tasks = u.taskIds.map((id) => taskById.get(id)).filter((x): x is Task => !!x);
            const files = u.fileIds.map((id) => fileById.get(id)).filter((x): x is FileItem => !!x);
            const images = files.filter((f) => f.thumbnailUrl);
            const others = files.filter((f) => !f.thumbnailUrl);
            return (
              <article key={u.id} className="update-card">
                <header className="update-card-head">
                  <Avatar name={person?.name ?? ''} email={author} photoUrl={person?.photoUrl} size={30} />
                  <bdi className="update-author">{displayName(author, people)}</bdi>
                  {author === myEmail && <span className="tag">{t('You')}</span>}
                  <span className="update-time">
                    {u.updatedAt && u.updatedAt !== u.createdAt ? t('edited {{time}}', { time: clockTime(u.updatedAt, lang) }) : clockTime(u.createdAt, lang)}
                  </span>
                </header>
                {u.done && <UpdatePart label={t('What I did')} text={u.done} />}
                {u.remaining && <UpdatePart label={t('What is left')} text={u.remaining} />}
                {u.blockers && <UpdatePart label={t('Blocking me')} text={u.blockers} warn />}
                {tasks.length > 0 && (
                  <ul className="update-tasks">
                    {tasks.map((x) => (
                      <li key={x.id}>
                        <div className="update-task">
                          <span className="task-serial ltr-data">{x.serial}</span>
                          <bdi className="update-task-title">{x.title}</bdi>
                          <span className="update-task-state">
                            <span className={`badge ${taskStatusClass(x.status)}`}>{taskStatusLabel(t, x.status)}</span>
                            <span className="update-task-pct ltr-data">{x.percent}%</span>
                          </span>
                        </div>
                        {(reachedByDay.get(`${x.id}|${author}|${u.date}`) ?? []).map((s) => (
                          <div key={s.id} className="update-task-note update-task-step">
                            <Flag style={{ width: 12, height: 12 }} aria-hidden="true" />
                            <span>{t('Reached the milestone "{{name}}"', { name: s.name })}</span>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                {images.length > 0 && <div className={`chat-images${images.length === 1 ? ' single' : ''}`}>{images.map((f) => <ChatImage key={f.id} file={f} />)}</div>}
                {others.length > 0 && <div className="chat-files">{others.map((f) => <FileChip key={f.id} file={f} />)}</div>}
              </article>
            );
          })}
        </section>
      ))}

      {sync.loaded && days.length > 0 && (
        <p className="text-muted" style={{ fontSize: 12, textAlign: 'center', margin: '16px 0 8px' }}>{t('Updates from the last 30 days are shown here.')}</p>
      )}
    </div>
  );
}

function UpdatePart({ label, text, warn }: { label: string; text: string; warn?: boolean }) {
  return (
    <div className={`update-part${warn ? ' warn' : ''}`}>
      <div className="update-part-label">{label}</div>
      <div className="update-part-text" dir="auto">{text}</div>
    </div>
  );
}

interface FormProps {
  projectId: string;
  call: Session['call'];
  sync: Sync;
  me: User;
  isLead: boolean;
  today: string;
  existing: DailyUpdate | null;
  fileById: Map<string, FileItem>;
  onDone: () => void;
  onCancel?: () => void;
}

/** What the update changes on one ticked task. `from*` = the values when the row was first touched. */
interface TaskEdit {
  status: TaskStatus;
  percent: number;
  /** Milestone id → reached, only for the ones this person ticked or unticked. */
  reached: Record<string, boolean>;
  fromStatus: TaskStatus;
  fromPercent: number;
}

/**
 * Today's update. Posting again for the same day replaces it (the server keeps one per person per day).
 * Each ticked task can also get its milestones ticked (editStep) and a new status / % (updateTask).
 * A task with milestones takes its % from them, so its slider is not shown.
 */
function UpdateForm({ projectId, call, sync, me, isLead, today, existing, fileById, onDone, onCancel }: FormProps) {
  const { t } = useTranslation();
  const myEmail = me.email.toLowerCase();
  const [done, setDone] = useState(existing?.done ?? '');
  const [remaining, setRemaining] = useState(existing?.remaining ?? '');
  const [blockers, setBlockers] = useState(existing?.blockers ?? '');
  const [taskIds, setTaskIds] = useState<string[]>(existing?.taskIds ?? []);
  const [keptFileIds, setKeptFileIds] = useState<string[]>(existing?.fileIds ?? []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  /** Files already uploaded in an earlier failed attempt, so "try again" does not send them twice. */
  const uploaded = useRef(new Map<File, FileItem>());
  const [edits, setEdits] = useState<Record<string, TaskEdit>>({});

  // My open tasks, plus any already linked (even if done since).
  const myTasks = useMemo(() => {
    const picked = new Set(taskIds);
    return sync.tasks
      .filter((x) => picked.has(x.id) || (x.assigneeEmail.toLowerCase() === myEmail && x.status !== 'done'))
      .sort((a, b) => compareTasks(a, b, today));
    // `taskIds` is left out on purpose: ticking or unticking must not make a row jump or vanish.
  }, [sync.tasks, myEmail, today]); // eslint-disable-line react-hooks/exhaustive-deps

  // Untouched rows follow the live task; a row is frozen once changed, so a later sync cannot undo the edit.
  const startEdit = (x: Task): TaskEdit => ({ status: x.status, percent: x.percent, reached: {}, fromStatus: x.status, fromPercent: x.percent });
  const editOf = (x: Task) => edits[x.id] ?? startEdit(x);
  const setEdit = (x: Task, patch: Partial<TaskEdit>) => setEdits((all) => {
    const next = { ...(all[x.id] ?? startEdit(x)), ...patch };
    if (patch.status === 'done') next.percent = 100;
    return { ...all, [x.id]: next };
  });

  const toggleTask = (id: string) => setTaskIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < MAX_LIST ? [...list, id] : list));

  const fileCount = keptFileIds.length + newFiles.length;
  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    // Copy now: clearing the picker afterwards empties this same FileList.
    const chosen = [...list];
    const room = MAX_LIST - fileCount;
    if (chosen.length > room) setError(t('You can attach up to {{count}} files to one update.', { count: MAX_LIST }));
    else setError('');
    setNewFiles((files) => [...files, ...chosen.slice(0, Math.max(0, room))]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!done.trim() && !remaining.trim() && !blockers.trim()) {
      setError(t('Write what you did, what is left, or what is blocking you.'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const ids = [...keptFileIds];
      for (let i = 0; i < newFiles.length; i++) {
        const original = newFiles[i];
        let item = uploaded.current.get(original);
        if (!item) {
          setProgress({ done: i, total: newFiles.length });
          const file = await shrinkImage(original);
          if (file.size > MAX_FILE_BYTES) throw new TooBig(file.name);
          item = await call<FileItem>('uploadFile', {
            projectId, name: file.name || 'file', mimeType: file.type || 'application/octet-stream', data: await toBase64(file),
          });
          uploaded.current.set(original, item);
          sync.putFile(item);
        }
        ids.push(item.id);
      }
      setProgress(null);
      // Task changes first, so the update card shows the new status and %.
      let ticked = false;
      for (const id of taskIds) {
        const ed = edits[id];
        const live = sync.tasks.find((x) => x.id === id);
        if (!ed || !live || !canEditTask(live, me, isLead)) continue;
        // Send only what this person changed, and only if it is not already so (a retry, or someone else did it).
        // Milestones before the status: the first tick moves a to-do task to "doing", a chosen status should win.
        const liveSteps = stepsOf(sync.steps, id);
        for (const s of liveSteps) {
          const want = ed.reached[s.id];
          if (want === undefined || want === s.reached) continue;
          sync.putStep(await call<Step>('editStep', { projectId, stepId: s.id, reached: want }));
          ticked = true;
        }
        const change: { status?: TaskStatus; percent?: number } = {};
        if (ed.status !== ed.fromStatus && ed.status !== live.status) change.status = ed.status;
        if (!liveSteps.length && ed.status !== 'done' && ed.percent !== ed.fromPercent && ed.percent !== live.percent) change.percent = ed.percent;
        if (change.status || change.percent !== undefined) sync.putTask(await call<Task>('updateTask', { projectId, taskId: id, ...change }));
      }
      // The server worked out the new % from the milestones; bring it.
      if (ticked) void sync.sync();
      const saved = await call<DailyUpdate>('postUpdate', {
        projectId, date: today, done: done.trim(), remaining: remaining.trim(), blockers: blockers.trim(), taskIds, fileIds: ids,
      });
      sync.putUpdate(saved);
      onDone();
    } catch (err) {
      setProgress(null);
      setError(err instanceof TooBig
        ? t('{{name}} is too big. The limit is 15 MB per file.', { name: err.message })
        : errorText(t, err, {
          NOT_FOUND: t('A task, milestone or file you linked was removed. Untick it and try again.'),
          FORBIDDEN: t('You can no longer change one of the ticked tasks. Untick it and try again.'),
        }));
      setSaving(false);
    }
  };

  return (
    <form className="update-form" onSubmit={submit} noValidate>
      <h2 className="update-form-title">{existing ? t('Edit your update for today') : t('Your update for today')}</h2>

      <div className="uf-fields">
        <div className="uf-field">
          <label className="input-label" htmlFor="uf-done">{t('What I did')}</label>
          <textarea id="uf-done" className="input" dir="auto" rows={3} maxLength={MAX_TASK_TEXT} value={done} onChange={(e) => setDone(e.target.value)} />
        </div>
        <div className="uf-field">
          <label className="input-label" htmlFor="uf-left">{t('What is left')}</label>
          <textarea id="uf-left" className="input" dir="auto" rows={3} maxLength={MAX_TASK_TEXT} value={remaining} onChange={(e) => setRemaining(e.target.value)} />
        </div>
        <div className="uf-field uf-field-wide">
          <label className="input-label" htmlFor="uf-block">{t('Anything blocking you? (optional)')}</label>
          <textarea id="uf-block" className="input" dir="auto" rows={2} maxLength={MAX_TASK_TEXT} value={blockers} onChange={(e) => setBlockers(e.target.value)} />
        </div>
      </div>

      {myTasks.length > 0 && (
        <fieldset className="update-form-tasks">
          <legend className="input-label">{t('Tasks you worked on (optional)')}</legend>
          <p className="text-muted update-form-hint">{t('Tick a task to tick the milestones you reached or change its status. The task is updated when you post.')}</p>
          {myTasks.map((x) => {
            const on = taskIds.includes(x.id);
            const ed = editOf(x);
            const editable = canEditTask(x, me, isLead);
            const base = `uf-${x.id}`;
            const steps = on ? stepsOf(sync.steps, x.id) : [];
            const isReached = (s: Step) => ed.reached[s.id] ?? s.reached;
            const reachedNow = steps.filter(isReached).length;
            // What the server will make of it: done stays 100, otherwise the share of milestones reached.
            const stepPercent = ed.status === 'done' ? 100 : steps.length ? Math.round((reachedNow * 100) / steps.length) : 0;
            return (
              <div key={x.id} className={`uf-task${on ? ' on' : ''}`}>
                <label className={`check-chip${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggleTask(x.id)} disabled={saving} />
                  <span className="ltr-data" style={{ fontWeight: 700 }}>{x.serial}</span>
                  <bdi className="text-truncate">{x.title}</bdi>
                  {!on && <span className="uf-task-now text-muted">{taskStatusLabel(t, x.status)} <span className="ltr-data">{x.percent}%</span></span>}
                </label>
                {on && (
                  <div className="uf-task-edit">
                    {editable ? (
                      <div className="uf-task-row">
                        <div className="uf-task-status">
                          <label className="input-label" htmlFor={`${base}-st`}>{t('Status')}</label>
                          <select id={`${base}-st`} className="input" value={ed.status} disabled={saving}
                            onChange={(e) => setEdit(x, { status: e.target.value as TaskStatus })}>
                            {TASK_STATUSES.map((s) => <option key={s} value={s}>{taskStatusLabel(t, s)}</option>)}
                          </select>
                        </div>
                        {steps.length ? (
                          <div className="uf-task-percent">
                            <span className="input-label">
                              {t('Progress')} <span className="ltr-data" style={{ color: 'var(--text-primary)' }}>{stepPercent}%</span>
                            </span>
                            <span className="progress-bar uf-step-bar" aria-hidden="true"><span className="progress-fill" style={{ display: 'block', width: `${stepPercent}%` }} /></span>
                          </div>
                        ) : (
                          <div className="uf-task-percent">
                            <label className="input-label" htmlFor={`${base}-pc`}>
                              {t('Progress')} <span className="ltr-data" style={{ color: 'var(--text-primary)' }}>{ed.percent}%</span>
                            </label>
                            <input id={`${base}-pc`} type="range" min={0} max={100} step={5} value={ed.percent} className="task-range"
                              disabled={saving || ed.status === 'done'} onChange={(e) => setEdit(x, { percent: Number(e.target.value) })} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                        {taskStatusLabel(t, x.status)} <span className="ltr-data">{x.percent}%</span> · {t('Only the person assigned, the person who made the task, the project lead or an admin can change it.')}
                      </p>
                    )}
                    {steps.length > 0 ? (
                      <fieldset className="uf-steps">
                        <legend className="input-label">
                          <Flag style={{ width: 13, height: 13 }} aria-hidden="true" />
                          {t('Milestones')} <span className="text-muted">· {t('{{reached}} of {{total}} reached', { reached: reachedNow, total: steps.length })}</span>
                        </legend>
                        {steps.map((s) => (
                          <label key={s.id} className={`uf-step${isReached(s) ? ' reached' : ''}`}>
                            <input
                              type="checkbox" checked={isReached(s)} disabled={saving || !editable}
                              onChange={(e) => setEdit(x, { reached: { ...ed.reached, [s.id]: e.target.checked } })}
                            />
                            <bdi>{s.name}</bdi>
                          </label>
                        ))}
                      </fieldset>
                    ) : (
                      <p className="text-muted uf-steps-none">{t('This task has no milestones. Open it in the Tasks tab to add them.')}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      )}

      {fileCount > 0 && (
        <ul className="chat-attachments" aria-label={t('Attached files')} style={{ marginTop: 10 }}>
          {keptFileIds.map((id) => {
            const f = fileById.get(id);
            const name = f?.name ?? t('Photo or file');
            return (
              <li key={id} className="chat-attachment">
                {f?.thumbnailUrl ? <img src={f.thumbnailUrl} alt="" referrerPolicy="no-referrer" /> : <FileText />}
                <span className="chat-attachment-name" dir="auto">{name}</span>
                <button type="button" className="chat-attachment-remove" onClick={() => setKeptFileIds((l) => l.filter((x) => x !== id))} aria-label={t('Remove {{name}}', { name })} disabled={saving}><X style={{ width: 13, height: 13 }} /></button>
              </li>
            );
          })}
          {newFiles.map((f, i) => (
            <li key={`${f.name}-${i}`} className="chat-attachment">
              <LocalPreview file={f} />
              <span className="chat-attachment-name" dir="auto">{f.name}</span>
              <span className="chat-attachment-size" dir="ltr">{formatSize(f.size)}</span>
              <button type="button" className="chat-attachment-remove" onClick={() => setNewFiles((l) => l.filter((x) => x !== f))} aria-label={t('Remove {{name}}', { name: f.name })} disabled={saving}><X style={{ width: 13, height: 13 }} /></button>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 8 }}>{error}</p>}

      <div className="update-form-actions">
        <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => picker.current?.click()} disabled={saving || fileCount >= MAX_LIST}>
          <ImagePlus style={{ width: 15, height: 15 }} />{t('Add photos or files')}
        </button>
        <span style={{ flex: 1 }} />
        {onCancel && <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel} disabled={saving}>{t('Cancel')}</button>}
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
          {saving && <Loader2 style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} />}
          {progress ? t('Uploading {{done}} of {{total}}…', { done: progress.done + 1, total: progress.total })
            : saving ? t('Saving…') : existing ? t('Save changes') : t('Post update')}
        </button>
      </div>
    </form>
  );
}

/** A thumbnail of a picked photo before it is uploaded. */
function LocalPreview({ file }: { file: File }) {
  const [url] = useState(() => (file.type.startsWith('image/') ? URL.createObjectURL(file) : ''));
  if (!url) return <FileText />;
  return <img src={url} alt="" onLoad={() => URL.revokeObjectURL(url)} />;
}
