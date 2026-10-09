import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import type { Session } from '../hooks/useSession';
import { MAX_CATEGORY, liveCategories } from '../lib/categories';
import { errorText } from '../lib/errors';
import type { Category } from '../types';

const ADD = '__add__';

interface Props {
  id: string;
  projectId: string;
  call: Session['call'];
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
  onAdded: (c: Category) => void;
  disabled?: boolean;
}

/**
 * The project's categories as a drop-down, with "Add a new category…" at the end.
 * Choosing it swaps the list for a small box; the new name is saved for the whole
 * project and picked at once.
 */
export function CategoryPicker({ id, projectId, call, categories, value, onChange, onAdded, disabled }: Props) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const live = liveCategories(categories);
  // A task may still name a category that was removed since; show it so the form tells the truth.
  const removed = value && !live.some((c) => c.id === value) ? categories.find((c) => c.id === value) : undefined;

  const save = async () => {
    const clean = name.trim();
    if (!clean) { setError(t('Write the category name.')); return; }
    setBusy(true);
    setError('');
    try {
      const c = await call<Category>('addCategory', { projectId, name: clean });
      onAdded(c);
      onChange(c.id);
      setAdding(false);
      setName('');
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (adding) {
    return (
      <div>
        <div className="cat-add">
          <input
            id={id} className="input" dir="auto" value={name} maxLength={MAX_CATEGORY} autoFocus disabled={busy}
            placeholder={t('New category name')} aria-invalid={!!error}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Enter must not submit the task form around it.
              if (e.key === 'Enter') { e.preventDefault(); void save(); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAdding(false); setError(''); }
            }}
          />
          <button type="button" className="btn btn-primary btn-icon" onClick={() => void save()} disabled={busy} aria-label={t('Add category')}>
            <Check style={{ width: 16, height: 16 }} />
          </button>
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => { setAdding(false); setError(''); }} disabled={busy} aria-label={t('Cancel')}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        {error && <p role="alert" className="text-danger" style={{ fontSize: 12, marginTop: 4 }}>{error}</p>}
      </div>
    );
  }

  return (
    <select
      id={id} className="input" value={value} disabled={disabled}
      onChange={(e) => {
        if (e.target.value === ADD) { setAdding(true); setName(''); return; }
        onChange(e.target.value);
      }}
    >
      <option value="">{t('No category')}</option>
      {live.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      {removed && <option value={removed.id}>{t('{{name}} (removed)', { name: removed.name })}</option>}
      {!disabled && <option value={ADD}>{t('+ Add a new category…')}</option>}
    </select>
  );
}
