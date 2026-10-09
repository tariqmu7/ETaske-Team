/**
 * Google Identity Services ("Sign in with Google"). Google hands the page an
 * ID token; the Apps Script checks it on every call (docs/DESIGN.md §2).
 */

interface CredentialResponse { credential?: string }

export interface GoogleId {
  initialize(config: {
    client_id: string;
    callback: (r: CredentialResponse) => void;
    auto_select?: boolean;
    use_fedcm_for_prompt?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  prompt(): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window { google?: { accounts?: { id?: GoogleId } } }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

let loading: Promise<GoogleId> | null = null;
let initialisedFor = '';
let onCredential: ((idToken: string) => void) | null = null;

function loadScript(): Promise<GoogleId> {
  const ready = window.google?.accounts?.id;
  if (ready) return Promise.resolve(ready);
  if (!loading) {
    loading = new Promise<GoogleId>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = () => {
        const id = window.google?.accounts?.id;
        if (id) resolve(id); else reject(new Error('Google sign-in did not start.'));
      };
      s.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      document.head.appendChild(s);
    }).catch((err) => {
      loading = null; // let a later retry load it again
      document.querySelectorAll(`script[src="${SCRIPT_URL}"]`).forEach((el) => el.remove());
      throw err;
    });
  }
  return loading;
}

/**
 * Loads the library and initialises it once. Every new token (button click,
 * One Tap, silent refresh) goes to the latest `handler`; callers that only
 * need the library (to draw the button) leave it out.
 */
export async function startGoogle(clientId: string, handler?: (idToken: string) => void): Promise<GoogleId> {
  if (handler) onCredential = handler;
  const id = await loadScript();
  if (initialisedFor !== clientId) {
    id.initialize({
      client_id: clientId,
      callback: (r) => { if (r.credential) onCredential?.(r.credential); },
      // Returning users get a fresh token without a click, which is also how
      // the hourly token is renewed while the app stays open.
      auto_select: true,
      use_fedcm_for_prompt: true,
      itp_support: true,
    });
    initialisedFor = clientId;
  }
  return id;
}

/** Stops the silent sign-in, so "Sign out" really signs out. */
export function stopAutoSignIn() {
  window.google?.accounts?.id?.disableAutoSelect();
}
