/**
 * The Google ID token lives in sessionStorage: it survives a reload, dies with
 * the tab, and is only valid for about an hour anyway.
 */
const KEY = 'etaske-team-idtoken';
/** Treat a token as gone a minute early, so a call never leaves with one that expires on the way. */
const MARGIN_MS = 60 * 1000;

/** Expiry time (ms) from the token's `exp` claim; 0 if it cannot be read. */
export function tokenExpiry(token: string): number {
  try {
    const part = token.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = Number(JSON.parse(json).exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export function isTokenFresh(token: string | null): token is string {
  return !!token && tokenExpiry(token) - MARGIN_MS > Date.now();
}

export function readToken(): string | null {
  try {
    const t = sessionStorage.getItem(KEY);
    return isTokenFresh(t) ? t : null;
  } catch {
    return null;
  }
}

export function saveToken(token: string) {
  try { sessionStorage.setItem(KEY, token); } catch { /* storage off: the token still works for this page */ }
}

export function clearToken() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ }
}
