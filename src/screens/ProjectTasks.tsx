import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronDown, ClipboardList, Plus } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { TaskModal } from '../components/TaskModal';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { displayName, localDay, shortDate } from '../lib/format';
import { canEditTask, compareTasks, isLate, taskPriorityLabel, taskStatusClass, taskStatusLabel } from '../lib/tasks';
import type { Member, Task, User } from '../types';

type Sync = ReturnType<typeof useProjectSync>;

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

interface Group {
  email: string;
  tasks: Task[];
  open: number;
  late: number;
}

/** The project's tasks grouped by person: late first, then blocked, in progress, to do. Done ones fold away. */
export function ProjectTasks({ projectId, me, call, sync, members, people, isLead, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const myEmail = me.email.toLowerCase();
  const [onlyMine, setOnlyMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);   // '' = new task
  const today = localDay(Date.now());

  const assignable = useMemo(() => members.filter((m) => m.status !== 'blocked'), [members]);

  const all = sync.tasks;
  const shown = onlyMine ? all.filter((x) => x.assigneeEmail.toLowerCase() === myEmail) : all;
  const doneCount = shown.filter((x) => x.status === 'done').length;
  const openCount = shown.length - doneCount;
  const lateCount = shown.filter((x) => isLate(x, today)).length;

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const task of shown) {
      if (task.status === 'done' && !showDone) continue;
      const email = task.assigneeEmail.toLowerCase();
      const g = map.get(email) ?? { email, tasks: [], open: 0, late: 0 };
      g.tasks.push(task);
      if (task.status !== 'done') g.open++;
      if (isLate(task, today)) g.late++;
      map.set(email, g);
    }
    for (const g of map.values()) g.tasks.sort((a, b) => compareTasks(a, b, today));
    // Me first, then by name; tasks nobody holds yet last.
    const rank = (g: Group) => (g.email === myEmail ? 0 : g.email ? 1 : 2);
    return [...map.values()].sort((a, b) => rank(a) - rank(b) || displayName(a.email, people).localeCompare(displayName(b.email, people)));
  }, [shown, showDone, today, myEmail, people]);

  const opened = openId ? all.find((x) => x.id === openId) ?? null : null;

  const onSaved = (task: Task) => {
    sync.putTask(task);
    setOpenId(null);
    void sync.sync();   // brings the task line the server posted in the chat
  };

  return (
    <div className="project-pane">
      <div className="pane-toolbar">
        <div className="pane-stats" aria-label={t('Task summary')}>
          <span><strong>{openCount}</strong> {t('open')}</span>
          {lateCount > 0 && <span className="pane-stat-late"><strong>{lateCount}</strong> {t('late')}</span>}
          <span><strong>{doneCount}</strong> {t('done')}</span>
        </div>
        <div className="seg" role="group" aria-label={t('Show')}>
          <button type="button" className={!onlyMine ? 'active' : ''} aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>{t('Everyone')}</button>
          <button type="button" className={onlyMine ? 'active' : ''} aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>{t('Mine')}</button>
        </div>
        {!archived && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenId('')}>
            <Plus style={{ width: 15, height: 15 }} />{t('New task')}
          </button>
        )}
      </div>

      {!sync.loaded && (
        <div className="chat-loading" aria-busy="true" style={{ padding: 40 }}>
          <div className="spinner" /><span className="text-muted">{t('Loading…')}</span>
        </div>
      )}

      {sync.loaded && groups.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><ClipboardList style={{ width: 28, height: 28 }} /></div>
          <div className="empty-state-title">{openCount === 0 && doneCount > 0 ? t('All tasks are done') : onlyMine ? t('No tasks for you yet') : t('No tasks yet')}</div>
          <div className="empty-state-sub">
            {archived ? t('This project is archived.') : t('Press New task, or open a chat message and choose Make it a task.')}
          </div>
        </div>
      )}

      {groups.map((g) => {
        const person = people.get(g.email);
        return (
          <section key={g.email || 'nobody'} className="task-group" aria-label={g.email ? displayName(g.email, people) : t('Not assigned')}>
            <header className="task-group-head">
              {g.email
                ? <Avatar name={person?.name ?? ''} email={g.email} photoUrl={person?.photoUrl} size={28} />
                : <span className="task-group-nobody" aria-hidden="true">?</span>}
              <bdi className="task-group-name">{g.email ? displayName(g.email, people) : t('Not assigned')}</bdi>
              {g.email === myEmail && <span className="tag">{t('You')}</span>}
              <span className="task-group-count">
                {t('{{count}} open', { count: g.open })}
                {g.late > 0 && <span className="pane-stat-late"> · {t('{{count}} late', { count: g.late })}</span>}
              </span>
            </header>
            <ul className="task-list">
              {g.tasks.map((task) => {
                const late = isLate(task, today);
                return (
                  <li key={task.id}>
                    <button type="button" className={`tk-row${late ? ' late' : ''}${task.status === 'done' ? ' done' : ''}`} onClick={() => setOpenId(task.id)}>
                      <span className="tk-row-top">
                        <span className="task-serial ltr-data">{task.serial}</span>
                        <bdi className="task-title">{task.title}</bdi>
                      </span>
                      <span className="tk-row-meta">
                        <span className={`badge ${taskStatusClass(task.status)}`}>{taskStatusLabel(t, task.status)}</span>
                        {task.priority === 'high' && <span className="badge badge-high">{taskPriorityLabel(t, 'high')}</span>}
                        {task.dueDate && (
                          <span className={`task-due${late ? ' late' : ''}`}>
                            <CalendarClock style={{ width: 13, height: 13 }} />
                            {late ? t('Late, was due {{date}}', { date: shortDate(task.dueDate, lang) }) : t('Due {{date}}', { date: shortDate(task.dueDate, lang) })}
                          </span>
                        )}
                        <span className="task-percent">
                          <span className="progress-bar" aria-hidden="true"><span className="progress-fill" style={{ display: 'block', width: `${task.percent}%` }} /></span>
                          <span className="ltr-data">{task.percent}%</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {sync.loaded && doneCount > 0 && (
        <button type="button" className="btn btn-ghost btn-sm pane-more" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
          <ChevronDown style={{ width: 15, height: 15, transform: showDone ? 'rotate(180deg)' : undefined }} />
          {showDone ? t('Hide done tasks') : t('Show done tasks ({{count}})', { count: doneCount })}
        </button>
      )}

      {openId !== null && (openId === '' || opened) && (
        <TaskModal
          projectId={projectId}
          call={call}
          members={assignable}
          people={people}
          task={opened}
          canEdit={!archived && (!opened || canEditTask(opened, me, isLead))}
          onSaved={onSaved}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
