import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import type { Session } from '../hooks/useSession';
import { MAX_CATEGORY, categoryHue, liveCategories } from '../lib/categories';
import { errorText } from '../lib/errors';
import type { Category, Task } from '../types';

interface Props {
  projectId: string;
  call: Session['call'];
  categories: Category[];
  tasks: Task[];
  /** Lead or admin: may rename and remove. Everyone else may only add. */
  canManage: boolean;
  onChanged: (c: Category) => void;
  onClose: () => void;
}

/** The project's category list: add for everyone; rename / remove for the lead or an admin. */
export function CategoriesModal({ projectId, call, categories, tasks, canManage, onChanged, onClose }: Props) {
  const { t } = useTranslation();
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const live = liveCategories(categories);
  const used = (id: string) => tasks.filter((x) => x.categoryId === id).length;

  const run = async (action: string, args: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      onChanged(await call<Category>(action, { projectId, ...args }));
      after?.();
    } catch (err) {
      setError(errorText(t, err, {
        CONFLICT: t('There is already a category with that name.'),
        FORBIDDEN: t('Only the project lead or an admin can rename or remove a category.'),
      }));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    void run('addCategory', { name }, () => setNewName(''));
  };

  const rename = (c: Category) => {
    const name = editName.trim();
    if (!name || name === c.name) { setEditId(null); return; }
    void run('editCategory', { categoryId: c.id, name }, () => setEditId(null));
  };

  const remove = (c: Category) => {
    const n = used(c.id);
    const msg = n
      ? t('Remove "{{name}}"? It is used by {{count}} tasks; they will show no category.', { name: c.name, count: n })
      : t('Remove "{{name}}"?', { name: c.name });
    if (window.confirm(msg)) void run('editCategory', { categoryId: c.id, deleted: true });
  };

  return createPortal(
    <div className="modal-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal task-modal" role="dialog" aria-modal="true" aria-labelledby="cat-modal-title" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h2 id="cat-modal-title" style={{ flex: 1, fontSize: 18, fontWeight: 800 }}>{t('Task categories')}</h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} disabled={busy} aria-label={t('Close')}><X style={{ width: 16, height: 16 }} /></button>
        </div>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>
          {canManage
            ? t('The list everyone in this project picks from. Add what is missing, fix a name, or remove one nobody needs.')
            : t('The list everyone in this project picks from. Add what is missing; the project lead can rename or remove.')}
        </p>

        <form className="cat-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input
            className="input" dir="auto" value={newName} maxLength={MAX_CATEGORY} disabled={busy}
            placeholder={t('New category name')} aria-label={t('New category name')}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>
            <Plus style={{ width: 15, height: 15 }} />{t('Add')}
          </button>
        </form>

        {error && <p role="alert" className="text-danger" style={{ fontSize: 13, marginTop: 8 }}>{error}</p>}

        {live.length === 0 ? (
          <div className="cat-empty"><Tag style={{ width: 18, height: 18 }} />{t('No categories yet.')}</div>
        ) : (
          <ul className="cat-list">
            {live.map((c) => (
              <li key={c.id} className="cat-item">
                <span className="cat-dot" style={{ background: `hsl(${categoryHue(c.id)} 65% 50%)` }} aria-hidden="true" />
                {editId === c.id ? (
                  <>
                    <input
                      className="input" dir="auto" value={editName} maxLength={MAX_CATEGORY} autoFocus disabled={busy}
                      aria-label={t('Category name')}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); rename(c); }
                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditId(null); }
                      }}
                    />
                    <button type="button" className="btn btn-primary btn-icon btn-sm" onClick={() => rename(c)} disabled={busy} aria-label={t('Save')}><Check style={{ width: 15, height: 15 }} /></button>
                    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditId(null)} disabled={busy} aria-label={t('Cancel')}><X style={{ width: 15, height: 15 }} /></button>
                  </>
                ) : (
                  <>
                    <bdi className="cat-name">{c.name}</bdi>
                    <span className="cat-count">{t('Tasks: {{count}}', { count: used(c.id) })}</span>
                    {canManage && (
                      <>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} aria-label={t('Rename {{name}}', { name: c.name })}
                          onClick={() => { setEditId(c.id); setEditName(c.name); setError(''); }}>
                          <Pencil style={{ width: 14, height: 14 }} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={busy} aria-label={t('Remove {{name}}', { name: c.name })} onClick={() => remove(c)}>
                          <Trash2 style={{ width: 14, height: 14 }} />
                        </button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
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
