import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Clock, RefreshCw } from 'lucide-react';
import { useVisibleInterval } from '../hooks/useVisibleInterval';
import type { User } from '../types';
import { Avatar } from '../components/Avatar';

const CHECK_EVERY_MS = 30 * 1000;

/** Shown to a signed-in account that is pending (checks again by itself) or blocked. */
export function Waiting({ user, onCheck, onSignOut }: { user: User; onCheck: () => Promise<void>; onSignOut: () => void }) {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const pending = user.status === 'pending';

  useVisibleInterval(() => { void onCheck(); }, CHECK_EVERY_MS, pending);

  const checkNow = async () => {
    setChecking(true);
    try { await onCheck(); } finally { setChecking(false); }
  };

  const Icon = pending ? Clock : Ban;
  return (
    <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <div className="card fade-in" style={{ width: '100%', maxWidth: 480, padding: 'clamp(20px, 6vw, 32px)' }}>
        <div className="empty-state-icon" style={{ margin: '0 0 16px', background: pending ? 'var(--surface-warn-strong)' : 'var(--surface-3)', color: pending ? 'var(--warning)' : 'var(--danger)' }}>
          <Icon style={{ width: 28, height: 28 }} />
        </div>
        <h1 className="page-title" style={{ marginBottom: 8 }}>{pending ? t('Waiting for approval') : t('Account blocked')}</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
          {pending
            ? t('An admin must approve your account before you can see the projects.')
            : t('This account has been blocked. If this is a mistake, contact the admin.')}
        </p>

        <div className="section-label">{t('Signed in as')}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 16 }}>
          <Avatar name={user.name} email={user.email} photoUrl={user.photoUrl} size={36} />
          <div style={{ minWidth: 0 }}>
            {user.name && <bdi style={{ display: 'block', fontWeight: 600 }} className="text-truncate">{user.name}</bdi>}
            <bdi className="text-muted text-truncate" style={{ display: 'block', fontSize: 13 }}>{user.email}</bdi>
          </div>
        </div>

        {pending && <p className="text-muted" style={{ fontSize: 13, marginBottom: 16 }}>{t('This page checks again by itself every 30 seconds.')}</p>}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {pending && (
            <button className="btn btn-primary" onClick={checkNow} disabled={checking}>
              <RefreshCw style={{ width: 15, height: 15, animation: checking ? 'spin 0.7s linear infinite' : undefined }} />
              {t('Check now')}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onSignOut}>{t('Sign out')}</button>
        </div>
      </div>
    </main>
  );
}
