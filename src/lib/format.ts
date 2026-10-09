import type { Language } from '../i18n';

/** Latin digits in Arabic too (same rule as ETaske). */
export function localeFor(lang: Language): string {
  return lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60],
  ['hour', 60 * 60],
  ['day', 24 * 60 * 60],
];

/** "5 minutes ago" / "قبل 5 دقائق"; a plain date after a week. */
export function timeAgo(iso: string, lang: Language, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(localeFor(lang), { numeric: 'auto' });
  if (abs < 60) return rtf.format(0, 'second');
  if (abs < 7 * 24 * 60 * 60) {
    let unit = UNITS[0];
    for (const u of UNITS) if (abs >= u[1]) unit = u;
    return rtf.format(Math.round(seconds / unit[1]), unit[0]);
  }
  return new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
}

/** Two letters for an avatar placeholder. */
export function initials(name: string, email: string): string {
  const words = (name || email.split('@')[0] || '?').trim().split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** "14:05" in the reader's language (Latin digits). */
export function clockTime(iso: string, lang: Language): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat(localeFor(lang), { hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** The local calendar day of a time, YYYY-MM-DD. */
export function localDay(iso: string | number): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A chat day heading: "Today", "Yesterday", or the date. `today`/`yesterday` come translated. */
export function dayLabel(iso: string, lang: Language, words: { today: string; yesterday: string }, now = Date.now()): string {
  const day = localDay(iso);
  if (day === localDay(now)) return words.today;
  if (day === localDay(now - 24 * 60 * 60 * 1000)) return words.yesterday;
  return new Intl.DateTimeFormat(localeFor(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(Date.parse(iso));
}

/** "Ahmed Ali" from a member, else the part of the e-mail before @. */
export function displayName(email: string, people: Map<string, { name: string }>): string {
  return people.get(email.toLowerCase())?.name || email.split('@')[0] || email;
}

/** A calendar day (YYYY-MM-DD) as "12 Oct", with the year only when it is not this year. */
export function shortDate(ymd: string, lang: Language, now = Date.now()): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(localeFor(lang), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(date);
}
