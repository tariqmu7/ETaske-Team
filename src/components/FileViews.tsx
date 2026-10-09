import { useState } from 'react';
import { FileText } from 'lucide-react';
import { formatSize, isImageType } from '../lib/files';
import type { FileItem } from '../types';

/** A photo through Drive's thumbnail; falls back to a file chip if Google will not show it. */
export function ChatImage({ file }: { file: FileItem }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <FileChip file={file} />;
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="chat-image" title={file.name}>
      <img src={file.thumbnailUrl} alt={file.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </a>
  );
}

export function FileChip({ file }: { file: FileItem }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer" className="chat-file-chip">
      <FileText style={{ width: 16, height: 16, flexShrink: 0 }} />
      <span className="text-truncate" dir="auto">{file.name}</span>
      <span className="chat-file-size" dir="ltr">{isImageType(file.mimeType) ? '' : formatSize(file.size)}</span>
    </a>
  );
}
