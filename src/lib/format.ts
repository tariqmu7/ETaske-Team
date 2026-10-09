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
