import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, FolderOpen, MessageSquare, TrendingUp } from 'lucide-react';
import { GOOGLE_CLIENT_ID, isConfigured } from '../config';
import { useLanguage } from '../hooks/useLanguage';
import { startGoogle } from '../lib/google';

interface Props {
  expired: boolean;
  googleFailed: boolean;
  onRetryGoogle: () => void;
}

/** Welcome card + "Sign in with Google". Before the back end is set, it says so instead. */
export function SignIn({ expired, googleFailed, onRetryGoogle }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [buttonReady, setButtonReady] = useState(false);

  const features = [
    { icon: MessageSquare, label: t('Team chat with @mentions') },
    { icon: CheckSquare, label: t('Tasks for each person') },
    { icon: TrendingUp, label: t('What I did, what is left') },
    { icon: FolderOpen, label: t('Photos and files on Drive') },
  ];

  // Google draws its own button; redraw it in the new language.
  useEffect(() => {
    if (!isConfigured || googleFailed) return;
    let alive = true;
    // No handler here: useSession owns what happens to the token.
    startGoogle(GOOGLE_CLIENT_ID).then(() => {
      const id = window.google?.accounts?.id;
      const el = buttonRef.current;
      if (!alive || !id || !el) return;
      el.innerHTML = '';
      id.renderButton(el, {
        type: 'standard', theme: 'outline', size: 'large',
        text: 'signin_with', shape: 'rectangular', logo_alignment: 'left', locale: lang,
        width: Math.min(400, Math.max(200, el.clientWidth)),
      });
      setButtonReady(true);
    }).catch(() => { /* useSession reports googleFailed */ });
    return () => { alive = false; };
  }, [lang, googleFailed]);

  return (
    <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
      <div className="card fade-in" style={{ width: '100%', maxWidth: 520, padding: 'clamp(20px, 6vw, 32px)' }}>
        <h1 className="page-title" style={{ marginBottom: 8 }}>{t('The project team\'s workspace')}</h1>
        <p className="page-subtitle" style={{ marginBottom: 24 }}>
          {t('Chat, tasks, daily progress, photos and files for every project, in one place, stored in the team\'s Google Drive.')}
        </p>

        <ul style={{ listStyle: 'none', display: 'grid', gap: 12, marginBottom: 28 }}>
          {features.map(({ icon: Icon, label }) => (
            <li key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>
              <Icon style={{ width: 18, height: 18, color: 'var(--accent)', flexShrink: 0 }} />
              {label}
            </li>
          ))}
        </ul>

        {!isConfigured ? (
          <div role="status" style={{ padding: '12px 14px', border: '1px solid var(--surface-warn-border)', background: 'var(--surface-warn-strong)', color: 'var(--surface-warn-text)', fontSize: 14 }}>
            <strong style={{ display: 'block', marginBottom: 4 }}>{t('Setup not finished')}</strong>
            {t('Google sign-in and the Drive connection are not switched on yet, so nobody can sign in.')}
          </div>
        ) : (
          <>
            {expired && (
              <p role="status" style={{ padding: '10px 12px', marginBottom: 14, background: 'var(--surface-warn-strong)', border: '1px solid var(--surface-warn-border)', color: 'var(--surface-warn-text)', fontSize: 13 }}>
                {t('Your sign-in has expired. Please sign in again.')}
              </p>
            )}
            <p style={{ fontWeight: 600, marginBottom: 12 }}>{t('Sign in with your Google account to continue.')}</p>
            {googleFailed ? (
              <div role="alert" style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
                <p className="text-danger" style={{ fontSize: 14 }}>{t('Google sign-in could not load. Check your connection and try again.')}</p>
                <button className="btn btn-primary btn-sm" onClick={onRetryGoogle}>{t('Try again')}</button>
              </div>
            ) : (
              <div style={{ minHeight: 44, position: 'relative' }}>
                {!buttonReady && <div className="spinner" style={{ position: 'absolute', top: 11 }} aria-label={t('Loading…')} />}
                <div ref={buttonRef} style={{ width: '100%', maxWidth: 400 }} />
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 13, marginTop: 16 }}>
              {t('Only people the admin approves can see the projects.')}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
