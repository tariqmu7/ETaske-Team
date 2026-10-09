import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertCircle, ArrowDown, ClipboardList, ClipboardPlus, Copy, FileText, Loader2, MoreHorizontal, Pencil, Reply, RotateCcw, Trash2 } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { Composer, type Draft } from '../components/Composer';
import { MessageText } from '../components/MessageText';
import { TaskModal, type TaskSeed } from '../components/TaskModal';
import { useLanguage } from '../hooks/useLanguage';
import type { Session } from '../hooks/useSession';
import type { useProjectSync } from '../hooks/useProjectSync';
import { errorText } from '../lib/errors';
import { ChatImage, FileChip } from '../components/FileViews';
import { MAX_FILE_BYTES, shrinkImage, toBase64 } from '../lib/files';
import { MAX_TASK_TITLE, taskStatusLabel } from '../lib/tasks';
import { clockTime, dayLabel, displayName, localDay } from '../lib/format';
import type { FileItem, Member, Message, Task, TaskEvent, User } from '../types';

/** Messages from one person this close together share one name + avatar. */
const GROUP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 120;

type Sync = ReturnType<typeof useProjectSync>;

interface Outgoing {
  localId: string;
  text: string;
  mentions: string[];
  replyToId: string;
  files: File[];
  createdAt: string;
  status: 'sending' | 'failed';
  /** "Uploading 2 of 3" while files go up. */
  progress: { done: number; total: number } | null;
  error: string;
}

class TooBig extends Error {}

/** A task line, worded in the reader's language from the event data. */
function eventLines(t: TFunction, ev: TaskEvent, nameOf: (email: string) => string): string[] {
  const lines: string[] = [];
  if (ev.type === 'taskCreated') {
    if (ev.parentSerial) lines.push(t('Follow-up of {{serial}}', { serial: ev.parentSerial }));
    if (ev.assigneeEmail) lines.push(t('Assigned to {{name}}', { name: nameOf(ev.assigneeEmail) }));
    if (ev.dueDate) lines.push(t('Due {{date}}', { date: ev.dueDate }));
    if (ev.status && ev.status !== 'todo') lines.push(t('Status: {{status}}', { status: taskStatusLabel(t, ev.status) }));
    return lines;
  }
  const c = ev.changes ?? {};
  if (ev.reachedStep) lines.push(t('Reached the milestone "{{name}}"', { name: ev.reachedStep }));
  if (c.status) lines.push(t('Status changed from {{from}} to {{to}}', { from: taskStatusLabel(t, c.status.from), to: taskStatusLabel(t, c.status.to) }));
  if (c.percent && !(c.status?.to === 'done' && c.percent.to === 100)) {
    lines.push(t('Progress changed from {{from}}% to {{to}}%', { from: c.percent.from, to: c.percent.to }));
  }
  if (c.assigneeEmail) {
    lines.push(c.assigneeEmail.to ? t('Assigned to {{name}}', { name: nameOf(c.assigneeEmail.to) }) : t('No longer assigned to anyone'));
  }
  return lines;
}

interface Props {
  projectId: string;
  me: User;
  call: Session['call'];
  sync: Sync;
  members: Member[];
  archived: boolean;
}

