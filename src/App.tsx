import { useTranslation } from 'react-i18next';
import { CheckSquare, FolderOpen, Languages, MessageSquare, Moon, Sun, TrendingUp, Users } from 'lucide-react';
import { useLanguage } from './hooks/useLanguage';
import { useTheme } from './hooks/useTheme';
import { isConfigured } from './config';

/**
 * App shell. Sign-in, projects, chat, tasks and updates are added screen by
 * screen (see docs/DESIGN.md); until the Google back end is configured the
 * shell says so plainly instead of showing a sign-in that cannot work.
 */
export default function App() {
  const { t } = useTranslation();
  const { isRtl, toggle: toggleLang } = useLanguage();
  const { isDark, toggle: toggleTheme } = useTheme();

  const features = [
    { icon: MessageSquare, label: t('Team chat with @mentions') },
    { icon: CheckSquare, label: t('Tasks for each person') },
    { icon: TrendingUp, label: t('What I did, what is left') },
    { icon: FolderOpen, label: t('Photos and files on Drive') },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header className="topnav">
        <div className="topnav-logo">
          <div className="topnav-logo-icon"><Users style={{ width: 18, height: 18, color: '#fff' }} /></div>
          <span className="topnav-brand">{t('ETaske Team')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginInlineStart: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={toggleLang} title={isRtl ? t('Switch to English') : t('Switch to Arabic')}>
            <Languages style={{ width: 16, height: 16 }} />
            {isRtl ? t('English') : t('Arabic')}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} title={isDark ? t('Light mode') : t('Dark mode')} aria-label={isDark ? t('Light mode') : t('Dark mode')}>
            {isDark ? <Sun style={{ width: 16, height: 16 }} /> : <Moon style={{ width: 16, height: 16 }} />}
          </button>
        </div>
      </header>

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

          <div
            role="status"
            style={{
              padding: '12px 14px',
              border: '1px solid',
              borderColor: isConfigured ? 'var(--success)' : 'var(--surface-warn-border)',
              background: isConfigured ? 'var(--green-50)' : 'var(--surface-warn-strong)',
              color: isConfigured ? 'var(--text-primary)' : 'var(--surface-warn-text)',
              fontSize: 14,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>
              {isConfigured ? t('Ready to sign in') : t('Setup not finished')}
            </strong>
            {isConfigured
              ? t('The Google connection is set. Sign-in arrives in the next release.')
              : t('Google sign-in and the Drive connection are not switched on yet, so nobody can sign in.')}
          </div>
        </div>
      </main>
    </div>
  );
}
