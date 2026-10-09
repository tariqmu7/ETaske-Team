import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronDown, ClipboardList, Plus, Tags } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { CategoriesModal } from '../components/CategoriesModal';
import { TaskModal } from '../components/TaskModal';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { categoryHue, categoryOf, liveCategories } from '../lib/categories';
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
  /** Person: their e-mail ('' = nobody). Category: its id ('' = none). */
  key: string;
  tasks: Task[];
  open: number;
  late: number;
}

/** Filter value: all categories ('' = tasks with none; anything else = one category id). */
const ALL = '*';

/**
 * The project's tasks grouped by person (or by category): late first, then blocked,
 * in progress, to do. Done ones fold away. A category filter narrows the list.
 */
export function ProjectTasks({ projectId, me, call, sync, members, people, isLead, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const myEmail = me.email.toLowerCase();
  const [onlyMine, setOnlyMine] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);   // '' = new task
  const [catFilter, setCatFilter] = useState(ALL);
  const [byCategory, setByCategory] = useState(false);
  const [managing, setManaging] = useState(false);
  const today = localDay(Date.now());
  const canManage = isLead || me.role === 'admin';
  const cats = sync.categories;
  const live = useMemo(() => liveCategories(cats), [cats]);
  /** A task's category id, or '' when it has none (or names a removed one). */
  const catOf = (task: Task) => categoryOf(cats, task.categoryId)?.id ?? '';

  const assignable = useMemo(() => members.filter((m) => m.status !== 'blocked'), [members]);

  const all = sync.tasks;
  const mine = onlyMine ? all.filter((x) => x.assigneeEmail.toLowerCase() === myEmail) : all;
  // A category removed meanwhile (by someone else) falls back to "all".
  const filter = catFilter === ALL || catFilter === '' || live.some((c) => c.id === catFilter) ? catFilter : ALL;
  const shown = filter === ALL ? mine : mine.filter((x) => catOf(x) === filter);
  const countIn = (id: string) => mine.filter((x) => x.status !== 'done' && catOf(x) === id).length;
  const doneCount = shown.filter((x) => x.status === 'done').length;
  const openCount = shown.length - doneCount;
  const lateCount = shown.filter((x) => isLate(x, today)).length;

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const task of shown) {
      if (task.status === 'done' && !showDone) continue;
      const key = byCategory ? (categoryOf(cats, task.categoryId)?.id ?? '') : task.assigneeEmail.toLowerCase();
      const g = map.get(key) ?? { key, tasks: [], open: 0, late: 0 };
      g.tasks.push(task);
      if (task.status !== 'done') g.open++;
      if (isLate(task, today)) g.late++;
      map.set(key, g);
    }
    for (const g of map.values()) g.tasks.sort((a, b) => compareTasks(a, b, today));
    if (byCategory) {
      // A to Z by category name; tasks with no category last.
      const name = (g: Group) => categoryOf(cats, g.key)?.name ?? '';
      return [...map.values()].sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || name(a).localeCompare(name(b)));
    }
    // Me first, then by name; tasks nobody holds yet last.
    const rank = (g: Group) => (g.key === myEmail ? 0 : g.key ? 1 : 2);
    return [...map.values()].sort((a, b) => rank(a) - rank(b) || displayName(a.key, people).localeCompare(displayName(b.key, people)));
  }, [shown, showDone, today, myEmail, people, byCategory, cats]);

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

      <div className="pane-toolbar pane-toolbar-sub">
        <label className="cat-filter">
          <Tags style={{ width: 15, height: 15 }} aria-hidden="true" />
          <select className="input" value={filter} onChange={(e) => setCatFilter(e.target.value)} aria-label={t('Category')}>
            <option value={ALL}>{t('All categories')}</option>
            {live.map((c) => <option key={c.id} value={c.id}>{c.name} ({countIn(c.id)})</option>)}
            <option value="">{t('No category')} ({countIn('')})</option>
          </select>
        </label>
        <div className="seg" role="group" aria-label={t('Group by')}>
          <button type="button" className={!byCategory ? 'active' : ''} aria-pressed={!byCategory} onClick={() => setByCategory(false)}>{t('By person')}</button>
          <button type="button" className={byCategory ? 'active' : ''} aria-pressed={byCategory} onClick={() => setByCategory(true)}>{t('By category')}</button>
        </div>
        {!archived && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManaging(true)}>
            <Tags style={{ width: 15, height: 15 }} />{t('Categories')}
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
          <div className="empty-state-title">
            {openCount === 0 && doneCount > 0 ? t('All tasks are done') : filter !== ALL ? t('No tasks in this category') : onlyMine ? t('No tasks for you yet') : t('No tasks yet')}
          </div>
          <div className="empty-state-sub">
            {archived ? t('This project is archived.') : t('Press New task, or open a chat message and choose Make it a task.')}
          </div>
        </div>
      )}

      {groups.map((g) => {
        const cat = byCategory ? categoryOf(cats, g.key) : null;
        const person = byCategory ? undefined : people.get(g.key);
        const label = byCategory ? (cat?.name ?? t('No category')) : g.key ? displayName(g.key, people) : t('Not assigned');
        return (
          <section key={g.key || 'none'} className="task-group" aria-label={label}>
            <header className="task-group-head">
              {byCategory
                ? <span className="task-group-cat" style={cat ? { background: `hsl(${categoryHue(cat.id)} 60% 45%)` } : undefined} aria-hidden="true"><Tags style={{ width: 15, height: 15 }} /></span>
                : g.key
                  ? <Avatar name={person?.name ?? ''} email={g.key} photoUrl={person?.photoUrl} size={28} />
                  : <span className="task-group-nobody" aria-hidden="true">?</span>}
              <bdi className="task-group-name">{label}</bdi>
              {!byCategory && g.key === myEmail && <span className="tag">{t('You')}</span>}
              <span className="task-group-count">
                {t('{{count}} open', { count: g.open })}
                {g.late > 0 && <span className="pane-stat-late"> · {t('{{count}} late', { count: g.late })}</span>}
              </span>
            </header>
            <ul className="task-list">
              {g.tasks.map((task) => {
                const late = isLate(task, today);
                const cat = byCategory ? null : categoryOf(cats, task.categoryId);
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
                        {cat && <bdi className="cat-chip" style={{ '--cat-h': categoryHue(cat.id) } as CSSProperties}>{cat.name}</bdi>}
                        {byCategory && task.assigneeEmail && <bdi className="task-who">{displayName(task.assigneeEmail, people)}</bdi>}
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
          seed={!opened && filter !== ALL && filter ? { categoryId: filter } : undefined}
          categories={cats}
          onCategoryAdded={sync.putCategory}
          canEdit={!archived && (!opened || canEditTask(opened, me, isLead))}
          onSaved={onSaved}
          onClose={() => setOpenId(null)}
        />
      )}

      {managing && (
        <CategoriesModal
          projectId={projectId} call={call} categories={cats} tasks={all} canManage={canManage}
          onChanged={sync.putCategory} onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}
