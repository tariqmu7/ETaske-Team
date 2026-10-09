import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Paperclip, Pencil, Reply, SendHorizontal, X } from 'lucide-react';
import { MAX_FILE_BYTES, formatSize, isImageType } from '../lib/files';
import type { Member } from '../types';
import { Avatar } from './Avatar';

const MAX_TEXT = 4000;      // same as apps-script/Code.gs
const MAX_FILES = 10;
const MAX_ROWS_PX = 160;

export interface Draft {
  text: string;
  mentions: string[];
  files: File[];
}

interface Props {
  /** Project members I can @mention (not me). */
  people: Member[];
  /** When set, the box is greyed out with this reason (e.g. an archived project). */
  disabledReason?: string;
  replyTo: { name: string; snippet: string } | null;
  onCancelReply: () => void;
  /** Editing one of my messages: the box holds its text and saves instead of sending. */
  editing: { text: string; mentions: string[] } | null;
  onCancelEdit: () => void;
  onSaveEdit: (text: string, mentions: string[]) => Promise<void>;
  onSend: (draft: Draft) => void;
}

interface Picker { start: number; query: string; index: number }

/** Mentions whose "@Name" is still in the text. */
function keptMentions(text: string, picked: Map<string, string>): string[] {
  const out: string[] = [];
  picked.forEach((name, email) => { if (text.includes('@' + name)) out.push(email); });
  return out;
}

/** Phones send on the button; Enter there is a new line. */
const touchFirst = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

