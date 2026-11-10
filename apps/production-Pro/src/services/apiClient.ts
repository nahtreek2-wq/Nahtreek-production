import {runtimeConfig} from '../config/runtime';
import {useSessionStore} from '../stores/session';
import type {ProfessionalUser} from '../stores/session';
import {localPreviewRequest} from './localPreviewApi';

export class ApiError extends Error {
  constructor(public status: number, message: string, public kind?: 'timeout' | 'network') {
    super(message);
  }
}

type SessionResponse = {accessToken: string; refreshToken: string; user: ProfessionalUser};
let refreshPromise: Promise<boolean> | null = null;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function base64UrlToBytes(input: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let value = 0;
  let output = '';
  for (const char of normalized) {
    if (char === '=') {break;}
    const index = alphabet.indexOf(char);
    if (index < 0) {throw new Error('invalid token encoding');}
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((value >>> bits) & 0xff);
    }
  }
  return output;
}

export function getAccessTokenExpiry(token: string): number | null {
  try {
    const match = /"exp"\s*:\s*(\d+)/.exec(base64UrlToBytes(token.split('.')[1] ?? ''));
    return match ? Number(match[1]) * 1000 : null;
  } catch {
    return null;
  }
}

export async function ensureFreshSession(): Promise<boolean> {
  const base = runtimeConfig.apiBaseUrl;
  const session = useSessionStore.getState();
  if (!base || !session.accessToken || !session.refreshToken || !session.user) {
    return true;
  }
  const expiry = getAccessTokenExpiry(session.accessToken);
  if (expiry === null || expiry - Date.now() > REFRESH_SKEW_MS) {
    return true;
  }
  try {
    if (!refreshPromise) {refreshPromise = refreshSession().finally(() => {refreshPromise = null;});}
    return await refreshPromise;
  } catch {
    return Boolean(useSessionStore.getState().accessToken);
  }
}

function messageFor(status: number): string {
  if (status === 401) return 'Your sign-in has expired. Please sign in again.';
  if (status === 403) return 'This action is not available for your account.';
  if (status === 404) return 'This item is no longer available.';
  if (status === 409) return 'This action was already completed or the item has changed. Refresh and try again.';
  if (status === 429) return 'Please wait a moment before trying again.';
  if (status === 503 || status === 504) return 'The service is temporarily unavailable. Your work is safe. Check your jobs before repeating this action.';
  if (status === 400 || status === 422) return 'Please check your details and try again.';
  return 'We could not complete this action right now. Please try again.';
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const auth = /\/auth\/(professionals\/register|email-otp\/request|password-reset\/email\/confirm)$/.test(url)
    ? 45_000
    : /\/auth\/(login|professionals\/login|refresh)$/.test(url) ? 35_000 : undefined;
  const timeout = setTimeout(() => controller.abort(), auth ?? (init.method && init.method !== 'GET' ? 25_000 : 12_000));
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } catch {
    throw new ApiError(0, controller.signal.aborted
      ? 'The connection took longer than usual. Please try again.'
      : 'Could not connect. Check your internet connection and try again.', controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshSession(): Promise<boolean> {
  const base = runtimeConfig.apiBaseUrl;
  const session = useSessionStore.getState();
  if (!base || !session.refreshToken || !session.user) {return false;}
  const response = await timedFetch(base + '/auth/refresh', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({refreshToken: session.refreshToken}),
  });
  const body = await response.json().catch(() => undefined) as SessionResponse | {message?: string} | undefined;
  if (useSessionStore.getState().sessionEpoch !== session.sessionEpoch) return false;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {session.clear();}
    const message = body && 'message' in body ? body.message : undefined;
    throw new ApiError(response.status, message || messageFor(response.status));
  }
  const next = body as SessionResponse;
  if (!next?.accessToken || !next.refreshToken || next.user?.id !== session.user.id || !next.user.roles.some(role => role === 'ENGINEER' || role === 'SERVICE_PROVIDER')) {
    session.clear();
    throw new ApiError(502, 'Your professional sign-in could not be restored.');
  }
  useSessionStore.getState().setSession(next);
  return true;
}

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const base = runtimeConfig.apiBaseUrl;
  if (!base) {return localPreviewRequest<T>(path, init);}
  const session = useSessionStore.getState();
  try {
    const response = await timedFetch(base + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(session.accessToken ? {Authorization: `Bearer ${session.accessToken}`} : {}),
        ...init.headers,
      },
    });
    const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (session.accessToken && useSessionStore.getState().user?.id !== session.user?.id) {
      throw new ApiError(401, 'Please sign in to continue.');
    }
    if (response.status === 401 && session.accessToken && !path.startsWith('/auth/')) {
      if (retried) {
        useSessionStore.getState().clear();
      } else {
        if (useSessionStore.getState().accessToken !== session.accessToken) {return request<T>(path, init, true);}
        if (!refreshPromise) {refreshPromise = refreshSession().finally(() => {refreshPromise = null;});}
        if (await refreshPromise) {return request<T>(path, init, true);}
      }
    }
    if (!response.ok) {
      const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
      const safeDetail = [400, 401, 409, 422].includes(response.status) &&
        typeof message === 'string' && message.length <= 500;
      throw new ApiError(response.status, safeDetail ? message : messageFor(response.status));
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) {throw error;}
    throw new ApiError(0, 'Could not connect. Check your internet connection and try again.', 'network');
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, {method: 'POST', body: JSON.stringify(data ?? {})}),
  put: <T>(path: string, data?: unknown) => request<T>(path, {method: 'PUT', body: JSON.stringify(data ?? {})}),
  patch: <T>(path: string, data?: unknown) => request<T>(path, {method: 'PATCH', body: JSON.stringify(data ?? {})}),
  delete: <T>(path: string, payload?: unknown) => request<T>(path, payload === undefined ? {method: 'DELETE'} : {method: 'DELETE', body: JSON.stringify(payload)}),
};
