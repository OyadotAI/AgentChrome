'use client';

import { useEffect, useState } from 'react';
import { LogOut, Loader2 } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import { useAuth } from '@/components/auth-provider';
import { updateProfile } from '@/lib/api';

/**
 * Your account: who you are signed in as, and the one thing you can change.
 *
 * Email is the login and role is an authority grant, so both are shown but
 * neither is editable — a form that could raise its own role would be a
 * privilege escalation with a text input in front of it.
 */
export default function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, token, logout, applyProfile } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Reopening should show what is stored now, not what was typed and abandoned.
  useEffect(() => {
    if (open) { setName(user?.display_name || ''); setError(''); setSaved(false); }
  }, [open, user?.display_name]);

  const dirty = name.trim() !== (user?.display_name || '').trim();

  const save = async () => {
    if (!token || !dirty || !name.trim()) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      applyProfile(await updateProfile(token, name.trim()));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <Dialog open={open} onClose={onClose} title="Your account" size="sm">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-muted">Display name</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setSaved(false); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
            maxLength={100}
            placeholder="Your name"
            className="h-9 rounded-md border border-border bg-bg px-3 text-sm text-text outline-none focus:border-accent"
          />
        </label>

        <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-elevated/40 p-3">
          <Row label="Email" value={user?.email || '—'} />
          <Row label="Role" value={user?.role || 'member'} />
          {memberSince && <Row label="Member since" value={memberSince} />}
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {saved && !error && <p className="text-xs text-emerald-400">Saved.</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => { logout(); onClose(); }}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
          <button
            onClick={() => void save()}
            disabled={!dirty || saving || !name.trim()}
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors disabled:cursor-default disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-text-dim">{label}</span>
      <span className="truncate text-xs text-text">{value}</span>
    </div>
  );
}
