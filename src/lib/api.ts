import { API_URL } from '../config';

/** Server codes (apps-script/Code.gs) plus NETWORK for a request that never got an answer. */
export type ApiCode =
  | 'BAD_REQUEST' | 'UNAUTHENTICATED' | 'PENDING' | 'BLOCKED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'NOT_APPROVED' | 'BUSY' | 'INTERNAL' | 'NETWORK';

export class ApiError extends Error {
  readonly code: ApiCode;
  constructor(code: ApiCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * One call to the web app. The body is `text/plain` JSON on purpose: a JSON
 * content type triggers a CORS pre-flight, which Apps Script cannot answer.
 * `action` and `idToken` are written last so `args` can never override them.
 */
export async function callApi<T>(action: string, idToken: string, args: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...args, action, idToken }),
    });
  } catch {
    throw new ApiError('NETWORK', 'The server could not be reached.');
  }

  let body: { ok?: boolean; data?: T; error?: string; code?: ApiCode } | null = null;
  try {
    body = await res.json();
  } catch {
    // e.g. a Google login page instead of JSON when the web app is not deployed for "Anyone"
    throw new ApiError('INTERNAL', `Unexpected reply from the server (HTTP ${res.status}).`);
  }
  if (body && body.ok === true) return body.data as T;
  throw new ApiError(body?.code ?? 'INTERNAL', body?.error ?? 'The request failed.');
}
