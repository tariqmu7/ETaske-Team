import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, CalendarClock, ChevronDown, ClipboardList, CornerDownRight, Flag, Plus, Rows3, Tags } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { CategoriesModal } from '../components/CategoriesModal';
import { MilestoneMeter, MilestonesModal } from '../components/MilestonesModal';
import { TaskDetail } from '../components/TaskDetail';
import { TaskModal, type TaskSeed } from '../components/TaskModal';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { categoryHue, categoryOf, liveCategories } from '../lib/categories';
import { followUpState, nextFollowUps } from '../lib/followups';
import { liveMilestones, milestoneOf, milestoneProgress } from '../lib/milestones';
import { displayName, localDay, shortDate } from '../lib/format';
import { stepCounts } from '../lib/steps';
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
  /** Person: their e-mail ('' = nobody). Category / milestone: its id ('' = none). */
  key: string;
  tasks: Task[];
  open: number;
  late: number;
}

/** Filter value: all ('' = tasks with none; anything else = one category / milestone id). */
const ALL = '*';

type GroupBy = 'person' | 'category' | 'milestone';

/**
 * The project's tasks grouped by person, category or milestone: late first, then blocked,
 * in progress, to do. Done ones fold away. Category and milestone filters narrow the list.
 */
export function ProjectTasks({ projectId, me, call, sync, members, people, isLead, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const myEmail = me.email.toLowerCase();
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyChase, setOnlyChase] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);   // '' = new task
  /** The task opened in place under its row (one at a time). */
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Set while the new-task form makes a follow-up task of this task. */
  const [followOf, setFollowOf] = useState<Task | null>(null);
  /** Scroll this task's row into view once it is on screen. */
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState(ALL);
  const [msFilter, setMsFilter] = useState(ALL);
  const [groupBy, setGroupBy] = useState<GroupBy>('person');
  const [managing, setManaging] = useState(false);
  const [managingMs, setManagingMs] = useState(false);
  const today = localDay(Date.now());
  const canManage = isLead || me.role === 'admin';
  const cats = sync.categories;
  const live = useMemo(() => liveCategories(cats), [cats]);
  /** A task's category id, or '' when it has none (or names a removed one). */
  const catOf = (task: Task) => categoryOf(cats, task.categoryId)?.id ?? '';
  const stones = sync.milestones;
  const liveStones = useMemo(() => liveMilestones(stones), [stones]);
  const msOf = (task: Task) => milestoneOf(stones, task.milestoneId)?.id ?? '';

  const assignable = useMemo(() => members.filter((m) => m.status !== 'blocked'), [members]);

  const all = sync.tasks;
  const counts = useMemo(() => stepCounts(sync.steps), [sync.steps]);
  const serialOf = useMemo(() => new Map(all.map((x) => [x.id, x.serial])), [all]);
  /** Task id → its pending follow-up day (open tasks only). */
  const chase = useMemo(() => nextFollowUps(sync.followUps, all), [sync.followUps, all]);
  const isDue = (task: Task) => { const d = chase.get(task.id); return !!d && d <= today; };
  const byMe = onlyMine ? all.filter((x) => x.assigneeEmail.toLowerCase() === myEmail) : all;
  const dueCount = byMe.filter(isDue).length;
  // The switch turns itself off once nothing is left to chase, so the list never looks empty for no reason.
  const chaseOn = onlyChase && dueCount > 0;
  const mine = chaseOn ? byMe.filter(isDue) : byMe;
  // A category removed meanwhile (by someone else) falls back to "all".
  const filter = catFilter === ALL || catFilter === '' || live.some((c) => c.id === catFilter) ? catFilter : ALL;
  const msFilt = msFilter === ALL || msFilter === '' || liveStones.some((m) => m.id === msFilter) ? msFilter : ALL;
  const shown = mine.filter((x) => (filter === ALL || catOf(x) === filter) && (msFilt === ALL || msOf(x) === msFilt));
  const countIn = (id: string) => mine.filter((x) => x.status !== 'done' && catOf(x) === id).length;
  const countInMs = (id: string) => mine.filter((x) => x.status !== 'done' && msOf(x) === id).length;
  const byCategory = groupBy === 'category';
  const byMilestone = groupBy === 'milestone';
  const doneCount = shown.filter((x) => x.status === 'done').length;
  const openCount = shown.length - doneCount;
  const lateCount = shown.filter((x) => isLate(x, today)).length;

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    for (const task of shown) {
      if (task.status === 'done' && !showDone) continue;
      const key = byCategory ? (categoryOf(cats, task.categoryId)?.id ?? '')
        : byMilestone ? (milestoneOf(stones, task.milestoneId)?.id ?? '')
        : task.assigneeEmail.toLowerCase();
      const g = map.get(key) ?? { key, tasks: [], open: 0, late: 0 };
      g.tasks.push(task);
      if (task.status !== 'done') g.open++;
      if (isLate(task, today)) g.late++;
      map.set(key, g);
    }
    for (const g of map.values()) g.tasks.sort((a, b) => compareTasks(a, b, today));
    if (byMilestone) {
      // Same order as the list: soonest due first; tasks with no milestone last.
      const order = new Map(liveStones.map((m, i) => [m.id, i]));
      const rank = (g: Group) => (g.key ? order.get(g.key) ?? 0 : liveStones.length);
      return [...map.values()].sort((a, b) => rank(a) - rank(b));
    }
    if (byCategory) {
      // A to Z by category name; tasks with no category last.
      const name = (g: Group) => categoryOf(cats, g.key)?.name ?? '';
      return [...map.values()].sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || name(a).localeCompare(name(b)));
    }
    // Me first, then by name; tasks nobody holds yet last.
    const rank = (g: Group) => (g.key === myEmail ? 0 : g.key ? 1 : 2);
    return [...map.values()].sort((a, b) => rank(a) - rank(b) || displayName(a.key, people).localeCompare(displayName(b.key, people)));
  }, [shown, showDone, today, myEmail, people, byCategory, byMilestone, cats, stones, liveStones]);

  const opened = openId ? all.find((x) => x.id === openId) ?? null : null;

  const onSaved = (task: Task) => {
    sync.putTask(task);
    setOpenId(null);
    setFollowOf(null);
    void sync.sync();   // brings the task line the server posted in the chat
  };

  /** Opens a task in place, clearing whatever filter would hide it (e.g. jumping to a parent task). */
  const showTask = (id: string) => {
    const task = all.find((x) => x.id === id);
    if (!task) return;
    if (!shown.some((x) => x.id === id)) {
      setOnlyMine(false); setOnlyChase(false); setCatFilter(ALL); setMsFilter(ALL);
    }
    if (task.status === 'done') setShowDone(true);
    setExpanded(id);
    setScrollTo(id);
  };

  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(`tk-${scrollTo}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setScrollTo(null);
  }, [scrollTo]);

  const newSeed: TaskSeed | undefined = opened ? undefined : followOf ? {
    assigneeEmail: followOf.assigneeEmail, categoryId: followOf.categoryId, parentTaskId: followOf.id, parentSerial: followOf.serial,
  } : {
    categoryId: filter !== ALL ? filter : undefined,
    milestoneId: msFilt !== ALL ? msFilt : undefined,
  };

  return (
    <div className="project-pane">
      <div className="pane-toolbar">
        <div className="pane-stats" aria-label={t('Task summary')}>
          <span><strong>{openCount}</strong> {t('open')}</span>
          {lateCount > 0 && <span className="pane-stat-late"><strong>{lateCount}</strong> {t('late')}</span>}
          <span><strong>{doneCount}</strong> {t('done')}</span>
        </div>
        {(dueCount > 0 || chaseOn) && (
          <button
            type="button" className={`fu-filter${chaseOn ? ' active' : ''}`} aria-pressed={chaseOn} onClick={() => setOnlyChase((v) => !v)}
            title={t('Tasks whose follow-up day is today or has passed')}
          >
            <BellRing style={{ width: 14, height: 14 }} aria-hidden="true" />
            {t('Follow-ups due ({{count}})', { count: dueCount })}
          </button>
        )}
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
        {(liveStones.length > 0 || msFilt !== ALL) && (
          <label className="cat-filter">
            <Flag style={{ width: 15, height: 15 }} aria-hidden="true" />
            <select className="input" value={msFilt} onChange={(e) => setMsFilter(e.target.value)} aria-label={t('Milestone')}>
              <option value={ALL}>{t('All milestones')}</option>
              {liveStones.map((m) => <option key={m.id} value={m.id}>{m.name} ({countInMs(m.id)})</option>)}
              <option value="">{t('No milestone')} ({countInMs('')})</option>
            </select>
          </label>
        )}
        <label className="cat-filter group-filter">
          <Rows3 style={{ width: 15, height: 15 }} aria-hidden="true" />
          <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label={t('Group by')}>
            {(['person', 'category', 'milestone'] as const).map((g) => (
              <option key={g} value={g}>{g === 'person' ? t('By person') : g === 'category' ? t('By category') : t('By milestone')}</option>
            ))}
          </select>
        </label>
        <div className="pane-manage">
          {!archived && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManaging(true)}>
              <Tags style={{ width: 15, height: 15 }} />{t('Categories')}
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setManagingMs(true)}>
            <Flag style={{ width: 15, height: 15 }} />{t('Milestones')}
          </button>
        </div>
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
            {openCount === 0 && doneCount > 0 ? t('All tasks are done') : msFilt !== ALL ? t('No tasks in this milestone') : filter !== ALL ? t('No tasks in this category') : onlyMine ? t('No tasks for you yet') : t('No tasks yet')}
          </div>
          <div className="empty-state-sub">
            {archived ? t('This project is archived.') : t('Press New task, or open a chat message and choose Make it a task.')}
          </div>
        </div>
      )}

      {groups.map((g) => {
        const cat = byCategory ? categoryOf(cats, g.key) : null;
        const stone = byMilestone ? milestoneOf(stones, g.key) : null;
        const person = groupBy === 'person' ? people.get(g.key) : undefined;
        const label = byCategory ? (cat?.name ?? t('No category'))
          : byMilestone ? (stone?.name ?? t('No milestone'))
          : g.key ? displayName(g.key, people) : t('Not assigned');
        return (
          <section key={g.key || 'none'} className="task-group" aria-label={label}>
            <header className="task-group-head">
              {byCategory
                ? <span className="task-group-cat" style={cat ? { background: `hsl(${categoryHue(cat.id)} 60% 45%)` } : undefined} aria-hidden="true"><Tags style={{ width: 15, height: 15 }} /></span>
                : byMilestone
                ? <span className={`task-group-cat task-group-ms${stone ? '' : ' none'}`} aria-hidden="true"><Flag style={{ width: 15, height: 15 }} /></span>
                : g.key
                  ? <Avatar name={person?.name ?? ''} email={g.key} photoUrl={person?.photoUrl} size={28} />
                  : <span className="task-group-nobody" aria-hidden="true">?</span>}
              <bdi className="task-group-name">{label}</bdi>
              {groupBy === 'person' && g.key === myEmail && <span className="tag">{t('You')}</span>}
              <span className="task-group-count">
                {t('{{count}} open', { count: g.open })}
                {g.late > 0 && <span className="pane-stat-late"> · {t('{{count}} late', { count: g.late })}</span>}
              </span>
            </header>
            {stone && <div className="task-group-meter"><MilestoneMeter m={stone} p={milestoneProgress(stone, all, today)} /></div>}
            <ul className="task-list">
              {g.tasks.map((task) => {
                const late = isLate(task, today);
                const cat = byCategory ? null : categoryOf(cats, task.categoryId);
                const fuDay = chase.get(task.id);
                const fu = fuDay ? followUpState(fuDay, today) : null;
                const isOpen = expanded === task.id;
                const sc = counts.get(task.id);
                const parentSerial = task.parentTaskId ? serialOf.get(task.parentTaskId) : undefined;
                return (
                  <li key={task.id} id={`tk-${task.id}`} className={isOpen ? 'tk-open' : undefined}>
                    <button
                      type="button" className={`tk-row${late ? ' late' : ''}${fu === 'overdue' ? ' fu-overdue' : ''}${task.status === 'done' ? ' done' : ''}`}
                      onClick={() => setExpanded(isOpen ? null : task.id)} aria-expanded={isOpen} aria-controls={isOpen ? `td-${task.id}` : undefined}
                    >
                      <span className="tk-row-top">
                        <span className="task-serial ltr-data">{task.serial}</span>
                        <bdi className="task-title">{task.title}</bdi>
                        <ChevronDown className="tk-chev" style={{ width: 16, height: 16 }} aria-hidden="true" />
                      </span>
                      <span className="tk-row-meta">
                        <span className={`badge ${taskStatusClass(task.status)}`}>{taskStatusLabel(t, task.status)}</span>
                        {task.priority === 'high' && <span className="badge badge-high">{taskPriorityLabel(t, 'high')}</span>}
                        {parentSerial && (
                          <span className="tk-parent" title={t('Follow-up of')}>
                            <CornerDownRight style={{ width: 12, height: 12 }} aria-hidden="true" /><span className="ltr-data">{parentSerial}</span>
                          </span>
                        )}
                        {sc && (
                          <span className={`tk-steps${sc.reached === sc.total ? ' all' : ''}`} title={t('{{reached}} of {{total}} reached', { reached: sc.reached, total: sc.total })}>
                            <Flag style={{ width: 12, height: 12 }} aria-hidden="true" /><span className="ltr-data">{sc.reached}/{sc.total}</span>
                          </span>
                        )}
                        {cat && <bdi className="cat-chip" style={{ '--cat-h': categoryHue(cat.id) } as CSSProperties}>{cat.name}</bdi>}
                        {groupBy !== 'person' && task.assigneeEmail && <bdi className="task-who">{displayName(task.assigneeEmail, people)}</bdi>}
                        {task.dueDate && (
                          <span className={`task-due${late ? ' late' : ''}`}>
                            <CalendarClock style={{ width: 13, height: 13 }} />
                            {late ? t('Late, was due {{date}}', { date: shortDate(task.dueDate, lang) }) : t('Due {{date}}', { date: shortDate(task.dueDate, lang) })}
                          </span>
                        )}
                        {fuDay && fu && (
                          <span className={`fu-chip ${fu}`}>
                            <BellRing style={{ width: 12, height: 12 }} aria-hidden="true" />
                            {fu === 'overdue' ? t('Follow-up overdue since {{date}}', { date: shortDate(fuDay, lang) })
                              : fu === 'today' ? t('Follow up today')
                              : t('Follow up {{date}}', { date: shortDate(fuDay, lang) })}
                          </span>
                        )}
                        <span className="task-percent">
                          <span className="progress-bar" aria-hidden="true"><span className="progress-fill" style={{ display: 'block', width: `${task.percent}%` }} /></span>
                          <span className="ltr-data">{task.percent}%</span>
                        </span>
                      </span>
                    </button>
                    {isOpen && (
                      <TaskDetail
                        projectId={projectId} call={call} task={task} tasks={all} steps={sync.steps}
                        category={categoryOf(cats, task.categoryId)} people={people} today={today}
                        canEdit={!archived && canEditTask(task, me, isLead)} canAddFollowUp={!archived}
                        onStepChanged={sync.putStep} onResync={() => void sync.sync()} onShowTask={showTask}
                        onEdit={() => setOpenId(task.id)} onAddFollowUp={() => { setFollowOf(task); setOpenId(''); }}
                      />
                    )}
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
          seed={newSeed}
          categories={cats}
          onCategoryAdded={sync.putCategory}
          milestones={stones}
          canEdit={!archived && (!opened || canEditTask(opened, me, isLead))}
          stepsLocked={!!opened && counts.has(opened.id)}
          followUp={{ followUps: sync.followUps, myEmail, canAdd: !archived, canManage, onChanged: sync.putFollowUp }}
          onSaved={onSaved}
          onClose={() => { setOpenId(null); setFollowOf(null); }}
        />
      )}

      {managingMs && (
        <MilestonesModal
          projectId={projectId} call={call} milestones={stones} tasks={all} canManage={canManage && !archived}
          onChanged={sync.putMilestone} onClose={() => setManagingMs(false)}
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
