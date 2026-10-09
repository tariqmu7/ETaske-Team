import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, RefreshCw, ShieldCheck, ShieldOff, UserCheck, UserX } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { useVisibleInterval } from '../hooks/useVisibleInterval';
import type { Session } from '../hooks/useSession';
import { errorText } from '../lib/errors';
import { timeAgo } from '../lib/format';
import type { User, UserRole, UserStatus } from '../types';
import { Avatar } from '../components/Avatar';

const REFRESH_EVERY_MS = 60 * 1000;

const STATUS_BADGE: Record<UserStatus, string> = { pending: 'badge-pending', approved: 'badge-done', blocked: 'badge-closed' };

/** Admin only: approve sign-ups, block / unblock people, choose admins. */
export function UsersAdmin({ me, call, onUsers }: { me: User; call: Session['call']; onUsers: (users: User[]) => void }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [users, setUsers] = useState<User[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'warn'; text: string } | null>(null);

  const statusLabel: Record<UserStatus, string> = { pending: t('Pending'), approved: t('Approved'), blocked: t('Blocked') };

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const list = await call<User[]>('listUsers');
      setUsers(list);
      onUsers(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    } finally {
      setRefreshing(false);
    }
  }, [call, onUsers]);

  useEffect(() => { void load(); }, [load]);
  useVisibleInterval(() => { void load(); }, REFRESH_EVERY_MS);

  // One change at a time (`busy` locks the buttons), so the list in scope is current.
  const replace = (u: User) => {
    const next = (users ?? []).map((x) => (x.email === u.email ? { ...u, warnings: undefined } : x));
    setUsers(next);
    onUsers(next);
  };

  const act = async (u: User, action: 'setUserStatus' | 'setUserRole', value: UserStatus | UserRole) => {
    if (action === 'setUserStatus' && value === 'blocked'
      && !window.confirm(t('Block {{name}}? They lose access to every project and its Drive folder.', { name: u.name || u.email }))) return;
    setBusy(u.email);
    setMessage(null);
    try {
      const args = action === 'setUserStatus' ? { email: u.email, status: value } : { email: u.email, role: value };
      const updated = await call<User>(action, args);
      replace(updated);
      if (updated.warnings?.length) setMessage({ kind: 'warn', text: t('Saved, but the Drive folder could not be shared. Open the folder in Drive and share it by hand.') });
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(t, err, { FORBIDDEN: t('This admin cannot be blocked or made a member.') }) });
    } finally {
      setBusy(null);
    }
  };

  const pending = (users ?? []).filter((u) => u.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const others = (users ?? []).filter((u) => u.status !== 'pending')
    .sort((a, b) => (a.status === b.status ? (a.name || a.email).localeCompare(b.name || b.email) : a.status === 'approved' ? -1 : 1));

  const person = (u: User, sub: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 220px' }}>
      <Avatar name={u.name} email={u.email} photoUrl={u.photoUrl} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
          <bdi className="text-truncate">{u.name || u.email}</bdi>
          {u.email === me.email && <span className="tag">{t('You')}</span>}
        </div>
        {u.name && <bdi className="text-muted text-truncate" style={{ display: 'block', fontSize: 12 }}>{u.email}</bdi>}
        {sub && <div className="text-muted" style={{ fontSize: 12 }}>{sub}</div>}
      </div>
    </div>
  );

  const rowStyle = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const, padding: '12px 14px', borderTop: '1px solid var(--border)' };

  return (
    <main className="main-content fade-in">
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h1 className="page-title">{t('Users')}</h1>
          <p className="page-subtitle">{t('Approve new sign-ups, block people, and choose who is an admin.')}</p>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={() => void load()} disabled={refreshing} title={t('Refresh')} aria-label={t('Refresh')}>
          <RefreshCw style={{ width: 16, height: 16, animation: refreshing ? 'spin 0.7s linear infinite' : undefined }} />
        </button>
      </div>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} style={{ padding: '10px 12px', marginBottom: 16, fontSize: 13, border: '1px solid', borderColor: message.kind === 'error' ? 'rgba(239,68,68,0.3)' : 'var(--surface-warn-border)', background: message.kind === 'error' ? 'rgba(239,68,68,0.06)' : 'var(--surface-warn-strong)', color: message.kind === 'error' ? 'var(--danger)' : 'var(--surface-warn-text)' }}>
          {message.text}
        </p>
      )}

      {users === null && !loadError && (
        <div style={{ display: 'grid', gap: 8 }} aria-busy="true" aria-label={t('Loading…')}>
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 60 }} />)}
        </div>
      )}

      {loadError !== null && users === null && (
        <div className="empty-state" role="alert">
          <div className="empty-state-title">{t('Could not load the users')}</div>
          <div className="empty-state-sub">{errorText(t, loadError)}</div>
          <button className="btn btn-primary btn-sm" onClick={() => void load()} disabled={refreshing}>{t('Try again')}</button>
        </div>
      )}

      {users !== null && (
        <>
          <section className="card" style={{ marginBottom: 20 }} aria-labelledby="pending-title">
            <h2 id="pending-title" style={{ padding: '12px 14px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserCheck style={{ width: 17, height: 17, color: 'var(--warning)' }} />
              {t('Waiting for approval')}
              <span className="tag" style={pending.length ? { background: 'var(--danger)', color: '#fff' } : undefined}>{pending.length}</span>
            </h2>
            {pending.length === 0 && <p className="text-muted" style={{ ...rowStyle, fontSize: 13 }}>{t('Nobody is waiting.')}</p>}
            {pending.map((u) => (
              <div key={u.email} style={rowStyle}>
                {person(u, t('Signed up {{when}}', { when: timeAgo(u.createdAt, lang) }))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-success btn-sm" disabled={busy !== null} onClick={() => void act(u, 'setUserStatus', 'approved')}>
                    <Check style={{ width: 14, height: 14 }} />{t('Approve')}
                  </button>
                  <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => void act(u, 'setUserStatus', 'blocked')}>
                    <UserX style={{ width: 14, height: 14 }} />{t('Block')}
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="card" aria-labelledby="all-title">
            <h2 id="all-title" style={{ padding: '12px 14px', fontSize: 15, fontWeight: 700 }}>{t('Everyone else')}</h2>
            {others.length === 0 && <p className="text-muted" style={{ ...rowStyle, fontSize: 13 }}>{t('Nobody yet.')}</p>}
            {others.map((u) => {
              const self = u.email === me.email;
              const seen = u.lastSeenAt ? t('Last seen {{when}}', { when: timeAgo(u.lastSeenAt, lang) }) : '';
              return (
                <div key={u.email} style={rowStyle} aria-busy={busy === u.email}>
                  {person(u, seen)}
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`badge ${STATUS_BADGE[u.status]}`}>{statusLabel[u.status]}</span>
                    {u.role === 'admin' && <span className="badge badge-review">{t('Admin')}</span>}
                  </div>
                  {!self && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginInlineStart: 'auto' }}>
                      {u.status === 'approved' && (u.role === 'admin' ? (
                        <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void act(u, 'setUserRole', 'member')}>
                          <ShieldOff style={{ width: 14, height: 14 }} />{t('Make member')}
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void act(u, 'setUserRole', 'admin')}>
                          <ShieldCheck style={{ width: 14, height: 14 }} />{t('Make admin')}
                        </button>
                      ))}
                      {u.status === 'approved' ? (
                        <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => void act(u, 'setUserStatus', 'blocked')}>
                          <UserX style={{ width: 14, height: 14 }} />{t('Block')}
                        </button>
                      ) : (
                        <button className="btn btn-success btn-sm" disabled={busy !== null} onClick={() => void act(u, 'setUserStatus', 'approved')}>
                          <Check style={{ width: 14, height: 14 }} />{t('Unblock')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
