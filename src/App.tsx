import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav, type Route } from './components/TopNav';
import { useSession } from './hooks/useSession';
import { useVisibleInterval } from './hooks/useVisibleInterval';
import { errorText } from './lib/errors';
import { Project, isProjectTab, type ProjectTab } from './screens/Project';
import { Projects } from './screens/Projects';
import { SignIn } from './screens/SignIn';
import { UsersAdmin } from './screens/UsersAdmin';
import { Waiting } from './screens/Waiting';
import type { User } from './types';

const PENDING_CHECK_MS = 60 * 1000;

interface Place { route: Route; projectId: string; tab: ProjectTab }

/** `#/users`, `#/p/<project id>[/tasks|/updates|/files|/people]`, anything else = the projects list. */
function placeFromHash(): Place {
  const hash = window.location.hash;
  if (hash === '#/users') return { route: 'users', projectId: '', tab: 'chat' };
  const m = hash.match(/^#\/p\/([\w-]+)(?:\/(\w+))?$/);
  return { route: 'projects', projectId: m ? m[1] : '', tab: m && isProjectTab(m[2]) ? m[2] : 'chat' };
}

/**
 * Sign in → (pending / blocked: Waiting) → Projects → one project, plus Users for admins.
 * The route lives in the URL hash, which works on GitHub Pages without server rewrites.
 */
export default function App() {
  const { t } = useTranslation();
  const session = useSession();
  const { phase, user, call, signOut } = session;
  const [place, setPlace] = useState<Place>(placeFromHash);
  const { route, projectId, tab } = place;
  const [pendingCount, setPendingCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const onHash = () => setPlace(placeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = (r: Route) => { window.location.hash = r === 'users' ? '#/users' : '#/'; };

  const approved = phase === 'ready' && user?.status === 'approved';
  const isAdmin = approved && user?.role === 'admin';
  const screen: Route = route === 'users' && isAdmin ? 'users' : 'projects';
  const inProject = approved && screen === 'projects' && !!projectId;

  // The badge on the Users tab. The Users screen keeps it current while it is open.
  const onUsers = useCallback((users: User[]) => setPendingCount(users.filter((u) => u.status === 'pending').length), []);
  const checkPending = useCallback(() => {
    call<User[]>('listUsers').then(onUsers).catch(() => { /* the badge just stays as it was */ });
  }, [call, onUsers]);
  useEffect(() => { if (isAdmin && screen !== 'users') checkPending(); }, [isAdmin, screen, checkPending]);
  useVisibleInterval(checkPending, PENDING_CHECK_MS, isAdmin && screen !== 'users');

  const retry = async () => {
    setRetrying(true);
    try { await session.refreshMe(); } finally { setRetrying(false); }
  };

  let body;
  if (phase === 'signedOut') {
    body = <SignIn expired={session.expired} googleFailed={session.googleFailed} onRetryGoogle={session.retryGoogle} />;
  } else if (phase === 'checking' || (!user && phase === 'ready')) {
    body = (
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }} aria-busy="true">
        <div className="spinner" />
        <span className="text-muted">{t('Checking your account…')}</span>
      </main>
    );
  } else if (phase === 'failed' || !user) {
    body = (
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
        <div className="card" role="alert" style={{ width: '100%', maxWidth: 440, padding: 24 }}>
          <h1 className="page-title" style={{ marginBottom: 8 }}>{t('Could not open your account')}</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>{errorText(t, session.failure)}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>{t('Try again')}</button>
            <button className="btn btn-ghost" onClick={signOut}>{t('Sign out')}</button>
          </div>
        </div>
      </main>
    );
  } else if (user.status !== 'approved') {
    body = <Waiting user={user} onCheck={session.refreshMe} onSignOut={signOut} />;
  } else if (screen === 'users') {
    body = <UsersAdmin me={user} call={call} onUsers={onUsers} />;
  } else if (projectId) {
    body = (
      <Project
        key={projectId}
        projectId={projectId}
        tab={tab}
        onTab={(next) => { window.location.hash = next === 'chat' ? `#/p/${projectId}` : `#/p/${projectId}/${next}`; }}
        me={user}
        call={call}
        onBack={() => navigate('projects')}
      />
    );
  } else {
    body = <Projects user={user} call={call} />;
  }

  return (
    // In a project the page is exactly one screen tall: the chat scrolls, its message box stays put.
    <div style={inProject ? { height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } : { minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopNav
        user={phase === 'ready' ? user : null}
        route={screen}
        onNavigate={approved ? navigate : undefined}
        pendingCount={pendingCount}
        hideBottomNav={inProject}
        onSignOut={phase === 'signedOut' ? undefined : signOut}
      />
      {body}
    </div>
  );
}
