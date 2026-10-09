import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarCheck, Check, FileText, ImagePlus, Loader2, Pencil, X } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { ChatImage, FileChip } from '../components/FileViews';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { errorText } from '../lib/errors';
import { MAX_FILE_BYTES, formatSize, shrinkImage, toBase64 } from '../lib/files';
import { clockTime, dayLabel, displayName, localDay } from '../lib/format';
import { MAX_TASK_TEXT, compareTasks, taskStatusLabel } from '../lib/tasks';
import type { DailyUpdate, FileItem, Member, Task, User } from '../types';

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
  archived: boolean;
}

class TooBig extends Error {}

/** Daily "what I did / what is left / what blocks me": today's form, who has not posted, the team's feed by day. */
export function ProjectUpdates({ projectId, me, call, sync, members, people, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const myEmail = me.email.toLowerCase();
  const today = localDay(Date.now());
  const [editing, setEditing] = useState(false);

  const fileById = useMemo(() => new Map(sync.files.map((f) => [f.id, f])), [sync.files]);
  const taskById = useMemo(() => new Map(sync.tasks.map((x) => [x.id, x])), [sync.tasks]);
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
          myEmail={myEmail}
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
            {t('Posted today: {{done}} of {{total}}', { done: team.length - missing.length, total: team.length })}
          </div>
          {missing.length > 0 ? (
            <ul className="update-missing-list" aria-label={t('Not posted yet today')}>
              {missing.map((m) => (
                <li key={m.email}>
                  <Avatar name={m.name} email={m.email} photoUrl={m.photoUrl} size={22} />
                  <bdi>{m.name || displayName(m.email, people)}</bdi>
                </li>
              ))}
            </ul>
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
                        <span className="ltr-data" style={{ fontWeight: 700 }}>{x.serial}</span> · <bdi>{x.title}</bdi>
                        <span className="text-muted"> · {taskStatusLabel(t, x.status)} <span className="ltr-data">{x.percent}%</span></span>
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
  myEmail: string;
  today: string;
  existing: DailyUpdate | null;
  fileById: Map<string, FileItem>;
  onDone: () => void;
  onCancel?: () => void;
}

/** Today's update. Posting again for the same day replaces it (the server keeps one per person per day). */
function UpdateForm({ projectId, call, sync, myEmail, today, existing, fileById, onDone, onCancel }: FormProps) {
  const { t } = useTranslation();
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

  // My open tasks, plus any already linked (even if done since).
  const myTasks = useMemo(() => {
    const picked = new Set(taskIds);
    return sync.tasks
      .filter((x) => picked.has(x.id) || (x.assigneeEmail.toLowerCase() === myEmail && x.status !== 'done'))
      .sort((a, b) => compareTasks(a, b, today));
    // `taskIds` is left out on purpose: ticking or unticking must not make a row jump or vanish.
  }, [sync.tasks, myEmail, today]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const saved = await call<DailyUpdate>('postUpdate', {
        projectId, date: today, done: done.trim(), remaining: remaining.trim(), blockers: blockers.trim(), taskIds, fileIds: ids,
      });
      sync.putUpdate(saved);
      onDone();
    } catch (err) {
      setProgress(null);
      setError(err instanceof TooBig
        ? t('{{name}} is too big. The limit is 15 MB per file.', { name: err.message })
        : errorText(t, err, { NOT_FOUND: t('A task or file you linked was removed. Untick it and try again.') }));
      setSaving(false);
    }
  };

  return (
    <form className="update-form" onSubmit={submit} noValidate>
      <h2 className="update-form-title">{existing ? t('Edit your update for today') : t('Your update for today')}</h2>

      <label className="input-label" htmlFor="uf-done">{t('What I did')}</label>
      <textarea id="uf-done" className="input" dir="auto" rows={3} maxLength={MAX_TASK_TEXT} value={done} onChange={(e) => setDone(e.target.value)} />

      <label className="input-label" htmlFor="uf-left" style={{ marginTop: 10 }}>{t('What is left')}</label>
      <textarea id="uf-left" className="input" dir="auto" rows={2} maxLength={MAX_TASK_TEXT} value={remaining} onChange={(e) => setRemaining(e.target.value)} />

      <label className="input-label" htmlFor="uf-block" style={{ marginTop: 10 }}>{t('Anything blocking you? (optional)')}</label>
      <textarea id="uf-block" className="input" dir="auto" rows={2} maxLength={MAX_TASK_TEXT} value={blockers} onChange={(e) => setBlockers(e.target.value)} />

      {myTasks.length > 0 && (
        <fieldset className="update-form-tasks">
          <legend className="input-label">{t('Tasks you worked on (optional)')}</legend>
          {myTasks.map((x) => (
            <label key={x.id} className={`check-chip${taskIds.includes(x.id) ? ' on' : ''}`}>
              <input type="checkbox" checked={taskIds.includes(x.id)} onChange={() => toggleTask(x.id)} />
              <span className="ltr-data" style={{ fontWeight: 700 }}>{x.serial}</span>
              <bdi className="text-truncate">{x.title}</bdi>
            </label>
          ))}
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
