import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Crown, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { errorText } from '../lib/errors';
import { localDay, timeAgo } from '../lib/format';
import { isLate } from '../lib/tasks';
import type { Member, ProjectRole, User } from '../types';

type Sync = ReturnType<typeof useProjectSync>;

interface Props {
  projectId: string;
  me: User;
  call: Session['call'];
  sync: Sync;
  members: Member[];
  /** Re-reads the member list after a change. */
  reloadMembers: () => Promise<void>;
  isLead: boolean;
  archived: boolean;
}

const roleRank = (r: ProjectRole) => (r === 'lead' ? 0 : 1);

/** Who is in the project, their role and load. An admin or the project lead adds and removes people. */
export function ProjectPeople({ projectId, me, call, sync, members, reloadMembers, isLead, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const myEmail = me.email.toLowerCase();
  const isAdmin = me.role === 'admin';
  const canManage = !archived && (isAdmin || isLead);

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');          // e-mail being changed
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const today = localDay(Date.now());
  const stats = useMemo(() => {
    const map = new Map<string, { open: number; late: number; postedToday: boolean; lastUpdate: string }>();
    const get = (email: string) => {
      const key = email.toLowerCase();
      let s = map.get(key);
      if (!s) { s = { open: 0, late: 0, postedToday: false, lastUpdate: '' }; map.set(key, s); }
      return s;
    };
    for (const task of sync.tasks) {
      if (!task.assigneeEmail || task.status === 'done') continue;
      const s = get(task.assigneeEmail);
      s.open++;
      if (isLate(task, today)) s.late++;
    }
    for (const u of sync.updates) {
      const s = get(u.authorEmail);
      if (u.date === today) s.postedToday = true;
      const at = u.updatedAt > u.createdAt ? u.updatedAt : u.createdAt;
      if (at > s.lastUpdate) s.lastUpdate = at;
    }
    return map;
  }, [sync.tasks, sync.updates, today]);

  const sorted = useMemo(() => [...members].sort((a, b) =>
    roleRank(a.role) - roleRank(b.role)
    || (a.email.toLowerCase() === myEmail ? -1 : b.email.toLowerCase() === myEmail ? 1 : 0)
    || (a.name || a.email).localeCompare(b.name || b.email)), [members, myEmail]);

  const leads = members.filter((m) => m.role === 'lead').length;
  const nameOf = (m: Member) => m.name || m.email.split('@')[0];

  const afterChange = async (warnings: string[] | undefined) => {
    if (warnings?.length) setNotice(t('Saved, but the Drive folder could not be shared. Open the folder in Drive and share it by hand.'));
    await reloadMembers();
  };

  const remove = async (m: Member) => {
    const self = m.email.toLowerCase() === myEmail;
    const question = self
      ? t('Leave this project? You will no longer see its chat, tasks or files.')
      : t('Remove {{name}} from this project? They will no longer see its chat, tasks or files.', { name: nameOf(m) });
    if (!window.confirm(question)) return;
    setBusy(m.email); setError(''); setNotice('');
    try {
      const out = await call<{ warnings?: string[] }>('removeMember', { projectId, email: m.email });
      await afterChange(out.warnings);
    } catch (err) {
      setError(errorText(t, err, { NOT_FOUND: t('This person is no longer in the project.') }));
    } finally {
      setBusy('');
    }
  };

  const setRole = async (m: Member, role: ProjectRole) => {
    setBusy(m.email); setError(''); setNotice('');
    try {
      const out = await call<Member>('addMember', { projectId, email: m.email, role });
      await afterChange(out.warnings);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="project-pane">
      <div className="pane-toolbar">
        <div className="pane-stats" aria-label={t('People summary')}>
          <span><strong>{members.length}</strong> {t('people')}</span>
          <span><strong>{leads}</strong> {t('leads')}</span>
        </div>
        {canManage && !adding && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setAdding(true); setError(''); setNotice(''); }}>
            <UserPlus style={{ width: 15, height: 15 }} />{t('Add person')}
          </button>
        )}
      </div>

      {adding && (
        <AddPerson
          projectId={projectId}
          call={call}
          isAdmin={isAdmin}
          members={members}
          onClose={() => setAdding(false)}
          onAdded={async (out) => { setAdding(false); await afterChange(out.warnings); }}
        />
      )}

      {notice && (
        <div role="status" className="people-notice">
          <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setNotice('')} aria-label={t('Close')}><X style={{ width: 14, height: 14 }} /></button>
        </div>
      )}
      {error && <p role="alert" className="text-danger" style={{ fontSize: 13, margin: '0 2px 10px' }}>{error}</p>}

      {members.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Users style={{ width: 28, height: 28 }} /></div>
          <div className="empty-state-title">{t('Loading…')}</div>
        </div>
      ) : (
        <ul className="people-list">
          {sorted.map((m) => {
            const email = m.email.toLowerCase();
            const self = email === myEmail;
            const s = stats.get(email);
            const canRemove = canManage && (m.role !== 'lead' || isAdmin);
            return (
              <li key={m.email} className="person-row" aria-busy={busy === m.email}>
                <Avatar name={m.name} email={m.email} photoUrl={m.photoUrl} size={40} />
                <div className="person-main">
                  <div className="person-name-line">
                    <bdi className="person-name">{nameOf(m)}</bdi>
                    {self && <span className="tag">{t('You')}</span>}
                    {m.role === 'lead' && <span className="tag tag-lead"><Crown style={{ width: 11, height: 11 }} />{t('Project lead')}</span>}
                    {m.status === 'blocked' && <span className="tag tag-danger">{t('Blocked')}</span>}
                    {m.status === 'pending' && <span className="tag tag-warn">{t('Pending')}</span>}
                  </div>
                  <div className="person-email" dir="ltr">{m.email}</div>
                  <div className="person-meta">
                    <span>{t('Open tasks: {{count}}', { count: s?.open ?? 0 })}</span>
                    {(s?.late ?? 0) > 0 && <span className="pane-stat-late">{t('{{count}} late', { count: s?.late ?? 0 })}</span>}
                    {s?.postedToday
                      ? <span className="person-posted"><Check style={{ width: 12, height: 12 }} />{t('Posted today')}</span>
                      : s?.lastUpdate
                        ? <span>{t('Last update {{when}}', { when: timeAgo(s.lastUpdate, lang) })}</span>
                        : <span>{t('No update in 30 days')}</span>}
                  </div>
                </div>
                {(canRemove || (canManage && isAdmin)) && (
                  <div className="person-actions">
                    {isAdmin && canManage && (
                      m.role === 'lead'
                        ? <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== ''} onClick={() => void setRole(m, 'member')}>{t('Make member')}</button>
                        : <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== '' || m.status !== 'approved'} onClick={() => void setRole(m, 'lead')}>{t('Make lead')}</button>
                    )}
                    {canRemove && (
                      <button type="button" className="btn btn-ghost btn-icon btn-sm person-remove" disabled={busy !== ''}
                        onClick={() => void remove(m)}
                        title={self ? t('Leave project') : t('Remove {{name}}', { name: nameOf(m) })}
                        aria-label={self ? t('Leave project') : t('Remove {{name}}', { name: nameOf(m) })}>
                        <UserMinus style={{ width: 16, height: 16 }} />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!canManage && !archived && (
        <p className="text-muted people-hint">{t('Only the project lead or an admin can add or remove people.')}</p>
      )}
      {archived && <p className="text-muted people-hint">{t('This project is archived.')}</p>}
    </div>
  );
}

interface AddProps {
  projectId: string;
  call: Session['call'];
  isAdmin: boolean;
  members: Member[];
  onClose: () => void;
  onAdded: (out: Member) => Promise<void>;
}

/**
 * Admin: pick from the approved people. Lead: type the e-mail (only admins can
 * list users). Either way the person must have signed in and been approved.
 */
function AddPerson({ projectId, call, isAdmin, members, onClose, onAdded }: AddProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('member');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAdmin) return;
    let live = true;
    call<User[]>('listUsers')
      .then((list) => { if (live) setUsers(list); })
      .catch(() => { if (live) setUsers([]); });   // falls back to typing the e-mail
    return () => { live = false; };
  }, [call, isAdmin]);

  const inProject = useMemo(() => new Set(members.map((m) => m.email.toLowerCase())), [members]);
  const choices = useMemo(() => (users ?? [])
    .filter((u) => u.status === 'approved' && !inProject.has(u.email.toLowerCase()))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)), [users, inProject]);
  const pick = isAdmin && users !== null && users.length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError(pick ? t('Choose a person.') : t('Enter a valid e-mail address.')); return; }
    if (inProject.has(value)) { setError(t('This person is already in the project.')); return; }
    setSaving(true); setError('');
    try {
      await onAdded(await call<Member>('addMember', { projectId, email: value, ...(isAdmin ? { role } : {}) }));
    } catch (err) {
      setError(errorText(t, err, {
        NOT_APPROVED: t('This person must sign in once and be approved by an admin before they can be added.'),
      }));
      setSaving(false);
    }
  };

  return (
    <form className="update-form people-add" onSubmit={submit} noValidate>
      <div className="update-form-title">{t('Add a person to this project')}</div>
      {isAdmin && users === null ? (
        <div className="text-muted" style={{ fontSize: 13 }}>{t('Loading…')}</div>
      ) : pick ? (
        <>
          <label className="input-label" htmlFor="add-person">{t('Person')}</label>
          <select id="add-person" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus>
            <option value="">{choices.length ? t('Choose a person…') : t('Everyone approved is already in the project')}</option>
            {choices.map((u) => <option key={u.email} value={u.email}>{u.name ? `${u.name} — ${u.email}` : u.email}</option>)}
          </select>
        </>
      ) : (
        <>
          <label className="input-label" htmlFor="add-person">{t('Their Google e-mail')}</label>
          <input id="add-person" className="input" type="email" dir="ltr" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@gmail.com" />
        </>
      )}
      {isAdmin && (
        <>
          <label className="input-label" htmlFor="add-role" style={{ marginTop: 12 }}>{t('Role')}</label>
          <select id="add-role" className="input" value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
            <option value="member">{t('Member')}</option>
            <option value="lead">{t('Project lead')}</option>
          </select>
        </>
      )}
      <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
        {t('They must have signed in once and been approved. They also get view access to the project folder in Drive.')}
      </p>
      {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 8 }}>{error}</p>}
      <div className="update-form-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? t('Adding…') : t('Add')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
      </div>
    </form>
  );
}