export function Composer({ people, disabledReason, replyTo, onCancelReply, editing, onCancelEdit, onSaveEdit, onSend }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const picked = useRef(new Map<string, string>()); // e-mail → name inserted as "@name"
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const previews = useMemo(() => files.map((f) => (isImageType(f.type) ? URL.createObjectURL(f) : '')), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  // Entering / leaving edit mode swaps the box's text.
  useEffect(() => {
    picked.current = new Map();
    if (editing) {
      for (const email of editing.mentions) {
        const p = people.find((m) => m.email === email);
        if (p?.name) picked.current.set(email, p.name);
      }
      setText(editing.text);
      setFiles([]);
      box.current?.focus();
    } else {
      setText('');
    }
    setError('');
    // `people` is read once on entry on purpose; a poll must not reset the box.
  }, [editing]);

  useEffect(() => { if (replyTo) box.current?.focus(); }, [replyTo]);

  // Grow with the text up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_ROWS_PX) + 'px';
  }, [text]);

  const matches = useMemo(() => {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    return people
      .filter((p) => !q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q) || p.email.startsWith(q))
      .slice(0, 6);
  }, [picker, people]);

  const readPicker = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,30})$/);
    setPicker(m ? { start: caret - m[2].length - 1, query: m[2], index: 0 } : null);
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setError('');
    readPicker(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const choose = (p: Member) => {
    if (!picker) return;
    const name = p.name || p.email.split('@')[0];
    const caret = box.current?.selectionStart ?? text.length;
    const next = text.slice(0, picker.start) + '@' + name + ' ' + text.slice(caret);
    picked.current.set(p.email, name);
    setText(next);
    setPicker(null);
    const pos = picker.start + name.length + 2;
    requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(pos, pos); });
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const chosen = [...list];
    const tooBig = chosen.filter((f) => f.size > MAX_FILE_BYTES && !isImageType(f.type));
    const ok = chosen.filter((f) => !tooBig.includes(f));
    if (tooBig.length) setError(t('{{name}} is too big. The limit is 15 MB per file.', { name: tooBig[0].name }));
    setFiles((cur) => {
      const all = [...cur, ...ok];
      if (all.length > MAX_FILES) setError(t('You can attach up to {{count}} files to one message.', { count: MAX_FILES }));
      return all.slice(0, MAX_FILES);
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async () => {
    const clean = text.trim();
    if (saving) return;
    if (editing) {
      if (!clean) { setError(t('Write something, or delete the message instead.')); return; }
      setSaving(true);
      try {
        await onSaveEdit(clean, keptMentions(clean, picked.current));
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : t('Something went wrong on the server. Please try again.'));
      } finally {
        setSaving(false);
      }
      return;
    }
    if (!clean && !files.length) return;
    onSend({ text: clean, mentions: keptMentions(clean, picked.current), files });
    picked.current = new Map();
    setText('');
    setFiles([]);
    setPicker(null);
    setError('');
    box.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (picker && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setPicker({ ...picker, index: (picker.index + step + matches.length) % matches.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[picker.index]); return; }
    }
    if (e.key === 'Escape') {
      if (picker) setPicker(null);
      else if (editing) onCancelEdit();
      else if (replyTo) onCancelReply();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !touchFirst()) {
      e.preventDefault();
      void submit();
    }
  };

  if (disabledReason) {
    return <div className="chat-composer chat-composer-off" role="status">{disabledReason}</div>;
  }

  const canSend = !!text.trim() || (!editing && files.length > 0);

  return (
    <div className="chat-composer">
      {(replyTo || editing) && (
        <div className="chat-composer-context">
          {editing ? <Pencil style={{ width: 15, height: 15 }} /> : <Reply style={{ width: 15, height: 15 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="chat-composer-context-title">
              {editing ? t('Editing your message') : <>{t('Replying to')} <bdi>{replyTo?.name}</bdi></>}
            </div>
            {replyTo && !editing && <div className="text-truncate" dir="auto" style={{ textAlign: 'start' }}>{replyTo.snippet}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={editing ? onCancelEdit : onCancelReply} aria-label={t('Cancel')}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="chat-attachments" aria-label={t('Attached files')}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="chat-attachment">
              {previews[i] ? <img src={previews[i]} alt="" /> : <FileText style={{ width: 22, height: 22 }} />}
              <span className="chat-attachment-name" dir="auto">{f.name}</span>
              <span className="chat-attachment-size" dir="ltr">{formatSize(f.size)}</span>
              <button type="button" className="chat-attachment-remove" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={t('Remove {{name}}', { name: f.name })}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="text-danger" style={{ fontSize: 12, padding: '0 4px 6px' }}>{error}</p>}

      <div className="chat-composer-row">
        {!editing && (
          <>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => fileInput.current?.click()} title={t('Attach photos or files')} aria-label={t('Attach photos or files')}>
              <Paperclip style={{ width: 19, height: 19 }} />
            </button>
          </>
        )}
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          {picker && matches.length > 0 && (
            <ul className="chat-mention-picker" role="listbox" aria-label={t('Mention someone')}>
              {matches.map((p, i) => (
                <li
                  key={p.email}
                  role="option"
                  aria-selected={i === picker.index}
                  className={i === picker.index ? 'active' : undefined}
                  onMouseDown={(e) => { e.preventDefault(); choose(p); }}
                >
                  <Avatar name={p.name} email={p.email} photoUrl={p.photoUrl} size={26} />
                  <span style={{ minWidth: 0 }}>
                    <bdi className="text-truncate" style={{ display: 'block', fontWeight: 600 }}>{p.name || p.email}</bdi>
                    <span className="ltr-data text-truncate" style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{p.email}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={box}
            className="input chat-input"
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onClick={(e) => readPicker(text, e.currentTarget.selectionStart ?? text.length)}
            onBlur={() => setPicker(null)}
            onPaste={(e) => { if (!editing && e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files); } }}
            placeholder={t('Write a message… type @ to mention someone')}
            aria-label={t('Message')}
            maxLength={MAX_TEXT}
            rows={1}
            dir="auto"
          />
        </div>
        <button
          type="button"
          className="btn btn-primary btn-icon chat-send"
          onClick={() => void submit()}
          disabled={!canSend || saving}
          title={editing ? t('Save') : t('Send')}
          aria-label={editing ? t('Save') : t('Send')}
        >
          <SendHorizontal className="dir-arrow" style={{ width: 18, height: 18 }} />
        </button>
      </div>
    </div>
  );
}
