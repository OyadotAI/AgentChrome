'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Eye, EyeOff, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiUrl, apiKeyHeaders } from '@/lib/api';
import { useToast } from './toast';

/** Prefer the server's own reason — /config is admin-gated, so "Admin key required" matters. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch { /* not JSON — fall through */ }
  return `${fallback} (${res.status})`;
}

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  apiKey: string;
}

export default function SettingsDialog({ open, onClose, apiKey }: SettingsDialogProps) {
  const toast = useToast();

  const [openaiKey, setOpenaiKey] = useState('');
  const [openaiKeyPlaceholder, setOpenaiKeyPlaceholder] = useState('sk-...');
  const [openaiKeyVisible, setOpenaiKeyVisible] = useState(false);
  const [chatModel, setChatModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const headers = useCallback(() => apiKeyHeaders(apiKey), [apiKey]);

  // Load settings
  useEffect(() => {
    if (!open || !apiKey) return;
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/config'), { headers: headers() });
        if (!res.ok) {
          toast(await errorMessage(res, 'Could not load settings'), 'error');
          return;
        }
        const cfg = await res.json();
        setOpenaiKeyPlaceholder(cfg.has_openai_key ? (cfg.openai_api_key || 'Configured') : 'sk-...');
        setChatModel(cfg.chat_model || '');
        setBaseUrl(cfg.openai_base_url || '');
      } catch { /* noop */ }
    };
    load();
  }, [open, apiKey, headers, toast]);

  const saveField = async (field: string, value: string) => {
    if (!value && field === 'openai_api_key') {
      toast('Enter a key first', 'error');
      return;
    }
    setSaving(field);
    try {
      const res = await fetch(apiUrl('/config'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        toast('Setting saved', 'success');
      } else {
        toast(await errorMessage(res, 'Failed to save'), 'error');
      }
    } catch {
      toast('Error saving setting', 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            onClick={onClose}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 flex items-center justify-center z-[101] p-4"
          >
            <div className="rounded-xl border border-border bg-bg-card shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div>
                  <h2 className="text-lg font-semibold text-text">Chat Settings</h2>
                  <p className="text-xs text-text-dim mt-0.5">Optional -- only needed for the Chat feature</p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-white/5 rounded-md text-text-dim hover:text-text transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-6 space-y-6">
                {/* OpenAI Key */}
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">OpenAI API Key</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={openaiKeyVisible ? 'text' : 'password'}
                        value={openaiKey}
                        onChange={e => setOpenaiKey(e.target.value)}
                        placeholder={openaiKeyPlaceholder}
                        className="h-9 w-full rounded-md border border-border bg-transparent px-3 pr-9 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setOpenaiKeyVisible(!openaiKeyVisible)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-dim hover:text-text transition-colors"
                      >
                        {openaiKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <button
                      onClick={() => saveField('openai_api_key', openaiKey.trim())}
                      disabled={saving === 'openai_api_key'}
                      className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30 flex items-center gap-2"
                    >
                      {saving === 'openai_api_key' && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>

                {/* Chat Model */}
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">Chat Model</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatModel}
                      onChange={e => setChatModel(e.target.value)}
                      placeholder="gpt-4o-mini"
                      className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                    />
                    <button
                      onClick={() => saveField('chat_model', chatModel.trim())}
                      disabled={saving === 'chat_model'}
                      className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30 flex items-center gap-2"
                    >
                      {saving === 'chat_model' && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">Base URL</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={e => setBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      spellCheck={false}
                      className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm text-text font-mono placeholder:text-text-dim focus:outline-none focus:ring-1 focus:ring-border-focus transition-colors"
                    />
                    <button
                      onClick={() => saveField('openai_base_url', baseUrl.trim())}
                      disabled={saving === 'openai_base_url'}
                      className="h-9 px-4 rounded-md bg-accent text-neutral-950 text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-30 flex items-center gap-2"
                    >
                      {saving === 'openai_base_url' && <Loader2 className="w-4 h-4 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