/** The project's group chat: messages, replies, @mentions, photos and files, task lines. */
export function ProjectChat({ projectId, me, call, sync, members, archived }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const { messages, files, loaded, lastReadAt, hasMoreMessages, loadingOlder, putMessage, putFile } = sync;
  const isAdmin = me.role === 'admin';
  const myEmail = me.email.toLowerCase();

  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [replyToId, setReplyToId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [menuFor, setMenuFor] = useState('');
  const [notice, setNotice] = useState('');
  const [newBelow, setNewBelow] = useState(0);
  const [flashId, setFlashId] = useState('');
  const [taskSeed, setTaskSeed] = useState<TaskSeed | null>(null);

  const people = useMemo(() => {
    const map = new Map<string, { name: string; photoUrl: string }>();
    for (const m of members) map.set(m.email.toLowerCase(), { name: m.name, photoUrl: m.photoUrl });
    if (!map.has(myEmail)) map.set(myEmail, { name: me.name, photoUrl: me.photoUrl });
    return map;
  }, [members, me, myEmail]);
  const nameOf = useCallback((email: string) => displayName(email, people), [people]);
  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const mentionable = useMemo(() => members.filter((m) => m.email.toLowerCase() !== myEmail && m.status !== 'blocked'), [members, myEmail]);

  // ── Scrolling ──
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const firstScrollDone = useRef(false);
  const lastSeenId = useRef('');
  const keepFromBottom = useRef<number | null>(null);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setNewBelow(0);
  }, []);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom.current) setNewBelow(0);
  };

  // An open message menu closes on a tap anywhere else (not on scroll: the list
  // nudges its own scroll when the menu opens under the last message).
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[id="msg-${menuFor}"]`)) setMenuFor('');
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuFor]);

  // The unread line sits before the first message from someone else after my last visit.
  const unreadFromId = useMemo(() => {
    if (!lastReadAt) return '';
    return messages.find((m) => m.createdAt > lastReadAt && m.authorEmail.toLowerCase() !== myEmail && !m.deleted)?.id ?? '';
  }, [messages, lastReadAt, myEmail]);

  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !loaded) return;
    const last = outbox.length ? outbox[outbox.length - 1].localId : messages[messages.length - 1]?.id ?? '';

    if (!firstScrollDone.current) {
      firstScrollDone.current = true;
      lastSeenId.current = last;
      const divider = unreadFromId ? document.getElementById('chat-unread') : null;
      if (divider) divider.scrollIntoView({ block: 'start' }); else el.scrollTop = el.scrollHeight;
      nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      return;
    }
    if (keepFromBottom.current !== null) {
      // Older messages were added on top: keep what the reader was looking at in place.
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    }
    if (last && last !== lastSeenId.current) {
      const newest = messages[messages.length - 1];
      const mineJustNow = outbox.length > 0 || (newest && newest.authorEmail.toLowerCase() === myEmail && newest.id === last);
      lastSeenId.current = last;
      if (nearBottom.current || mineJustNow) el.scrollTop = el.scrollHeight;
      else setNewBelow((n) => n + 1);
    }
  }, [messages, outbox, loaded, unreadFromId, myEmail]);

  const showOlder = async () => {
    const el = list.current;
    if (el) keepFromBottom.current = el.scrollHeight - el.scrollTop;
    try {
      await sync.loadOlder();
    } catch (err) {
      keepFromBottom.current = null;
      setNotice(errorText(t, err));
    }
  };

  // ── Read marks (drive the unread badge on the Projects screen) ──
  const newestId = messages[messages.length - 1]?.id ?? '';
  const markedId = useRef('');
  useEffect(() => {
    const mark = () => {
      if (!newestId || markedId.current === newestId || document.visibilityState !== 'visible') return;
      markedId.current = newestId;
      call('markRead', { projectId }).catch(() => { markedId.current = ''; });
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [newestId, call, projectId]);

  // ── Sending (one at a time, in order) ──
  const queue = useRef<Promise<void>>(Promise.resolve());
  const uploaded = useRef(new Map<string, (FileItem | null)[]>());
  const patch = (localId: string, change: Partial<Outgoing>) => setOutbox((list) => list.map((o) => (o.localId === localId ? { ...o, ...change } : o)));

  const deliver = useCallback(async (o: Outgoing) => {
    const done = uploaded.current.get(o.localId) ?? o.files.map(() => null);
    uploaded.current.set(o.localId, done);
    try {
      for (let i = 0; i < o.files.length; i++) {
        if (done[i]) continue;
        patch(o.localId, { progress: { done: i, total: o.files.length } });
        const file = await shrinkImage(o.files[i]);
        if (file.size > MAX_FILE_BYTES) throw new TooBig(file.name);
        const item = await call<FileItem>('uploadFile', {
          projectId, name: file.name || 'file', mimeType: file.type || 'application/octet-stream', data: await toBase64(file),
        });
        done[i] = item;
        putFile(item);
      }
      patch(o.localId, { progress: null });
      const msg = await call<Message>('postMessage', {
        projectId, text: o.text, mentions: o.mentions, replyToId: o.replyToId || undefined,
        fileIds: done.map((f) => f?.id).filter(Boolean),
      });
      putMessage(msg);
      uploaded.current.delete(o.localId);
      setOutbox((list) => list.filter((x) => x.localId !== o.localId));
      void sync.sync();
    } catch (err) {
      const error = err instanceof TooBig
        ? t('{{name}} is too big. The limit is 15 MB per file.', { name: err.message })
        : errorText(t, err, { NOT_FOUND: t('The message you replied to was deleted.') });
      patch(o.localId, { status: 'failed', progress: null, error });
    }
  }, [call, projectId, putFile, putMessage, sync, t]);

  const enqueue = (o: Outgoing) => { queue.current = queue.current.then(() => deliver(o)); };

  const send = (d: Draft) => {
    const o: Outgoing = {
      localId: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: d.text, mentions: d.mentions, replyToId, files: d.files,
      createdAt: new Date().toISOString(), status: 'sending', progress: null, error: '',
    };
    setReplyToId('');
    setOutbox((list) => [...list, o]);
    enqueue(o);
  };

  const retry = (o: Outgoing) => {
    const again = { ...o, status: 'sending' as const, error: '' };
    patch(o.localId, again);
    enqueue(again);
  };

  const discard = (o: Outgoing) => {
    uploaded.current.delete(o.localId);
    setOutbox((list) => list.filter((x) => x.localId !== o.localId));
  };

  // ── Message actions ──
  const editing = editingId ? messageById.get(editingId) ?? null : null;
  const replyTo = replyToId ? messageById.get(replyToId) ?? null : null;

  const saveEdit = async (text: string, mentions: string[]) => {
    if (!editing) return;
    try {
      putMessage(await call<Message>('editMessage', { projectId, messageId: editing.id, text, mentions }));
      setEditingId('');
    } catch (err) {
      throw new Error(errorText(t, err, { NOT_FOUND: t('This message was deleted.') }));
    }
  };

  const remove = async (m: Message) => {
    setMenuFor('');
    if (!window.confirm(t('Delete this message for everyone?'))) return;
    try {
      putMessage(await call<Message>('deleteMessage', { projectId, messageId: m.id }));
      if (editingId === m.id) setEditingId('');
      if (replyToId === m.id) setReplyToId('');
    } catch (err) {
      setNotice(errorText(t, err));
    }
  };

  const copy = (m: Message) => {
    setMenuFor('');
    navigator.clipboard?.writeText(m.text).catch(() => { /* nothing to copy to */ });
  };

  /** "Make it a task": the first line becomes the title, the whole message the details. */
  const makeTask = (m: Message) => {
    setMenuFor('');
    const text = m.text.trim();
    const firstLine = text.split('\n')[0].trim();
    const title = firstLine.length > MAX_TASK_TITLE ? `${firstLine.slice(0, MAX_TASK_TITLE - 1)}…` : firstLine;
    const mentioned = m.mentions.map((e) => e.toLowerCase()).filter((e) => mentionable.some((p) => p.email.toLowerCase() === e));
    setTaskSeed({
      title,
      details: text === firstLine ? '' : text,
      assigneeEmail: mentioned.length === 1 ? mentioned[0] : '',
      fromMessageId: m.id,
    });
  };

  const onTaskCreated = (task: Task) => {
    sync.putTask(task);
    setTaskSeed(null);
    void sync.sync();   // brings the "created a task" line, posted as a reply to the message
  };

  const jumpTo = (id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(id);
    window.setTimeout(() => setFlashId((f) => (f === id ? '' : f)), 1600);
  };

  const snippet = (m: Message) => {
    if (m.deleted) return t('This message was deleted.');
    if (m.kind === 'event' && m.event) return `${m.event.serial} · ${m.event.title}`;
    if (m.text) return m.text.slice(0, 140);
    return m.fileIds.length > 0 ? t('Photo or file') : '';
  };

  // ── Rendering ──
  const words = { today: t('Today'), yesterday: t('Yesterday') };

  const renderFiles = (ids: string[], local?: File[]) => {
    if (local?.length) {
      return (
        <div className="chat-files">
          {local.map((f, i) => (
            <span key={i} className="chat-file-chip"><FileText style={{ width: 16, height: 16, flexShrink: 0 }} /><span className="text-truncate" dir="auto">{f.name}</span></span>
          ))}
        </div>
      );
    }
    if (!ids.length) return null;
    const items = ids.map((id) => fileById.get(id) ?? null);
    const images = items.filter((f): f is FileItem => !!f && !!f.thumbnailUrl);
    const others = items.filter((f) => !f || !f.thumbnailUrl);
    return (
      <>
        {images.length > 0 && (
          <div className={`chat-images${images.length === 1 ? ' single' : ''}`}>
            {images.map((f) => <ChatImage key={f.id} file={f} />)}
          </div>
        )}
        {others.length > 0 && (
          <div className="chat-files">
            {others.map((f, i) => (f ? <FileChip key={f.id} file={f} /> : <span key={`missing-${i}`} className="chat-file-chip text-muted"><FileText style={{ width: 16, height: 16 }} />{t('Photo or file')}</span>))}
          </div>
        )}
      </>
    );
  };

  const rows: ReactNode[] = [];
  let prev: Message | null = null;
  let lastDay = '';
  for (const m of messages) {
    if (m.kind === 'event' && m.deleted) continue;
    const day = localDay(m.createdAt);
    if (day !== lastDay) {
      rows.push(<div key={`day-${day}`} className="chat-day"><span>{dayLabel(m.createdAt, lang, words)}</span></div>);
      lastDay = day;
      prev = null;
    }
    if (m.id === unreadFromId) {
      rows.push(<div key="unread" id="chat-unread" className="chat-unread"><span>{t('New messages')}</span></div>);
      prev = null;
    }

    const author = m.authorEmail.toLowerCase();
    const mine = author === myEmail;

    if (m.kind === 'event') {
      const ev = m.event;
      rows.push(
        <div key={m.id} id={`msg-${m.id}`} className={`chat-event${flashId === m.id ? ' flash' : ''}`}>
          <ClipboardList style={{ width: 16, height: 16, flexShrink: 0, color: 'var(--accent)' }} />
          <div style={{ minWidth: 0 }}>
            <div>
              <bdi style={{ fontWeight: 700 }}>{nameOf(author)}</bdi>{' '}
              {ev?.type === 'taskCreated' ? t('created a task') : t('updated a task')}
              <span className="chat-time">{clockTime(m.createdAt, lang)}</span>
            </div>
            {ev && <div className="chat-event-task"><span className="ltr-data" style={{ fontWeight: 700 }}>{ev.serial}</span> · <bdi>{ev.title}</bdi></div>}
            {ev && eventLines(t, ev, nameOf).map((line, i) => <div key={i} className="chat-event-line">{line}</div>)}
            {!ev && <div className="chat-event-line">{t('Task line could not be read.')}</div>}
          </div>
        </div>,
      );
      prev = null;
      continue;
    }

    const grouped = !!prev && prev.authorEmail.toLowerCase() === author && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_MS;
    const quoted = m.replyToId ? messageById.get(m.replyToId) : undefined;
    const mentionNames = m.mentions.map((email) => ({ email: email.toLowerCase(), name: people.get(email.toLowerCase())?.name ?? '' }));
    const mentionsMe = !mine && m.mentions.some((e) => e.toLowerCase() === myEmail);
    const canEdit = mine && !m.deleted && !archived;
    const canDelete = (mine || isAdmin) && !m.deleted;
    const person = people.get(author);

    rows.push(
      <div key={m.id} id={`msg-${m.id}`} className={`chat-msg${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${flashId === m.id ? ' flash' : ''}`}>
        {!mine && (
          <div className="chat-avatar">{!grouped && <Avatar name={person?.name ?? ''} email={author} photoUrl={person?.photoUrl} size={32} />}</div>
        )}
        <div className="chat-msg-body">
          {!mine && !grouped && <div className="chat-author"><bdi>{nameOf(author)}</bdi></div>}
          <div className={`chat-bubble${mentionsMe ? ' mentions-me' : ''}${m.deleted ? ' deleted' : ''}`}>
            {quoted && !m.deleted && (
              <button type="button" className="chat-quote" onClick={() => jumpTo(quoted.id)}>
                <bdi className="chat-quote-name">{nameOf(quoted.authorEmail)}</bdi>
                <span className="chat-quote-text" dir="auto">{snippet(quoted)}</span>
              </button>
            )}
            {m.replyToId && !quoted && !m.deleted && <div className="chat-quote chat-quote-missing">{t('Reply to an earlier message')}</div>}
            {m.deleted ? (
              <span className="chat-text">{t('This message was deleted.')}</span>
            ) : (
              <>
                {renderFiles(m.fileIds)}
                {m.text && <div className="chat-text" dir="auto"><MessageText text={m.text} mentionNames={mentionNames} myEmail={myEmail} /></div>}
              </>
            )}
            <div className="chat-meta">
              {m.editedAt && !m.deleted && <span>{t('edited')}</span>}
              <span>{clockTime(m.createdAt, lang)}</span>
            </div>
          </div>
          {menuFor === m.id && !m.deleted && (
            <div className="chat-actions" role="menu">
              {!archived && <button type="button" role="menuitem" onClick={() => { setReplyToId(m.id); setEditingId(''); setMenuFor(''); }}><Reply />{t('Reply')}</button>}
              {m.text && <button type="button" role="menuitem" onClick={() => copy(m)}><Copy />{t('Copy')}</button>}
              {!archived && m.text.trim() && <button type="button" role="menuitem" onClick={() => makeTask(m)}><ClipboardPlus />{t('Make it a task')}</button>}
              {canEdit && <button type="button" role="menuitem" onClick={() => { setEditingId(m.id); setReplyToId(''); setMenuFor(''); }}><Pencil />{t('Edit')}</button>}
              {canDelete && <button type="button" role="menuitem" className="danger" onClick={() => void remove(m)}><Trash2 />{t('Delete')}</button>}
            </div>
          )}
        </div>
        {!m.deleted && (
          <button
            type="button"
            className="chat-more"
            onClick={() => setMenuFor((id) => (id === m.id ? '' : m.id))}
            aria-label={t('Message options')}
            aria-expanded={menuFor === m.id}
          >
            <MoreHorizontal style={{ width: 16, height: 16 }} />
          </button>
        )}
      </div>,
    );
    prev = m;
  }

  for (const o of outbox) {
    const quoted = o.replyToId ? messageById.get(o.replyToId) : undefined;
    rows.push(
      <div key={o.localId} className="chat-msg mine">
        <div className="chat-msg-body">
          <div className={`chat-bubble pending${o.status === 'failed' ? ' failed' : ''}`}>
            {quoted && <div className="chat-quote"><bdi className="chat-quote-name">{nameOf(quoted.authorEmail)}</bdi><span className="chat-quote-text" dir="auto">{snippet(quoted)}</span></div>}
            {renderFiles([], o.files)}
            {o.text && <div className="chat-text" dir="auto">{o.text}</div>}
            <div className="chat-meta">
              {o.status === 'sending' && (
                <>
                  <Loader2 style={{ width: 12, height: 12, animation: 'spin 0.8s linear infinite' }} />
                  <span>{o.progress ? t('Uploading {{done}} of {{total}}…', { done: o.progress.done + 1, total: o.progress.total }) : t('Sending…')}</span>
                </>
              )}
              {o.status === 'failed' && <><AlertCircle style={{ width: 12, height: 12 }} /><span>{t('Not sent')}</span></>}
            </div>
          </div>
          {o.status === 'failed' && (
            <div className="chat-failed" role="alert">
              <span>{o.error}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => retry(o)}><RotateCcw style={{ width: 14, height: 14 }} />{t('Try again')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => discard(o)}>{t('Remove')}</button>
            </div>
          )}
        </div>
      </div>,
    );
  }

  return (
    <div className="chat">
      <div ref={list} className="chat-list" onScroll={onScroll} aria-live="polite" aria-relevant="additions">
        {!loaded && (
          <div className="chat-loading" aria-busy="true">
            <div className="spinner" />
            <span className="text-muted">{t('Loading the chat…')}</span>
          </div>
        )}
        {loaded && hasMoreMessages && (
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void showOlder()} disabled={loadingOlder}>
              {loadingOlder ? t('Loading…') : t('Show older messages')}
            </button>
          </div>
        )}
        {loaded && messages.length === 0 && outbox.length === 0 && (
          <div className="empty-state" style={{ margin: 'auto 0' }}>
            <div className="empty-state-title">{t('No messages yet')}</div>
            <div className="empty-state-sub">{t('Say hello to the team, share a photo from site, or type @ to mention someone.')}</div>
          </div>
        )}
        {rows}
      </div>

      {newBelow > 0 && (
        <button type="button" className="chat-new-below" onClick={() => scrollToBottom(true)}>
          <ArrowDown style={{ width: 15, height: 15 }} />{t('New messages: {{count}}', { count: newBelow })}
        </button>
      )}

      {notice && (
        <div role="alert" className="chat-notice">
          <span style={{ flex: 1 }}>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice('')}>{t('Close')}</button>
        </div>
      )}

      <Composer
        people={mentionable}
        disabledReason={archived ? t('This project is archived. The chat is read-only.') : undefined}
        replyTo={replyTo ? { name: nameOf(replyTo.authorEmail), snippet: snippet(replyTo) } : null}
        onCancelReply={() => setReplyToId('')}
        editing={editing ? { text: editing.text, mentions: editing.mentions } : null}
        onCancelEdit={() => setEditingId('')}
        onSaveEdit={saveEdit}
        onSend={send}
      />

      {taskSeed && (
        <TaskModal
          projectId={projectId}
          call={call}
          members={members.filter((p) => p.status !== 'blocked')}
          people={people}
          task={null}
          seed={taskSeed}
          categories={sync.categories}
          onCategoryAdded={sync.putCategory}
          canEdit
          onSaved={onTaskCreated}
          onClose={() => setTaskSeed(null)}
        />
      )}
    </div>
  );
}
