import { useCallback, useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID, isConfigured } from '../config';
import { ApiError, callApi } from '../lib/api';
import { startGoogle, stopAutoSignIn } from '../lib/google';
import { clearToken, isTokenFresh, readToken, saveToken, tokenExpiry } from '../lib/token';
import type { User } from '../types';

/**
 * signedOut → (Google token) → checking → ready (user known; the app then
 * branches on user.status) or failed (server unreachable — retry).
 */
export type SessionPhase = 'signedOut' | 'checking' | 'ready' | 'failed';

/** Ask Google for a fresh token this long before the old one runs out. */
const REFRESH_BEFORE_MS = 5 * 60 * 1000;

export function useSession() {
  const tokenRef = useRef<string | null>(readToken());
  const [token, setToken] = useState<string | null>(tokenRef.current);
  const [user, setUser] = useState<User | null>(null);
  const [phase, setPhase] = useState<SessionPhase>(tokenRef.current ? 'checking' : 'signedOut');
  const [failure, setFailure] = useState<unknown>(null);
  const [expired, setExpired] = useState(false);
  const [googleFailed, setGoogleFailed] = useState(false);

  const dropSession = useCallback((becauseExpired: boolean) => {
    clearToken();
    tokenRef.current = null;
    setToken(null);
    setUser(null);
    setExpired(becauseExpired);
    setPhase('signedOut');
  }, []);

  const acceptToken = useCallback((idToken: string) => {
    saveToken(idToken);
    tokenRef.current = idToken;
    setToken(idToken);
    setExpired(false);
  }, []);

  const loadMe = useCallback(async () => {
    const t = tokenRef.current;
    if (!isTokenFresh(t)) { dropSession(!!t); return; }
    try {
      const me = await callApi<User>('me', t);
      if (tokenRef.current !== t) return; // signed out / switched meanwhile
      setUser(me);
      setPhase('ready');
    } catch (err) {
      if (tokenRef.current !== t) return;
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') { dropSession(true); return; }
      setFailure(err);
      setPhase((p) => (p === 'ready' ? p : 'failed'));
    }
  }, [dropSession]);

  // Load Google once. A returning user with no token is signed in silently if Google allows it.
  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    startGoogle(GOOGLE_CLIENT_ID, acceptToken)
      .then((id) => { if (alive && !tokenRef.current) id.prompt(); })
      .catch(() => { if (alive) setGoogleFailed(true); });
    return () => { alive = false; };
  }, [acceptToken]);

  // A token with no user yet = a fresh sign-in (or a reload): ask the server who this is.
  useEffect(() => {
    if (!token || user) return;
    setPhase('checking');
    void loadMe();
  }, [token, user, loadMe]);

  // Renew the token quietly before it runs out; if Google cannot, the next call signs out.
  useEffect(() => {
    if (!token) return;
    const wait = Math.max(10_000, tokenExpiry(token) - REFRESH_BEFORE_MS - Date.now());
    const timer = window.setTimeout(() => {
      startGoogle(GOOGLE_CLIENT_ID, acceptToken).then((id) => id.prompt()).catch(() => { /* handled on next call */ });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [token, acceptToken]);

  /** Calls the API as the signed-in user. Expiry signs out; a status change re-reads `me`. */
  const call = useCallback(async <T,>(action: string, args?: Record<string, unknown>): Promise<T> => {
    const t = tokenRef.current;
    if (!isTokenFresh(t)) {
      dropSession(true);
      throw new ApiError('UNAUTHENTICATED', 'Your sign-in has expired.');
    }
    try {
      return await callApi<T>(action, t, args);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'UNAUTHENTICATED') dropSession(true);
        else if (err.code === 'PENDING' || err.code === 'BLOCKED' || err.code === 'FORBIDDEN') void loadMe();
      }
      throw err;
    }
  }, [dropSession, loadMe]);

  const signOut = useCallback(() => {
    stopAutoSignIn();
    dropSession(false);
  }, [dropSession]);

  const retryGoogle = useCallback(() => {
    setGoogleFailed(false);
    startGoogle(GOOGLE_CLIENT_ID, acceptToken).catch(() => setGoogleFailed(true));
  }, [acceptToken]);

  return { phase, user, failure, expired, googleFailed, call, refreshMe: loadMe, signOut, retryGoogle };
}

export type Session = ReturnType<typeof useSession>;
