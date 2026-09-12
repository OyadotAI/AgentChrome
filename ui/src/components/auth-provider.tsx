'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { login as apiLogin, signup as apiSignup, getProfile, refreshToken as apiRefreshToken, logout as apiLogout } from '@/lib/api';

interface User {
  id: string;
  email: string;
  display_name?: string;
  role?: string;
  created_at?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  /** Adopt a profile the server just returned, so the UI is not stale until reload. */
  applyProfile: (profile: User) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionVersion = useRef(0);

  const clearSession = useCallback(() => {
    sessionVersion.current++;
    setUser(null);
    setToken(null);
    localStorage.removeItem('oya_token');
    localStorage.removeItem('oya_refresh_token');
    localStorage.removeItem('oya_api_key');   // written by versions before this one
    sessionStorage.removeItem('oya_console_key');
    sessionStorage.removeItem('oya_project_credential');
    sessionStorage.removeItem('oya_project_id');
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  /**
   * Refresh from the httpOnly cookie the server set at login — nothing here
   * reads or writes a refresh token, which is the point: page JavaScript
   * cannot reach it, so an XSS cannot walk off with the session.
   *
   * The localStorage token is only the fallback for a console served from a
   * different origin than the API, where SameSite=Lax keeps the cookie at home
   * and the server returns the token in the body instead.
   */
  const doRefresh = useCallback(async (): Promise<string | null> => {
    const version = sessionVersion.current;
    const stored = localStorage.getItem('oya_refresh_token') || undefined;
    // `oya_session` is the readable half the server sets alongside the httpOnly
    // cookie. Without it there is nothing to refresh, and asking anyway puts a
    // failed request in the console of every anonymous page load.
    if (!stored && !document.cookie.split('; ').some(c => c.startsWith('oya_session='))) return null;
    try {
      const data = await apiRefreshToken(stored);
      if (version !== sessionVersion.current) return null;
      const newToken = data.access_token;
      setToken(newToken);
      // Only ever stored when the server could not use a cookie.
      if (data.refresh_token) localStorage.setItem('oya_refresh_token', data.refresh_token);
      else localStorage.removeItem('oya_refresh_token');
      if (data.user) setUser(data.user);
      return newToken;
    } catch {
      if (version === sessionVersion.current) clearSession();
      return null;
    }
  }, [clearSession]);

  // A renewed token schedules its own next refresh, including near-expiry tokens.
  useEffect(() => {
    if (!token) return;
    const exp = getTokenExpiry(token);
    if (!exp) return;
    refreshTimerRef.current = setTimeout(() => { void doRefresh(); }, Math.max(1000, (exp - 60) * 1000 - Date.now()));
    return () => { if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
  }, [token, doRefresh]);

  useEffect(() => {
    let cancelled = false;
    const version = sessionVersion.current;
    // The access token is never persisted — it is rebuilt from the refresh
    // cookie on every load, so a closed tab leaves nothing readable behind.
    const restore = async () => {
      const tok = await doRefresh();
      if (!tok) return;
      const profile = await getProfile(tok);
      if (!cancelled && version === sessionVersion.current) {
        setToken(tok);
        setUser(profile);
      }
    };
    restore()
      .catch(() => { if (!cancelled && version === sessionVersion.current) clearSession(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clearSession, doRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    sessionVersion.current++;
    setToken(data.access_token);
    if (data.refresh_token) localStorage.setItem('oya_refresh_token', data.refresh_token);
    setUser(data.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName?: string) => {
    await apiSignup(email, password, displayName);
    await login(email, password);
  }, [login]);

  const logout = useCallback(() => {
    clearSession();
    void apiLogout();   // the cookie is httpOnly; only the server can clear it
  }, [clearSession]);

  const applyProfile = useCallback((profile: User) => setUser(profile), []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout, applyProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
