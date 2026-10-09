import { useTranslation } from 'react-i18next';
import { FolderKanban, Languages, LogOut, Moon, Sun, UserCheck, Users } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import { useTheme } from '../hooks/useTheme';
import type { User } from '../types';
import { Avatar } from './Avatar';

export type Route = 'projects' | 'users';

interface Props {
  user?: User | null;
  /** Tabs show only for an approved user. */
  route?: Route;
  onNavigate?: (r: Route) => void;
  pendingCount?: number;
  /** Inside a project the phone's bottom bar would sit on top of the message box. */
  hideBottomNav?: boolean;
  onSignOut?: () => void;
}

/** Top bar on every screen; on a phone an admin also gets a bottom bar with the same tabs. */
export function TopNav({ user, route, onNavigate, pendingCount = 0, hideBottomNav = false, onSignOut }: Props) {
  const { t } = useTranslation();
  const { isRtl, toggle: toggleLang } = useLanguage();
  const { isDark, toggle: toggleTheme } = useTheme();

  const approved = user?.status === 'approved';
  const isAdmin = approved && user?.role === 'admin';
  const tabs = !approved || !onNavigate ? [] : [
    { id: 'projects' as const, icon: FolderKanban, label: t('Projects'), badge: 0 },
    ...(isAdmin ? [{ id: 'users' as const, icon: UserCheck, label: t('Users'), badge: pendingCount }] : []),
  ];

  return (
    <>
      <header className="topnav">
        <div className="topnav-logo">
          <div className="topnav-logo-icon"><Users style={{ width: 18, height: 18, color: '#fff' }} /></div>
          <span className="topnav-brand">{t('ETaske Team')}</span>
        </div>

        {tabs.length > 1 && (
          <nav className="topnav-tabs" aria-label={t('Main navigation')}>
            {tabs.map(({ id, icon: Icon, label, badge }) => (
              <button key={id} className={`nav-tab${route === id ? ' active' : ''}`} onClick={() => onNavigate?.(id)} aria-current={route === id ? 'page' : undefined}>
                <Icon style={{ width: 16, height: 16 }} />
                <span>{label}</span>
                {badge > 0 && <span className="tab-badge">{badge}</span>}
              </button>
            ))}
          </nav>
        )}

        <div className="topnav-user" style={{ marginInlineStart: 'auto' }}>
          <button className="btn btn-ghost btn-sm" onClick={toggleLang} title={isRtl ? t('Switch to English') : t('Switch to Arabic')}>
            <Languages style={{ width: 16, height: 16 }} />
            {isRtl ? t('English') : t('Arabic')}
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={toggleTheme} title={isDark ? t('Light mode') : t('Dark mode')} aria-label={isDark ? t('Light mode') : t('Dark mode')}>
            {isDark ? <Sun style={{ width: 16, height: 16 }} /> : <Moon style={{ width: 16, height: 16 }} />}
          </button>
          {user && (
            <span title={user.email} style={{ display: 'inline-flex' }}>
              <Avatar name={user.name} email={user.email} photoUrl={user.photoUrl} size={34} />
            </span>
          )}
          {onSignOut && (
            <button className="logout-btn" onClick={onSignOut} title={t('Sign out')} aria-label={t('Sign out')}>
              <LogOut style={{ width: 15, height: 15 }} />
              <span className="logout-label">{t('Sign out')}</span>
            </button>
          )}
        </div>
      </header>

      {tabs.length > 1 && !hideBottomNav && (
        <nav className="bottom-nav" aria-label={t('Main navigation')}>
          {tabs.map(({ id, icon: Icon, label, badge }) => (
            <button key={id} className={`bottom-tab${route === id ? ' active' : ''}`} onClick={() => onNavigate?.(id)} aria-current={route === id ? 'page' : undefined}>
              {/* a div, not a span: the phone CSS clips every `.bottom-tab span` */}
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <Icon />
                {badge > 0 && <div className="notif-badge">{badge}</div>}
              </div>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
