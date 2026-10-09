import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownRight, Flag, GitBranchPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import { errorText } from '../lib/errors';
import { displayName, shortDate, timeAgo } from '../lib/format';
import { MAX_STEPS, MAX_STEP_NAME, followUpTasksOf, stepsOf } from '../lib/steps';
import { isLate, taskPriorityLabel, taskStatusClass, taskStatusLabel } from '../lib/tasks';
import type { Category, Step, Task } from '../types';

interface Props {
  projectId: string;
  call: Session['call'];
  task: Task;
  /** All the project's tasks (to find the parent and the follow-up tasks). */
  tasks: Task[];
  /** All the project's task milestones, removed ones too. */
  steps: Step[];
  category: Category | null;
  people: Map<string, { name: string }>;
  today: string;
  /** Assignee, creator, lead or admin, and the project is not archived. */
  canEdit: boolean;
  /** Anyone in a project that is not archived. */
  canAddFollowUp: boolean;
  onStepChanged: (s: Step) => void;
  /** Brings the task's new % (the server works it out from the milestones). */
  onResync: () => void;
  /** Expand another task (the parent, or a follow-up task). */
  onShowTask: (id: string) => void;
  onEdit: () => void;
  onAddFollowUp: () => void;
}

/**
 * Everything about one task, opened in place under its row: details, its own milestones
 * (tick the ones reached, add more), and the follow-up tasks made from it.
 */
