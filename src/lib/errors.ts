import type { TFunction } from 'i18next';
import { ApiError, type ApiCode } from './api';

/**
 * Turns any failure into a sentence in the reader's language. The server's own
 * messages are English, so the app words them by code; a screen can override a
 * code where it knows more (e.g. CONFLICT on a project name).
 */
export function errorText(t: TFunction, err: unknown, overrides: Partial<Record<ApiCode, string>> = {}): string {
  const code: ApiCode = err instanceof ApiError ? err.code : 'INTERNAL';
  if (overrides[code]) return overrides[code];
  switch (code) {
    case 'NETWORK': return t('Could not reach the server. Check your connection and try again.');
    case 'BUSY': return t('The server is busy. Please try again in a moment.');
    case 'UNAUTHENTICATED': return t('Your sign-in has expired. Please sign in again.');
    case 'PENDING': return t('Your account is waiting for admin approval.');
    case 'BLOCKED': return t('Your account has been blocked.');
    case 'FORBIDDEN': return t('You are not allowed to do this.');
    case 'NOT_FOUND': return t('This item no longer exists.');
    case 'BAD_REQUEST': return t('Some of the details are not valid.');
    default: return t('Something went wrong on the server. Please try again.');
  }
}
