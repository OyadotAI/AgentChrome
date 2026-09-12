const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

/** API deployment, which can differ from the UI origin during development. */
export function apiOrigin(): string {
  const url = new URL(API_URL, typeof window === 'undefined' ? 'http://localhost:3100' : window.location.origin);
  return url.origin;
}

export function authHeaders(token: string): HeadersInit {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export function apiKeyHeaders(apiKey: string): HeadersInit {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// Auth API calls
export async function login(email: string, password: string) {
  const res = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Login failed');
  }
  return res.json();
}

export async function signup(email: string, password: string, displayName?: string) {
  const res = await fetch(apiUrl('/auth/signup'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Signup failed');
  }
  return res.json();
}

/**
 * With no argument this refreshes from the httpOnly cookie the server set at
 * login. The explicit token is the fallback for a console served from a
 * different origin than the API, where SameSite=Lax keeps the cookie at home.
 */
export async function refreshToken(refreshToken?: string) {
  const res = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Refresh failed');
  }
  return res.json();
}

export async function logout() {
  await fetch(apiUrl('/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => {});
}

export async function updateProfile(token: string, displayName: string) {
  const res = await fetch(apiUrl('/auth/me'), {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify({ display_name: displayName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Could not save your profile');
  }
  return res.json();
}

export async function getProfile(token: string) {
  const res = await fetch(apiUrl('/auth/me'), {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to fetch profile');
  const data = await res.json();
  if (!data || typeof data !== 'object') throw new Error('Invalid profile response');
  return data;
}

export async function listApiKeys(token: string) {
  const res = await fetch(apiUrl('/auth/keys'), {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to list keys');
  const data = await res.json();
  return data ?? [];
}

export async function createApiKey(token: string, label?: string) {
  const res = await fetch(apiUrl('/auth/keys'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not create the project');
  }
  return res.json();
}

export async function importApiKey(token: string, key: string, label?: string) {
  const res = await fetch(apiUrl('/auth/keys/import'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ key, label }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to import key');
  }
  return res.json();
}

export async function deleteApiKey(token: string, key: string) {
  // A key is arbitrary user input (importApiKey takes whatever is pasted), so
  // an unencoded one containing ../ sends this DELETE — with the user's own
  // bearer token — to a path they did not choose.
  const res = await fetch(apiUrl(`/auth/keys/${encodeURIComponent(key)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to delete key');
  return res.json();
}

/**
 * The credential the console drives the API with.
 *
 * sessionStorage, never localStorage: this is either a one-hour project
 * credential or — for the key-only sign-in, where there is no account to mint
 * one against — the API key itself. Either way it is an administrator
 * credential for a browser fleet, and a tab is as long as it should outlive
 * the person looking at it.
 */
export const CONSOLE_KEY = 'oya_console_key';

export function consoleCredential(): string {
  try {
    return sessionStorage.getItem('oya_project_credential') || sessionStorage.getItem(CONSOLE_KEY) || '';
  } catch { return ''; }
}
