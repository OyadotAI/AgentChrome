'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { login as apiLogin, signup as apiSignup, getProfile, refreshToken as apiRefreshToken } from '@/lib/api';

interface User {
  id: string;
  email: string;
  display_name?: string;
  role?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
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

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('oya_token');
    localStorage.removeItem('oya_refresh_token');
    localStorage.removeItem('oya_api_key');
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  // Refresh the access token using the refresh token
  const doRefresh = useCallback(async (): Promise<string | null> => {
    const rt = localStorage.getItem('oya_refresh_token');
    if (!rt) return null;
    try {
      const data = await apiRefreshToken(rt);
      const newToken = data.access_token;
      const newRefresh = data.refresh_token;
      setToken(newToken);
      localStorage.setItem('oya_token', newToken);
      if (newRefresh) localStorage.setItem('oya_refresh_token', newRefresh);
      if (data.user) setUser(data.user);
      return newToken;
    } catch {
      clearSession();
      return null;
    }
  }, [clearSession]);

  // Schedule token refresh 60s before expiry
  const scheduleRefresh = useCallback((tok: string) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const exp = getTokenExpiry(tok);
    if (!exp) return;
    const msUntilRefresh = (exp - 60) * 1000 - Date.now();
    if (msUntilRefresh <= 0) {
      // Already close to expiry, refresh now
      doRefresh();
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      doRefresh().then((newToken) => {
        if (newToken) scheduleRefresh(newToken);
      });
    }, msUntilRefresh);
  }, [doRefresh]);

  // Restore session on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('oya_token');
    if (!savedToken) {
      setLoading(false);
      return;
    }

    // Check if expired — try refresh
    const exp = getTokenExpiry(savedToken);
    const isExpired = exp ? Date.now() / 1000 > exp - 30 : false;

    if (isExpired) {
      // Token expired, try refresh
      doRefresh().then((newToken) => {
        if (newToken) {
          scheduleRefresh(newToken);
          getProfile(newToken)
            .then((profile) => setUser(profile))
            .catch(() => clearSession())
            .finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      });
      return;
    }

    // Token is still valid
    setToken(savedToken);
    scheduleRefresh(savedToken);
    getProfile(savedToken)
      .then((profile) => {
        if (profile && typeof profile === 'object') {
          setUser(profile);
        } else {
          throw new Error('Invalid profile');
        }
      })
      .catch(() => clearSession())
      .finally(() => setLoading(false));
  }, [clearSession, doRefresh, scheduleRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    setToken(data.access_token);
    localStorage.setItem('oya_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('oya_refresh_token', data.refresh_token);
    setUser(data.user);
    scheduleRefresh(data.access_token);
  }, [scheduleRefresh]);

  const signup = useCallback(async (email: string, password: string, displayName?: string) => {
    await apiSignup(email, password, displayName);
    await login(email, password);
  }, [login]);

  const logout = useCallback(() => {
    clearSession();
  }, [clearSession]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
