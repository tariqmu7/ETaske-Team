import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CloudOff, Users } from 'lucide-react';
import { useProjectSync } from '../hooks/useProjectSync';
import type { Session } from '../hooks/useSession';
import { useVisibleInterval } from '../hooks/useVisibleInterval';
import { ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import type { Member, Project as ProjectInfo, User } from '../types';
import { ProjectChat } from './ProjectChat';

const MEMBERS_EVERY_MS = 2 * 60 * 1000;

interface Props {
  projectId: string;
  me: User;
  call: Session['call'];
  onBack: () => void;
}

/**
 * One project. For now its only view is the chat; Tasks, Updates, Files and
 * People join it as tabs in task 7. Mount with `key={projectId}`.
 */
export function Project({ projectId, me, call, onBack }: Props) {
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

      {firstLoadFailed ? (
        <div className="empty-state" role="alert" style={{ margin: 'auto 16px' }}>
          <div className="empty-state-title">{t('Could not load the chat')}</div>
          <div className="empty-state-sub">{errorText(t, sync.error)}</div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void sync.sync()}>{t('Try again')}</button>
        </div>
      ) : (
        <ProjectChat projectId={projectId} me={me} call={call} sync={sync} members={members} archived={!!info?.archived} />
      )}
    </main>
  );
}
