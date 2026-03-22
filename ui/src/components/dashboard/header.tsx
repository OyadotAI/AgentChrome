'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Radio, Key, Plus, Trash2, ChevronDown, Settings, LogOut,
  User, Eye, EyeOff, Loader2, Check, Copy
} from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { apiUrl, authHeaders, listApiKeys, createApiKey, deleteApiKey } from '@/lib/api';
import { useToast } from './toast';

interface ApiKeyEntry {
  key: string;
  label?: string;
  created_at?: string;
}

interface HeaderProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  onOpenSettings: () => void;
}

export default function Header({ apiKey, setApiKey, onOpenSettings }: HeaderProps) {
  const { user, token, logout } = useAuth();
  const toast = useToast();

  const [healthStatus, setHealthStatus] = useState('connecting...');
  const [healthOk, setHealthOk] = useState(false);
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [showKeyDropdown, setShowKeyDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const keyDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Fetch health
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch(apiUrl('/health'));
        if (!res.ok) throw new Error();
        const data = await res.json();
        setHealthStatus(data.status === 'ok' ? 'healthy' : data.status);
        setHealthOk(data.status === 'ok');
      } catch {
        setHealthStatus('offline');
        setHealthOk(false);
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch keys from API
  const loadKeys = useCallback(async () => {
    if (!token) { console.log('[header] loadKeys: no token'); return []; }
    console.log('[header] loadKeys: fetching with token', token.slice(0, 20) + '...');
    try {
      const data = await listApiKeys(token);
      console.log('[header] loadKeys: got', data);
      const keyList: ApiKeyEntry[] = Array.isArray(data) ? data : Array.isArray(data?.keys) ? data.keys : [];
      setKeys(keyList);
      console.log('[header] loadKeys: set', keyList.length, 'keys');
      return keyList;
    } catch (err) {
      console.warn('[header] Failed to load API keys:', err);
      return [];
    }
  }, [token]);

  // Load keys on mount, auto-select if needed
  useEffect(() => {
    loadKeys().then((keyList) => {
      if (!keyList || keyList.length === 0) return;
      const currentKey = localStorage.getItem('oya_api_key');
      if (currentKey && keyList.find(k => k.key === currentKey)) {
        setApiKey(currentKey);
      } else {
        setApiKey(keyList[0].key);
        localStorage.setItem('oya_api_key', keyList[0].key);
      }
    });
  }, [loadKeys, setApiKey]);

  // Click outside handlers
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (keyDropdownRef.current && !keyDropdownRef.current.contains(e.target as Node)) {
        setShowKeyDropdown(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [showLabelInput, setShowLabelInput] = useState(false);

  const handleCreateKey = async () => {
    if (!token) return;
    if (!showLabelInput) {
      setShowLabelInput(true);
      return;
    }
    setCreatingKey(true);
    try {
      const data = await createApiKey(token, newKeyLabel.trim() || undefined);
      await loadKeys();
      if (data.key) {
        setApiKey(data.key);
        localStorage.setItem('oya_api_key', data.key);
        navigator.clipboard.writeText(data.key).catch(() => {});
        toast('Key created & copied to clipboard', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create key', 'error');
    } finally {
      setCreatingKey(false);
      setShowLabelInput(false);
      setNewKeyLabel('');
    }
  };

  const handleDeleteKey = async (key: string) => {
    if (!token) return;
    try {
      await deleteApiKey(token, key);
      toast('Key deleted', 'success');
      if (apiKey === key) {
        setApiKey('');
        localStorage.removeItem('oya_api_key');
      }
      await loadKeys();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete key', 'error');
    }
  };

  const handleSelectKey = (key: string) => {
    setApiKey(key);
    localStorage.setItem('oya_api_key', key);
    setShowKeyDropdown(false);
    toast('API key selected', 'info');
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const selectedKeyLabel = keys.find(k => k.key === apiKey)?.label || (apiKey ? `${apiKey.slice(0, 8)}...` : 'Select key');

  return (
    <header className="flex items-center gap-3 px-4 lg:px-6 h-14 bg-bg border-b border-border">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-1">
        <div className="w-2 h-2 rounded-full bg-accent" />
        <span className="text-sm font-semibold text-text tracking-tight hidden sm:block">Oya</span>
      </div>

      {/* Health */}
      <div
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
          healthOk
            ? 'bg-accent/10 text-accent'
            : 'bg-red-500/10 text-red-400'
        }`}
      >
        <span className={`w-2 h-2 rounded-full mr-1.5 ${healthOk ? 'bg-accent' : 'bg-red-400'}`} />
        <span className="hidden sm:inline">{healthStatus}</span>
      </div>

      <div className="flex-1" />

      {/* API Key Selector */}
      <div className="relative" ref={keyDropdownRef}>
        <button
          onClick={() => setShowKeyDropdown(!showKeyDropdown)}
          className="flex items-center gap-1.5 hover:bg-white/5 border border-border rounded-md px-3 py-2 text-sm text-text-muted hover:text-text transition-colors"
        >
          <Key className="w-3.5 h-3.5 shrink-0" />
          <span className="max-w-[100px] truncate hidden sm:inline font-mono text-xs">{selectedKeyLabel}</span>
          <ChevronDown className="w-3.5 h-3.5 text-text-dim" />
        </button>

        {showKeyDropdown && (
          <div className="absolute right-0 top-full mt-1.5 w-72 rounded-lg border border-border bg-bg-card shadow-xl shadow-black/40 z-50 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border">
              <span className="text-xs font-medium text-text-dim uppercase tracking-wider">API Keys</span>
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {keys.length === 0 && (
                <div className="px-3 py-6 text-center text-text-dim text-xs">
                  No API keys yet
                </div>
              )}
              {keys.map(k => (
                <div
                  key={k.key}
                  className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors group ${
                    apiKey === k.key
                      ? 'bg-white/10 text-text'
                      : 'hover:bg-white/5'
                  }`}
                  onClick={() => handleSelectKey(k.key)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text truncate">{k.label && k.label !== 'Default' ? k.label : `Key ${k.key.slice(0, 8)}`}</div>
                    <div className="text-xs text-text-dim font-mono truncate">{k.key.slice(0, 16)}...</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCopyKey(k.key); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/5 rounded transition-colors"
                    title="Copy key"
                  >
                    {copiedKey === k.key ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5 text-text-dim" />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteKey(k.key); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded transition-colors"
                    title="Delete key"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-border">
              {showLabelInput && (
                <input
                  type="text"
                  autoFocus
                  placeholder="Key name (e.g. cursor, claude)"
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateKey(); if (e.key === 'Escape') { setShowLabelInput(false); setNewKeyLabel(''); } }}
                  className="w-full h-9 mb-2 rounded-md border border-border bg-transparent px-3 text-sm text-text placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-accent/50"
                />
              )}
              <button
                onClick={handleCreateKey}
                disabled={creatingKey}
                className="w-full flex items-center justify-center gap-1.5 h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {creatingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {showLabelInput ? 'Create' : 'Create New Key'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="p-2 hover:bg-white/5 rounded-md text-text-dim hover:text-text transition-colors"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {/* User Menu */}
      <div className="relative" ref={userMenuRef}>
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center p-1 hover:bg-white/5 rounded-md transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-500/10 flex items-center justify-center">
            <User className="w-4 h-4 text-indigo-400" />
          </div>
        </button>

        {showUserMenu && (
          <div className="absolute right-0 top-full mt-1.5 w-52 rounded-lg border border-border bg-bg-card shadow-xl shadow-black/40 z-50 overflow-hidden">
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-sm font-medium text-text">{user?.display_name || user?.email || 'User'}</div>
              <div className="text-xs text-text-dim">{user?.email}</div>
            </div>
            <div className="p-1">
              <button
                onClick={() => { logout(); setShowUserMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
