'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { login as apiLogin, signup as apiSignup, getProfile } from '@/lib/api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem('oya_token');
      if (savedToken) {
        setToken(savedToken);
        getProfile(savedToken)
          .then((profile) => {
            if (profile && typeof profile === 'object') {
              setUser(profile);
            } else {
              throw new Error('Invalid profile');
            }
          })
          .catch(() => {
            localStorage.removeItem('oya_token');
            setToken(null);
          })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    const accessToken = data.access_token;
    setToken(accessToken);
    localStorage.setItem('oya_token', accessToken);
    setUser(data.user);
  }, []);

  const signup = useCallback(async (email: string, password: string, displayName?: string) => {
    await apiSignup(email, password, displayName);
    // After signup, automatically login
    await login(email, password);
  }, [login]);

  const logout = useCallback(() => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('oya_token');
    localStorage.removeItem('oya_api_key');
  }, []);

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
