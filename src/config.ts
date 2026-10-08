/**
 * Build-time settings. Both are public values baked into the page, so they are
 * GitHub repo *variables*, never secrets (see .env.example).
 */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').trim();
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();

/** True once both halves of the Google setup are filled in. */
export const isConfigured = API_URL !== '' && GOOGLE_CLIENT_ID !== '';