export function TaskDetail({
  projectId, call, task, tasks, steps, category, people, today, canEdit, canAddFollowUp,
  onStepChanged, onResync, onShowTask, onEdit, onAddFollowUp,
}: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');   // step id being changed, 'new' while adding
  const [error, setError] = useState('');
  const list = useMemo(() => stepsOf(steps, task.id), [steps, task.id]);
  const reached = list.filter((s) => s.reached).length;
  const children = useMemo(() => followUpTasksOf(tasks, task.id), [tasks, task.id]);
  const parent = task.parentTaskId ? tasks.find((x) => x.id === task.parentTaskId) ?? null : null;
  const late = isLate(task, today);
  const idBase = `td-${task.id}`;

  const fail = (err: unknown) => setError(errorText(t, err, {
    CONFLICT: t('This task already has a milestone with that name.'),
    FORBIDDEN: t('Only the person assigned, the person who made the task, the project lead or an admin can change its milestones.'),
    NOT_FOUND: t('This milestone or task no longer exists.'),
  }));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = name.trim();
    if (!text) return;
    setBusy('new');
    setError('');
    try {
      onStepChanged(await call<Step>('addStep', { projectId, taskId: task.id, name: text }));
      setName('');
      onResync();
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  };

  const edit = async (s: Step, change: { reached: boolean } | { deleted: true }) => {
    if ('deleted' in change && !window.confirm(t('Remove the milestone "{{name}}"?', { name: s.name }))) return;
    setBusy(s.id);
    setError('');
    try {
      onStepChanged(await call<Step>('editStep', { projectId, stepId: s.id, ...change }));
      onResync();
    } catch (err) {
      fail(err);
    } finally {
      setBusy('');
    }
  };

  const full = list.length >= MAX_STEPS;

  return (
    <div className="td" id={idBase}>
      {parent && (
        <button type="button" className="td-parent" onClick={() => onShowTask(parent.id)}>
          <CornerDownRight style={{ width: 14, height: 14 }} aria-hidden="true" />
          <span>{t('Follow-up of')}</span>
          <span className="ltr-data">{parent.serial}</span>
          <bdi>{parent.title}</bdi>
        </button>
      )}

      {task.details
        ? <p className="td-details" dir="auto">{task.details}</p>
        : <p className="td-details td-none">{t('No details written.')}</p>}

      <dl className="td-facts">
        <div><dt>{t('Assigned to')}</dt><dd><bdi>{task.assigneeEmail ? displayName(task.assigneeEmail, people) : t('Not assigned')}</bdi></dd></div>
        <div><dt>{t('Status')}</dt><dd><span className={`badge ${taskStatusClass(task.status)}`}>{taskStatusLabel(t, task.status)}</span></dd></div>
        <div><dt>{t('Due date')}</dt><dd className={late ? 'td-late' : undefined}>{task.dueDate ? shortDate(task.dueDate, lang) : t('No due date')}</dd></div>
        <div><dt>{t('Priority')}</dt><dd>{taskPriorityLabel(t, task.priority)}</dd></div>
        {category && <div><dt>{t('Category')}</dt><dd><bdi>{category.name}</bdi></dd></div>}
        <div><dt>{t('Made by')}</dt><dd>{t('{{name}}, {{when}}', { name: displayName(task.createdBy, people), when: timeAgo(task.createdAt, lang) })}</dd></div>
      </dl>

      <section className="td-sec" aria-labelledby={`${idBase}-ms`}>
        <div className="td-sec-head">
          <Flag style={{ width: 15, height: 15 }} aria-hidden="true" />
          <h3 id={`${idBase}-ms`}>{t('Milestones')}</h3>
          {list.length > 0 && (
            <span className="td-sec-count">{t('{{reached}} of {{total}} reached', { reached, total: list.length })}</span>
          )}
        </div>
        {list.length === 0 && (
          <p className="td-empty">{canEdit ? t('No milestones yet. Add the steps this task goes through; ticking them moves its progress.') : t('No milestones.')}</p>
        )}
        {list.length > 0 && (
          <ol className="td-steps">
            {list.map((s) => (
              <li key={s.id} className={`td-step${s.reached ? ' reached' : ''}`}>
                <label className="td-step-tick">
                  <input
                    type="checkbox" checked={s.reached} disabled={!canEdit || !!busy}
                    onChange={(e) => void edit(s, { reached: e.target.checked })}
                  />
                  <bdi className="td-step-name">{s.name}</bdi>
                </label>
                {s.reached && s.reachedAt && (
                  <span className="td-step-when">{t('{{name}}, {{when}}', { name: displayName(s.reachedBy, people), when: timeAgo(s.reachedAt, lang) })}</span>
                )}
                {canEdit && (
                  <button
                    type="button" className="btn btn-ghost btn-icon btn-sm td-step-del" onClick={() => void edit(s, { deleted: true })}
                    disabled={!!busy} aria-label={t('Remove the milestone "{{name}}"', { name: s.name })} title={t('Remove')}
                  >
                    <Trash2 style={{ width: 14, height: 14 }} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
        {canEdit && !full && (
          <form className="td-add" onSubmit={add}>
            <label className="sr-only" htmlFor={`${idBase}-new`}>{t('New milestone')}</label>
            <input
              id={`${idBase}-new`} className="input" dir="auto" value={name} maxLength={MAX_STEP_NAME} disabled={busy === 'new'}
              placeholder={t('New milestone, e.g. "Quote received"')} onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-ghost btn-sm" disabled={!!busy || !name.trim()}>
              <Plus style={{ width: 15, height: 15 }} />{busy === 'new' ? t('Saving…') : t('Add')}
            </button>
          </form>
        )}
        {canEdit && full && <p className="td-empty">{t('A task can have at most {{count}} milestones.', { count: MAX_STEPS })}</p>}
        {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 8 }}>{error}</p>}
      </section>

      <section className="td-sec" aria-labelledby={`${idBase}-fu`}>
        <div className="td-sec-head">
          <GitBranchPlus style={{ width: 15, height: 15 }} aria-hidden="true" />
          <h3 id={`${idBase}-fu`}>{t('Follow-up tasks')}</h3>
          {children.length > 0 && <span className="td-sec-count ltr-data">{children.length}</span>}
        </div>
        {children.length === 0
          ? <p className="td-empty">{t('No follow-up tasks yet.')}</p>
          : (
            <ul className="td-kids">
              {children.map((c) => (
                <li key={c.id}>
                  <button type="button" className={`td-kid${c.status === 'done' ? ' done' : ''}`} onClick={() => onShowTask(c.id)}>
                    <span className="task-serial ltr-data">{c.serial}</span>
                    <bdi className="td-kid-title">{c.title}</bdi>
                    <span className={`badge ${taskStatusClass(c.status)}`}>{taskStatusLabel(t, c.status)}</span>
                    {c.assigneeEmail && <bdi className="task-who">{displayName(c.assigneeEmail, people)}</bdi>}
                    <span className="ltr-data td-kid-pct">{c.percent}%</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>

      <div className="td-actions">
        {canAddFollowUp && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAddFollowUp}>
            <GitBranchPlus style={{ width: 15, height: 15 }} />{t('Add follow-up task')}
          </button>
        )}
        <button type="button" className="btn btn-primary btn-sm" onClick={onEdit}>
          <Pencil style={{ width: 14, height: 14 }} />{canEdit ? t('Edit task') : t('Open the task form')}
        </button>
      </div>
    </div>
  );
}
