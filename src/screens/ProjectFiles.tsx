import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, FileText, FolderOpen, Images } from 'lucide-react';
import { useLanguage } from '../hooks/useLanguage';
import type { useProjectSync } from '../hooks/useProjectSync';
import { clockTime, dayLabel, displayName, localDay } from '../lib/format';
import { formatSize, isImageType } from '../lib/files';
import type { FileItem } from '../types';

type Sync = ReturnType<typeof useProjectSync>;
type Kind = 'all' | 'photos' | 'documents';

interface Props {
  sync: Sync;
  people: Map<string, { name: string; photoUrl: string }>;
  /** The project's Drive folder, '' while unknown. */
  folderId: string;
}

interface Day { key: string; label: string; photos: FileItem[]; documents: FileItem[] }

/** Every photo and file sent in the project, newest first, grouped by day. */
export function ProjectFiles({ sync, people, folderId }: Props) {
  const { t } = useTranslation();
  const { lang } = useLanguage();
  const [kind, setKind] = useState<Kind>('all');

  // A file whose chat message was deleted goes with it (the copy stays in Drive).
  const files = useMemo(() => {
    const deleted = new Set(sync.messages.filter((m) => m.deleted).map((m) => m.id));
    return sync.files.filter((f) => !(f.messageId && deleted.has(f.messageId)));
  }, [sync.files, sync.messages]);

  const photoCount = files.filter((f) => isImageType(f.mimeType)).length;
  const documentCount = files.length - photoCount;

  const days = useMemo(() => {
    const words = { today: t('Today'), yesterday: t('Yesterday') };
    const list: Day[] = [];
    const newest = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const f of newest) {
      const photo = isImageType(f.mimeType);
      if ((kind === 'photos' && !photo) || (kind === 'documents' && photo)) continue;
      const key = localDay(f.createdAt);
      let day = list[list.length - 1];
      if (!day || day.key !== key) { day = { key, label: dayLabel(f.createdAt, lang, words), photos: [], documents: [] }; list.push(day); }
      (photo ? day.photos : day.documents).push(f);
    }
    return list;
  }, [files, kind, lang, t]);

  const sentBy = (f: FileItem) => `${displayName(f.uploaderEmail, people)} · ${clockTime(f.createdAt, lang)}`;
  const where = (f: FileItem) => (f.updateId ? t('In a daily update') : f.messageId ? t('In the chat') : '');

  return (
    <div className="project-pane">
      <div className="pane-toolbar">
        <div className="pane-stats" aria-label={t('File summary')}>
          <span><strong>{photoCount}</strong> {t('photos')}</span>
          <span><strong>{documentCount}</strong> {t('files')}</span>
        </div>
        <div className="seg" role="group" aria-label={t('Show')}>
          {(['all', 'photos', 'documents'] as const).map((k) => (
            <button key={k} type="button" className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'all' ? t('All') : k === 'photos' ? t('Photos') : t('Documents')}
            </button>
          ))}
        </div>
        {folderId && (
          <a className="btn btn-ghost btn-sm" href={`https://drive.google.com/drive/folders/${folderId}`} target="_blank" rel="noopener noreferrer">
            <FolderOpen style={{ width: 15, height: 15 }} />{t('Open in Drive')}
          </a>
        )}
      </div>

      {!sync.loaded && (
        <div className="chat-loading" aria-busy="true" style={{ padding: 40 }}>
          <div className="spinner" /><span className="text-muted">{t('Loading…')}</span>
        </div>
      )}

      {sync.loaded && days.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><Images style={{ width: 28, height: 28 }} /></div>
          <div className="empty-state-title">
            {files.length === 0 ? t('No files yet') : kind === 'photos' ? t('No photos yet') : t('No documents yet')}
          </div>
          <div className="empty-state-sub">{t('Photos and files sent in the chat or in daily updates collect here.')}</div>
        </div>
      )}

      {days.map((day) => (
        <section key={day.key} className="files-day" aria-label={day.label}>
          <h2 className="update-day-head">{day.label}</h2>
          {day.photos.length > 0 && (
            <ul className="files-grid">
              {day.photos.map((f) => <li key={f.id}><PhotoTile file={f} caption={sentBy(f)} /></li>)}
            </ul>
          )}
          {day.documents.length > 0 && (
            <ul className="files-list">
              {day.documents.map((f) => (
                <li key={f.id}>
                  <a className="file-row" href={f.url} target="_blank" rel="noopener noreferrer">
                    <span className="file-row-icon" aria-hidden="true"><FileText style={{ width: 18, height: 18 }} /></span>
                    <span className="file-row-main">
                      <bdi className="file-row-name">{f.name}</bdi>
                      <span className="file-row-meta">
                        <bdi>{sentBy(f)}</bdi>
                        {where(f) && <span>· {where(f)}</span>}
                      </span>
                    </span>
                    <span className="file-row-size" dir="ltr">{formatSize(f.size)}</span>
                    <ExternalLink className="file-row-open" aria-hidden="true" style={{ width: 14, height: 14 }} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** A photo tile through Drive's thumbnail; if Google will not show it, the name instead. */
function PhotoTile({ file, caption }: { file: FileItem; caption: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <a className="file-tile" href={file.url} target="_blank" rel="noopener noreferrer" title={`${file.name}\n${caption}`}>
      {broken
        ? <span className="file-tile-broken"><Images style={{ width: 22, height: 22 }} /><bdi>{file.name}</bdi></span>
        : <img src={file.thumbnailUrl} alt={file.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
      <span className="file-tile-caption"><bdi>{caption}</bdi></span>
    </a>
  );
}
