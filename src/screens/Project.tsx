import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarCheck, CloudOff, ListChecks, MessageSquare, Users } from 'lucide-react';
import { useProjectSync } from '../hooks/useProjectSync';
import type { Session } from '../hooks/useSession';
import { useVisibleInterval } from '../hooks/useVisibleInterval';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { localDay } from '../lib/format';
import type { Member, Project as ProjectInfo, User } from '../types';
import { ProjectChat } from './ProjectChat';
import { ProjectTasks } from './ProjectTasks';
import { ProjectUpdates } from './ProjectUpdates';

const MEMBERS_EVERY_MS = 2 * 60 * 1000;

const TABS = ['chat', 'tasks', 'updates'] as const;
export type ProjectTab = (typeof TABS)[number];
export const isProjectTab = (x: string | undefined): x is ProjectTab => (TABS as readonly string[]).includes(x ?? '');

interface Props {
  projectId: string;
  tab: ProjectTab;
  onTab: (tab: ProjectTab) => void;
  me: User;
  call: Session['call'];
  onBack: () => void;
}

/**
 * One project: Chat, Tasks and daily Updates as tabs over one shared sync
 * (Files and People join in task 7b). Mount with `key={projectId}`.
 */
export function Project({ projectId, tab, onTab, me, call, onBack }: Props) {
  const { t } = useTranslation();
  const sync = useProjectSync(projectId, call);
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [infoError, setInfoError] = useState<unknown>(null);

  const loadInfo = useCallback(async () => {
    try {
      const list = await call<ProjectInfo[]>('listProjects');
      const p = list.find((x) => x.id === projectId);
      if (p) { setInfo(p); setInfoError(null); } else setInfoError(new ApiError('NOT_FOUND', 'Project not found.'));
    } catch (err) {
      setInfoError(err);
    }
  }, [call, projectId]);

  const loadMembers = useCallback(async () => {
    try { setMembers(await call<Member[]>('listMembers', { projectId })); } catch { /* names fall back to e-mails */ }
  }, [call, projectId]);

  useEffect(() => { void loadInfo(); void loadMembers(); }, [loadInfo, loadMembers]);
  useVisibleInterval(() => { void loadMembers(); }, MEMBERS_EVERY_MS);

  const myEmail = me.email.toLowerCase();
  const people = useMemo(() => {
    const map = new Map<string, { name: string; photoUrl: string }>();
    for (const m of members) map.set(m.email.toLowerCase(), { name: m.name, photoUrl: m.photoUrl });
    if (!map.has(myEmail)) map.set(myEmail, { name: me.name, photoUrl: me.photoUrl });
    return map;
  }, [members, me, myEmail]);
  const isLead = info?.myRole === 'lead' || members.some((m) => m.email.toLowerCase() === myEmail && m.role === 'lead');
  const archived = !!info?.archived;

  // Small signals on the tabs: my open tasks, and a dot while I have not posted today.
  const myOpenTasks = sync.tasks.filter((x) => x.status !== 'done' && x.assigneeEmail.toLowerCase() === myEmail).length;
  const isMember = info?.myRole != null || members.some((m) => m.email.toLowerCase() === myEmail);
  const today = localDay(Date.now());
  const owesUpdate = sync.loaded && !archived && isMember
    && !sync.updates.some((u) => u.date === today && u.authorEmail.toLowerCase() === myEmail);

  const gone = (infoError instanceof ApiError && infoError.code === 'NOT_FOUND')
    || (!sync.loaded && sync.error instanceof ApiError && sync.error.code === 'NOT_FOUND');

  if (gone) {
    return (
      <main className="main-content fade-in">
        <div className="empty-state" role="alert">
          <div className="empty-state-title">{t('This project is not available')}</div>
          <div className="empty-state-sub">{t('It may have been removed, or you are no longer a member.')}</div>
          <button type="button" className="btn btn-primary btn-sm" onClick={onBack}>{t('Back to projects')}</button>
        </div>
      </main>
    );
  }

  const firstLoadFailed = !sync.loaded && sync.error !== null;

  return (
    <main className="project-page">
      <div className="project-head">
        <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} title={t('Back to projects')} aria-label={t('Back to projects')}>
          <ArrowLeft className="dir-arrow" style={{ width: 18, height: 18 }} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="project-title text-truncate" dir="auto">{info?.name ?? (infoError ? '' : t('Loading…'))}</h1>
          <div className="project-sub">
            <Users style={{ width: 12, height: 12 }} />
            <span>{t('Members: {{count}}', { count: members.length || info?.memberCount || 0 })}</span>
            {info?.archived && <span className="tag">{t('Archived')}</span>}
          </div>
        </div>
        {sync.loaded && sync.error !== null && (
          <span className="project-offline" role="status" title={errorText(t, sync.error)}>
            <CloudOff style={{ width: 14, height: 14 }} />
            <span>{t('Offline, retrying…')}</span>
          </span>
        )}
      </div>

      <div className="project-tabs" role="tablist" aria-label={t('Project views')}>
        <TabButton id="chat" tab={tab} onTab={onTab} icon={<MessageSquare />} label={t('Chat')} />
        <TabButton id="tasks" tab={tab} onTab={onTab} icon={<ListChecks />} label={t('Tasks')}
          badge={myOpenTasks > 0 ? { text: String(myOpenTasks), title: t('Your open tasks: {{count}}', { count: myOpenTasks }) } : undefined} />
        <TabButton id="updates" tab={tab} onTab={onTab} icon={<CalendarCheck />} label={t('Updates')}
          dot={owesUpdate ? t('You have not posted your update today') : undefined} />
      </div>

      {firstLoadFailed ? (
        <div className="empty-state" role="alert" style={{ margin: 'auto 16px' }}>
          <div className="empty-state-title">{t('Could not load the project')}</div>
          <div className="empty-state-sub">{errorText(t, sync.error)}</div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void sync.sync()}>{t('Try again')}</button>
        </div>
      ) : tab === 'tasks' ? (
        <ProjectTasks projectId={projectId} me={me} call={call} sync={sync} members={members} people={people} isLead={isLead} archived={archived} />
      ) : tab === 'updates' ? (
        <ProjectUpdates projectId={projectId} me={me} call={call} sync={sync} members={members} people={people} archived={archived} />
      ) : (
        <ProjectChat projectId={projectId} me={me} call={call} sync={sync} members={members} archived={archived} />
      )}
    </main>
  );
}

interface TabProps {
  id: ProjectTab;
  tab: ProjectTab;
  onTab: (tab: ProjectTab) => void;
  icon: ReactNode;
  label: string;
  badge?: { text: string; title: string };
  /** A small dot with this meaning (read by screen readers). */
  dot?: string;
}

function TabButton({ id, tab, onTab, icon, label, badge, dot }: TabProps) {
  const active = id === tab;
  return (
    <button type="button" role="tab" aria-selected={active} className={`project-tab${active ? ' active' : ''}`} onClick={() => onTab(id)}>
      {icon}
      <span>{label}</span>
      {badge && <span className="project-tab-badge" title={badge.title}><span aria-hidden="true">{badge.text}</span><span className="sr-only">{badge.title}</span></span>}
      {dot && <span className="project-tab-dot" title={dot}><span className="sr-only">{dot}</span></span>}
    </button>
  );
}
