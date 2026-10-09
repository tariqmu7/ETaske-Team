import type { ReactNode } from 'react';

const URL_RE = /https?:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]}'"،؛؟]+$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Props {
  text: string;
  /** "@Name" → e-mail for the people this message mentions. */
  mentionNames: { name: string; email: string }[];
  myEmail: string;
}

/** Message text with links made clickable and @mentions highlighted (mine stronger). */
export function MessageText({ text, mentionNames, myEmail }: Props) {
  const names = mentionNames.filter((m) => m.name).sort((a, b) => b.name.length - a.name.length);
  const parts: ReactNode[] = [];
  const pattern = new RegExp(
    [URL_RE.source, ...names.map((m) => '@' + escapeRe(m.name))].join('|'),
    'g',
  );

  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    let token = match[0];
    if (start > last) parts.push(text.slice(last, start));
    if (token.startsWith('@')) {
      const who = names.find((m) => '@' + m.name === token);
      const mine = who?.email === myEmail;
      parts.push(<span key={key++} className={`chat-mention${mine ? ' chat-mention-me' : ''}`} title={who?.email}>{token}</span>);
    } else {
      const trail = token.match(TRAILING)?.[0] ?? '';
      if (trail) token = token.slice(0, -trail.length);
      parts.push(<a key={key++} href={token} target="_blank" rel="noopener noreferrer" className="chat-link" dir="ltr">{token}</a>);
      if (trail) parts.push(trail);
    }
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <>{parts}</>;
}
