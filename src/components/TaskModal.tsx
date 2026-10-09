import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import { errorText } from '../lib/errors';
import { displayName, timeAgo } from '../lib/format';
import {
  MAX_TASK_TEXT, MAX_TASK_TITLE, TASK_PRIORITIES, TASK_STATUSES, taskPriorityLabel, taskStatusLabel,
} from '../lib/tasks';
import type { Member, Task, TaskPriority, TaskStatus } from '../types';

/** What a new task starts with — e.g. a chat message being turned into a task. */
export interface TaskSeed {
  title?: string;
  details?: string;
  assigneeEmail?: string;
  fromMessageId?: string;
}

interface Props {
  projectId: string;
  call: Session['call'];
  /** Members who can be assigned (blocked people are left out by the caller). */
  members: Member[];
  /** Everyone's names, for "made by". */
  people: Map<string, { name: string }>;
  /** The task to show or change; null = a new task. */
  task: Task | null;
  seed?: TaskSeed;
  /** False: the form is shown read-only, with the reason. */
  canEdit: boolean;
  onSaved: (task: Task) => void;
  onClose: () => void;
}

interface Fields {
  title: string;
  details: string;
  assigneeEmail: string;
  status: TaskStatus;
  percent: number;
  priority: TaskPriority;
  dueDate: string;
}

function fieldsOf(task: Task | null, seed: TaskSeed | undefined): Fields {
  if (task) {
    return {
      title: task.title, details: task.details, assigneeEmail: task.assigneeEmail.toLowerCase(), status: task.status,
      percent: task.percent, priority: task.priority, dueDate: task.dueDate,
    };
  }
  return {
    title: seed?.title ?? '', details: seed?.details ?? '', assigneeEmail: seed?.assigneeEmail?.toLowerCase() ?? '',
    status: 'todo', percent: 0, priority: 'normal', dueDate: '',
  };
}

/** New task, or one task's details. Saves only the fields that changed. */
export function TaskModal({ projectId, call, members, people, task, seed, canEdit, onSaved, onClose }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  // Frozen at opening: a sync that changes the task meanwhile must not make
  // fields the person never touched look "changed" (and overwrite someone else).
  const [start] = useState<Fields>(() => fieldsOf(task, seed));
  const [f, setF] = useState<Fields>(start);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const readOnly = !canEdit;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setF((x) => {
    const next = { ...x, [key]: value };
    // Same rules as the server: done means 100 %; leaving done keeps the number the person picks.
    if (key === 'status' && value === 'done') next.percent = 100;
    return next;
  });

  // The assignee may have left the project since; keep them in the list so the form shows the truth.
  const choices = useMemo(() => {
    const list = members.map((m) => ({ email: m.email.toLowerCase(), name: m.name || m.email }));
    if (f.assigneeEmail && !list.some((m) => m.email === f.assigneeEmail)) {
      list.push({ email: f.assigneeEmail, name: displayName(f.assigneeEmail, people) });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [members, f.assigneeEmail, people]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    const title = f.title.trim();
    if (!title) { setError(t('Write a short title for the task.')); return; }
    const values = { ...f, title, details: f.details.trim() };

    let args: Record<string, unknown>;
    if (task) {
      const changed: Record<string, unknown> = {};
      (Object.keys(values) as (keyof Fields)[]).forEach((k) => { if (values[k] !== start[k]) changed[k] = values[k]; });
      if (!Object.keys(changed).length) { onClose(); return; }
      args = { projectId, taskId: task.id, ...changed };
    } else {
      args = { projectId, ...values, fromMessageId: seed?.fromMessageId || undefined };
    }

    setSaving(true);
    setError('');
    try {
      onSaved(await call<Task>(task ? 'updateTask' : 'createTask', args));
    } catch (err) {
      setError(errorText(t, err, {
        FORBIDDEN: t('Only the person assigned, the person who made the task, the project lead or an admin can change it.'),
        NOT_FOUND: task ? t('This task no longer exists.') : t('The message was deleted, so it cannot become a task.'),
      }));
      setSaving(false);
    }
  };

  const titleId = 'task-modal-title';
  const heading = task ? `${task.serial}` : seed?.fromMessageId ? t('Make it a task') : t('New task');

  return createPortal(
    <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <form className="modal task-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <h2 id={titleId} style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>
            {task ? <span className="ltr-data">{heading}</span> : heading}
          </h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={saving} aria-label={t('Close')}><X style={{ width: 16, height: 16 }} /></button>
        </div>

        {readOnly && (
          <p className="task-modal-note">{t('Only the person assigned, the person who made the task, the project lead or an admin can change it.')}</p>
        )}

        <label className="input-label" htmlFor="tm-title">{t('Task')}</label>
        <input
          id="tm-title" className="input" dir="auto" value={f.title} onChange={(e) => set('title', e.target.value)}
          maxLength={MAX_TASK_TITLE} autoFocus={!task} required readOnly={readOnly} aria-invalid={!!error && !f.title.trim()}
        />

        <label className="input-label" htmlFor="tm-details" style={{ marginTop: 12 }}>{t('Details (optional)')}</label>
        <textarea
          id="tm-details" className="input" dir="auto" value={f.details} onChange={(e) => set('details', e.target.value)}
          maxLength={MAX_TASK_TEXT} rows={3} style={{ resize: 'vertical' }} readOnly={readOnly}
        />

        <div className="task-modal-grid">
          <div>
            <label className="input-label" htmlFor="tm-who">{t('Assigned to')}</label>
            <select id="tm-who" className="input" value={f.assigneeEmail} onChange={(e) => set('assigneeEmail', e.target.value)} disabled={readOnly}>
              <option value="">{t('Not assigned')}</option>
              {choices.map((m) => <option key={m.email} value={m.email}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label" htmlFor="tm-due">{t('Due date (optional)')}</label>
            <input id="tm-due" type="date" className="input" dir="ltr" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} readOnly={readOnly} />
          </div>
          <div>
            <label className="input-label" htmlFor="tm-status">{t('Status')}</label>
            <select id="tm-status" className="input" value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)} disabled={readOnly}>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{taskStatusLabel(t, s)}</option>)}
            </select>
          </div>
          <div>
            <label className="input-label" htmlFor="tm-priority">{t('Priority')}</label>
            <select id="tm-priority" className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as TaskPriority)} disabled={readOnly}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{taskPriorityLabel(t, p)}</option>)}
            </select>
          </div>
        </div>

        <label className="input-label" htmlFor="tm-percent" style={{ marginTop: 12 }}>
          {t('Progress')} <span className="ltr-data" style={{ color: 'var(--text-primary)' }}>{f.percent}%</span>
        </label>
        <input
          id="tm-percent" type="range" min={0} max={100} step={5} value={f.percent} className="task-range"
          onChange={(e) => set('percent', Number(e.target.value))} disabled={readOnly || f.status === 'done'}
        />

        {task && (
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
            {t('Made by {{name}}, {{when}}', { name: displayName(task.createdBy, people), when: timeAgo(task.createdAt, lang) })}
          </p>
        )}
        {!task && seed?.fromMessageId && (
          <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>{t('A line about the new task is posted in the chat as a reply to the message.')}</p>
        )}
        {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 10 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{readOnly ? t('Close') : t('Cancel')}</button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('Saving…') : task ? t('Save changes') : t('Create task')}
            </button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}
