import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, CalendarClock, Trash2 } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import { errorText } from '../lib/errors';
import { displayName, localDay, shortDate, timeAgo } from '../lib/format';
import { MAX_FOLLOWUP, followUpState, followUpsOf } from '../lib/followups';
import type { FollowUp, Task } from '../types';

interface Props {
  projectId: string;
  call: Session['call'];
  task: Task;
  /** The project's follow-ups (all tasks, removed ones too). */
  followUps: FollowUp[];
  people: Map<string, { name: string }>;
  myEmail: string;
  /** False on an archived project: the log is read-only. */
  canAdd: boolean;
  /** Lead or admin: may remove anyone's entry (everyone may remove their own). */
  canManage: boolean;
  onChanged: (f: FollowUp) => void;
}

/**
 * The dated log under a task: what was chased, who chased it, and when to chase next.
 * Sits inside the task form, so it uses plain buttons (never a nested form or submit).
 */
export function FollowUpLog({ projectId, call, task, followUps, people, myEmail, canAdd, canManage, onChanged }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useMemo(() => followUpsOf(followUps, task.id), [followUps, task.id]);
  const today = localDay(Date.now());
  const pending = task.status !== 'done' ? list[0]?.nextDate ?? '' : '';
  const state = pending ? followUpState(pending, today) : null;

  const add = async () => {
    const text = note.trim();
    if (!text) { setError(t('Write what was done or agreed.')); return; }
    setBusy(true);
    setError('');
    try {
      onChanged(await call<FollowUp>('addFollowUp', { projectId, taskId: task.id, note: text, nextDate }));
      setNote('');
      setNextDate('');
    } catch (err) {
      setError(errorText(t, err, { NOT_FOUND: t('This task no longer exists.') }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f: FollowUp) => {
    if (!window.confirm(t('Remove this follow-up?'))) return;
    setBusy(true);
    setError('');
    try {
      onChanged(await call<FollowUp>('deleteFollowUp', { projectId, followUpId: f.id }));
    } catch (err) {
      setError(errorText(t, err, {
        FORBIDDEN: t('Only the person who wrote it, the project lead or an admin can remove a follow-up.'),
        NOT_FOUND: t('This follow-up was already removed.'),
      }));
    } finally {
      setBusy(false);
    }
  };

  // Ctrl/Cmd+Enter adds; a plain Enter in the date box must not submit the task form around it.
  const onNoteKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add(); }
  };
  const onDateKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void add(); }
  };

  return (
    <section className="fu" aria-labelledby="fu-title">
      <div className="fu-head">
        <BellRing style={{ width: 16, height: 16 }} aria-hidden="true" />
        <h3 id="fu-title">{t('Follow-ups')}</h3>
        {list.length > 0 && <span className="fu-count ltr-data">{list.length}</span>}
        {pending && state && (
          <span className={`fu-due ${state}`}>
            <CalendarClock style={{ width: 13, height: 13 }} aria-hidden="true" />
            {state === 'overdue' ? t('Follow-up overdue since {{date}}', { date: shortDate(pending, lang) })
              : state === 'today' ? t('Follow up today')
              : t('Next follow-up {{date}}', { date: shortDate(pending, lang) })}
          </span>
        )}
      </div>

      {canAdd && (
        <div className="fu-add">
          <label className="sr-only" htmlFor="fu-note">{t('What was done or agreed')}</label>
          <textarea
            id="fu-note" className="input" dir="auto" rows={2} maxLength={MAX_FOLLOWUP} value={note}
            placeholder={t('What was done or agreed, e.g. "Called the supplier, quote by Thursday"')}
            onChange={(e) => setNote(e.target.value)} onKeyDown={onNoteKey} disabled={busy} style={{ resize: 'vertical' }}
          />
          <div className="fu-add-row">
            <label className="fu-next" htmlFor="fu-date">
              <span>{t('Next follow-up (optional)')}</span>
              <input
                id="fu-date" type="date" className="input" dir="ltr" value={nextDate} min={today}
                onChange={(e) => setNextDate(e.target.value)} onKeyDown={onDateKey} disabled={busy}
              />
            </label>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void add()} disabled={busy || !note.trim()}>
              {busy ? t('Saving…') : t('Add follow-up')}
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 8 }}>{error}</p>}

      {list.length === 0
        ? <p className="fu-empty">{canAdd ? t('No follow-ups yet. Note each call, visit or reminder here with the day to chase next.') : t('No follow-ups yet.')}</p>
        : (
          <ol className="fu-list">
            {list.map((f, i) => (
              <li key={f.id} className="fu-item">
                <div className="fu-meta">
                  <bdi className="fu-who">{displayName(f.authorEmail, people)}</bdi>
                  <span className="text-muted" title={new Date(f.createdAt).toLocaleString()}>{timeAgo(f.createdAt, lang)}</span>
                  {f.nextDate && (
                    <span className={`fu-chip${i === 0 && state ? ` ${state}` : ''}`}>
                      {t('Next: {{date}}', { date: shortDate(f.nextDate, lang) })}
                    </span>
                  )}
                  {canAdd && (canManage || f.authorEmail.toLowerCase() === myEmail) && (
                    <button
                      type="button" className="btn btn-ghost btn-icon btn-sm fu-del" onClick={() => void remove(f)} disabled={busy}
                      aria-label={t('Remove this follow-up')} title={t('Remove this follow-up')}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
                <p className="fu-note" dir="auto">{f.note}</p>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
