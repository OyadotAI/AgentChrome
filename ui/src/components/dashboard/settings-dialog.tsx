'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import { useToast } from './toast';
import { loadConfig, saveConfig, desktopSignInUrl, LLM_PRESETS, isOyaProvider, type KeyConfig } from './config';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  onRerunSetup?: () => void;
}

/**
 * Everything here is stored against the open API key. There is no account
 * layer and no environment variable to edit — a self-hosted deployment is
 * configured entirely from this dialog or `oya init`.
 */
export default function SettingsDialog({ open, onClose, apiKey, onRerunSetup }: SettingsDialogProps) {
  const toast = useToast();
  const [config, setConfig] = useState<KeyConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pairing, setPairing] = useState(false);

  const openDesktop = async () => {
    setPairing(true);
    try { window.location.href = await desktopSignInUrl(apiKey); }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not start sign-in', 'error'); }
    finally { setPairing(false); }
  };

  const refresh = useCallback(async () => {
    if (!open || !apiKey) return;
    try { setConfig(await loadConfig(apiKey)); }
    catch (err) { toast(err instanceof Error ? err.message : 'Error', 'error'); }
  }, [open, apiKey, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  const set = (field: string, value: string) => setDraft({ ...draft, [field]: value });
  const value = (field: keyof KeyConfig) =>
    draft[field] ?? (typeof config?.[field] === 'string' ? (config[field] as string) : '');

  const save = async () => {
    if (!Object.keys(draft).length) return onClose();
    setSaving(true);
    try {
      setConfig(await saveConfig(apiKey, draft));
      setDraft({});
      toast('Saved', 'success');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error', 'error');
    } finally { setSaving(false); }
  };

  const field = 'field';
  const label = 'label';
  const needs = config?.providers.find((p) => p.id === value('browser_provider'))?.needs ?? [];

  return (
    <Dialog open={open} onClose={onClose} title="Settings" description="Stored against this API key — nothing here lives in an environment variable."
      footer={config ? (
        <>
          {onRerunSetup && (
            <button onClick={() => { onClose(); onRerunSetup(); }} className="btn-ghost mr-auto">Run setup again</button>
          )}
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
          </button>
        </>
      ) : undefined}>

          {!config ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-text-dim" /></div>
          ) : (
            <div className="space-y-5">
              <div>
                <span className={label}>Model provider</span>
                <div className="grid grid-cols-2 gap-2">
                  {LLM_PRESETS.map((p) => (
                    <button key={p.id} onClick={() => set('llm_provider', p.id)}
                      className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                        value('llm_provider') === p.id ? 'border-accent bg-accent/10 text-text' : 'border-border text-text-dim hover:bg-text/5'}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className={label}>API key</span>
                <input className={field} type="password" autoComplete="off"
                  placeholder={config.has_openai_key ? config.openai_api_key || 'Configured' : 'sk-...'}
                  value={draft.openai_api_key ?? ''} onChange={(e) => set('openai_api_key', e.target.value)} />
                {config.inherited && (
                  <p className="mt-1.5 text-xs text-text-dim">
                    Currently using this deployment&apos;s key. Enter your own to override it.
                  </p>
                )}
              </div>

              <div>
                <span className={label}>Default model</span>
                <input className={field} placeholder={config.effective.model}
                  value={value('chat_model')} onChange={(e) => set('chat_model', e.target.value)} />
              </div>

              <div>
                <span className={label}>Browser provider</span>
                <select className={field} value={value('browser_provider')}
                  onChange={(e) => set('browser_provider', e.target.value)}>
                  {config.providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}{p.needs.length && !p.configured ? ' — needs a key' : ''}</option>
                  ))}
                </select>
              </div>

              {needs.map((f) => (
                <div key={f}>
                  <span className={label}>{f.replace(/_/g, ' ')}</span>
                  <input className={field} type="password" autoComplete="off"
                    placeholder={(config[f as keyof KeyConfig] as string) || 'not set'}
                    value={draft[f] ?? ''} onChange={(e) => set(f, e.target.value)} />
                </div>
              ))}

              <div>
                <span className={label}>CAPTCHA solver</span>
                <select className={field} value={value('captcha_solver')}
                  onChange={(e) => set('captcha_solver', e.target.value)}>
                  <option value="">None</option>
                  <option value="capsolver">CapSolver</option>
                </select>
                {value('captcha_solver') && (
                  <input className={`${field} mt-2`} type="password" autoComplete="off"
                    placeholder={config.captcha_api_key || 'Solver API key'}
                    value={draft.captcha_api_key ?? ''} onChange={(e) => set('captcha_api_key', e.target.value)} />
                )}
              </div>

              {isOyaProvider(value('browser_provider')) && apiKey && (
                <div className="flex flex-wrap gap-2">
                  <button onClick={openDesktop} disabled={pairing}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-text/5 disabled:opacity-60">
                    {pairing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Sign in on the desktop browser
                  </button>
                  <a href="/downloads" target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-dim hover:bg-text/5 hover:text-text">
                    Download <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              )}

            </div>
          )}
    </Dialog>
  );
}
