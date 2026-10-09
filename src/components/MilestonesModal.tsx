import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Check, Flag, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import { errorText } from '../lib/errors';
import { localDay, shortDate } from '../lib/format';
import { MAX_MILESTONE, liveMilestones, milestoneProgress } from '../lib/milestones';
import type { Milestone, Task } from '../types';

interface Props {
  projectId: string;
  call: Session['call'];
  milestones: Milestone[];
  tasks: Task[];
  /** Lead or admin: may add, change and remove. Everyone else sees the list and progress. */
  canManage: boolean;
  onChanged: (m: Milestone) => void;
  onClose: () => void;
}

/** The project's milestones with how far each one is; the lead or an admin keeps the list. */
export function MilestonesModal({ projectId, call, milestones, tasks, canManage, onChanged, onClose }: Props) {
  const { t } = useTranslation();
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const today = localDay(Date.now());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const live = liveMilestones(milestones);

  const run = async (action: string, args: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      onChanged(await call<Milestone>(action, { projectId, ...args }));
      after?.();
    } catch (err) {
      setError(errorText(t, err, {
        CONFLICT: t('There is already a milestone with that name.'),
        FORBIDDEN: t('Only the project lead or an admin can add, change or remove a milestone.'),
      }));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    void run('addMilestone', { name, dueDate: newDate }, () => { setNewName(''); setNewDate(''); });
  };

  const save = (m: Milestone) => {
    const name = editName.trim();
    if (!name) return;
    const changes: Record<string, unknown> = {};
    if (name !== m.name) changes.name = name;
    if (editDate !== m.dueDate) changes.dueDate = editDate;
    if (!Object.keys(changes).length) { setEditId(null); return; }
    void run('editMilestone', { milestoneId: m.id, ...changes }, () => setEditId(null));
  };

  const remove = (m: Milestone, used: number) => {
    const msg = used
      ? t('Remove milestone "{{name}}"? {{count}} tasks are linked to it; they will show no milestone.', { name: m.name, count: used })
      : t('Remove milestone "{{name}}"?', { name: m.name });
    if (window.confirm(msg)) void run('editMilestone', { milestoneId: m.id, deleted: true });
  };

  return createPortal(
    <div className="modal-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal task-modal" role="dialog" aria-modal="true" aria-labelledby="ms-modal-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h2 id="ms-modal-title" style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>{t('Milestones')}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={busy} aria-label={t('Close')}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          {canManage
            ? t('The checkpoints of this project. Link tasks to a milestone; its progress is the average of those tasks.')
            : t('The checkpoints of this project. Its progress is the average of the tasks linked to it; the project lead keeps this list.')}
        </p>

        {canManage && (
          <form className="ms-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <input
              className="input" dir="auto" value={newName} maxLength={MAX_MILESTONE} disabled={busy}
              placeholder={t('New milestone name')} aria-label={t('New milestone name')}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              type="date" className="input" dir="ltr" value={newDate} disabled={busy}
              aria-label={t('Due date (optional)')} title={t('Due date (optional)')}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>
              <Plus style={{ width: 15, height: 15 }} />{t('Add')}
            </button>
          </form>
        )}

        {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 8 }}>{error}</p>}

        {live.length === 0 ? (
          <div className="cat-empty"><Flag style={{ width: 18, height: 18 }} />{t('No milestones yet.')}</div>
        ) : (
          <ul className="cat-list">
            {live.map((m) => {
              const p = milestoneProgress(m, tasks, today);
              return (
                <li key={m.id} className="ms-item">
                  {editId === m.id ? (
                    <div className="ms-edit">
                      <input
                        className="input" dir="auto" value={editName} maxLength={MAX_MILESTONE} autoFocus disabled={busy}
                        aria-label={t('Milestone name')}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); save(m); }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditId(null); }
                        }}
                      />
                      <input type="date" className="input" dir="ltr" value={editDate} disabled={busy} aria-label={t('Due date (optional)')} onChange={(e) => setEditDate(e.target.value)} />
                      <button type="button" className="btn btn-primary btn-icon btn-sm" onClick={() => save(m)} disabled={busy || !editName.trim()} aria-label={t('Save')}><Check style={{ width: 15, height: 15 }} /></button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditId(null)} disabled={busy} aria-label={t('Cancel')}><X style={{ width: 15, height: 15 }} /></button>
                    </div>
                  ) : (
                    <>
                      <div className="ms-head">
                        <Flag className={`ms-flag${p.total > 0 && p.done === p.total ? ' complete' : ''}`} style={{ width: 15, height: 15 }} aria-hidden="true" />
                        <bdi className="cat-name">{m.name}</bdi>
                        {canManage && (
                          <>
                            <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} aria-label={t('Change {{name}}', { name: m.name })}
                              onClick={() => { setEditId(m.id); setEditName(m.name); setEditDate(m.dueDate); setError(''); }}>
                              <Pencil style={{ width: 14, height: 14 }} />
                            </button>
                            <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} aria-label={t('Remove {{name}}', { name: m.name })} onClick={() => remove(m, p.total)}>
                              <Trash2 style={{ width: 14, height: 14 }} />
                            </button>
                          </>
                        )}
                      </div>
                      <MilestoneMeter m={m} p={p} />
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Close')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Bar + "3 of 5 tasks done · Due 1 Dec" — used in this window and in the Tasks group headings. */
export function MilestoneMeter({ m, p }: { m: Milestone; p: ReturnType<typeof milestoneProgress> }) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  return (
    <div className="ms-meter">
      <span className="progress-bar" aria-hidden="true"><span className="progress-fill" style={{ display: 'block', width: `${p.percent}%` }} /></span>
      <span className="ms-percent ltr-data">{p.percent}%</span>
      <span className="ms-sub">
        {p.total ? t('{{done}} of {{total}} tasks done', { done: p.done, total: p.total }) : t('No tasks linked yet')}
        {m.dueDate && (
          <span className={`task-due${p.late ? ' late' : ''}`}>
            <CalendarClock style={{ width: 13, height: 13 }} />
            {p.late ? t('Late, was due {{date}}', { date: shortDate(m.dueDate, lang) }) : t('Due {{date}}', { date: shortDate(m.dueDate, lang) })}
          </span>
        )}
      </span>
    </div>
  );
}
