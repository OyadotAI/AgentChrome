const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
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

export async function refreshToken(refreshToken: string) {
  const res = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Refresh failed');
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
  if (!res.ok) throw new Error('Failed to create key');
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
  const res = await fetch(apiUrl(`/auth/keys/${key}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error('Failed to delete key');
  return res.json();
}
