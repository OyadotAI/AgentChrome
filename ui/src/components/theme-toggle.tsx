'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

const subscribe = (callback: () => void) => {
  window.addEventListener('oya-theme', callback);
  return () => window.removeEventListener('oya-theme', callback);
};
const snapshot = () => document.documentElement.dataset.theme === 'light';

export default function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, snapshot, () => false);
  return <button className="btn-icon" aria-label={`Switch to ${light ? 'dark' : 'light'} theme`} title={`Switch to ${light ? 'dark' : 'light'} theme`} onClick={() => {
    const theme = light ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('oya_theme', theme); } catch { /* private mode */ }
    window.dispatchEvent(new Event('oya-theme'));
  }}>{light ? <Sun size={16} /> : <Moon size={16} />}</button>;
}
