import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FolderKanban, MessageSquare, Plus, RefreshCw, Users, X } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { useVisibleInterval } from '../hooks/useVisibleInterval';
import type { Session } from '../hooks/useSession';
import { errorText } from '../lib/errors';
import { timeAgo } from '../lib/format';
import type { Project, User } from '../types';

const REFRESH_EVERY_MS = 60 * 1000;
const MAX_NAME = 100;          // same limits as apps-script/Code.gs
const MAX_DESCRIPTION = 2000;

/** The projects I belong to (an admin sees all), with unread counts. Admin: New project. */
export function Projects({ user, call }: { user: User; call: Session['call'] }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const isAdmin = user.role === 'admin';

  const [projects, setProjects] = useState<Project[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await call<Project[]>('listProjects');
      list.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      setProjects(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    } finally {
      setRefreshing(false);
    }
  }, [call]);

  useEffect(() => { void load(); }, [load]);
  useVisibleInterval(() => { void load(); }, REFRESH_EVERY_MS);

  const onCreated = (p: Project) => {
    setCreating(false);
    setProjects((list) => [p, ...(list ?? []).filter((x) => x.id !== p.id)]);
    if (p.warnings?.length) setNotice(t('Saved, but the Drive folder could not be shared. Open the folder in Drive and share it by hand.'));
  };

  return (
    <main className="main-content fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <h1 className="page-title">{t('Projects')}</h1>
          <p className="page-subtitle">
            {isAdmin ? t('Every project. As an admin you see all of them.') : t('The projects you belong to.')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-icon" onClick={() => void load()} disabled={refreshing} title={t('Refresh')} aria-label={t('Refresh')}>
            <RefreshCw style={{ width: 16, height: 16, animation: refreshing ? 'spin 0.7s linear infinite' : undefined }} />
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus style={{ width: 16, height: 16 }} />
              {t('New project')}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', marginBottom: 16, background: 'var(--surface-warn-strong)', border: '1px solid var(--surface-warn-border)', color: 'var(--surface-warn-text)', fontSize: 13 }}>
          <span style={{ flex: 1 }}>{notice}</span>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setNotice('')} aria-label={t('Close')}><X style={{ width: 14, height: 14 }} /></button>
        </div>
      )}

      {projects === null && !loadError && (
        <div className="card-grid" aria-busy="true" aria-label={t('Loading…')}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 132 }} />)}
        </div>
      )}

      {loadError !== null && projects === null && (
        <div className="empty-state" role="alert">
          <div className="empty-state-title">{t('Could not load the projects')}</div>
          <div className="empty-state-sub">{errorText(t, loadError)}</div>
          <button className="btn btn-primary btn-sm" onClick={() => void load()} disabled={refreshing}>{t('Try again')}</button>
        </div>
      )}

      {projects !== null && loadError !== null && (
        <p role="status" className="text-danger" style={{ fontSize: 13, marginBottom: 12 }}>{errorText(t, loadError)}</p>
      )}

      {projects !== null && projects.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><FolderKanban style={{ width: 28, height: 28 }} /></div>
          <div className="empty-state-title">{t('No projects yet')}</div>
          <div className="empty-state-sub">
            {isAdmin ? t('Create the first project, then add the team to it.') : t('You are not in any project yet. Ask your project lead or the admin to add you.')}
          </div>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              <Plus style={{ width: 15, height: 15 }} />{t('New project')}
            </button>
          )}
        </div>
      )}

      {projects !== null && projects.length > 0 && (
        <div className="card-grid">
          {projects.map((p) => (
            <article key={p.id} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 132 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <h2 dir="auto" style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'start' }}>{p.name}</h2>
                {p.unread > 0 && (
                  <span className="tag" style={{ background: 'var(--danger)', color: '#fff' }} title={t('Unread messages: {{count}}', { count: p.unread })}>
                    <MessageSquare style={{ width: 12, height: 12 }} />{p.unread}
                  </span>
                )}
              </div>
              {p.description && (
                <p dir="auto" style={{ textAlign: 'start', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.description}
                </p>
              )}
              <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
                {p.myRole === 'lead' && <span className="tag">{t('Project lead')}</span>}
                {p.myRole === 'member' && <span className="tag">{t('Member')}</span>}
                {p.myRole === null && <span className="tag" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{t('Not a member')}</span>}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Users style={{ width: 13, height: 13 }} />{t('Members: {{count}}', { count: p.memberCount })}
                </span>
                <span style={{ marginInlineStart: 'auto' }}>{t('Last activity {{when}}', { when: timeAgo(p.lastActivityAt, lang) })}</span>
              </div>
            </article>
          ))}
        </div>
      )}

      {creating && <NewProjectModal call={call} onClose={() => setCreating(false)} onCreated={onCreated} />}
    </main>
  );
}

function NewProjectModal({ call, onClose, onCreated }: { call: Session['call']; onClose: () => void; onCreated: (p: Project) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError(t('Enter a project name.')); return; }
    setSaving(true);
    setError('');
    try {
      onCreated(await call<Project>('createProject', { name: name.trim(), description: description.trim() }));
    } catch (err) {
      setError(errorText(t, err, { CONFLICT: t('A project with this name already exists.') }));
      setSaving(false);
    }
  };

  // Portal: the page's fade-in animation makes <main> the containing block for
  // position:fixed, so an overlay rendered inside it would only cover <main>.
  return createPortal(
    <div className="modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{ padding: 20, maxWidth: 520 }} noValidate>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="new-project-title" style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>{t('New project')}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={saving} aria-label={t('Close')}><X style={{ width: 16, height: 16 }} /></button>
        </div>

        <label className="input-label" htmlFor="np-name">{t('Project name')}</label>
        <input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME} autoFocus required aria-invalid={!!error && !name.trim()} />

        <label className="input-label" htmlFor="np-desc" style={{ marginTop: 14 }}>{t('Description (optional)')}</label>
        <textarea id="np-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_DESCRIPTION} rows={3} style={{ resize: 'vertical' }} />

        <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>{t('A Drive folder is made for the project, and you become its lead.')}</p>
        {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 10 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t('Creating…') : t('Create project')}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
