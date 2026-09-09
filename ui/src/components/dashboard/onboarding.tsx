'use client';

import { useState } from 'react';
import { Check, Loader2, ExternalLink, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from './toast';
import { saveConfig, desktopSignInUrl, LLM_PRESETS, isOyaProvider, type KeyConfig } from './config';

interface OnboardingProps {
  apiKey: string;
  config: KeyConfig;
  onDone: () => void;
}

const STEPS = ['Model', 'Browsers', 'Challenges', 'Sign in'] as const;

/**
 * Four questions, once. Everything here is stored against the API key that is
 * open in this dashboard — it is the identity for browsers, personas, cookies
 * and usage, so it is the identity for configuration too.
 */
export default function Onboarding({ apiKey, config, onDone }: OnboardingProps) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [llm, setLlm] = useState(config.llm_provider || 'anthropic');
  const [llmKey, setLlmKey] = useState('');
  const [model, setModel] = useState(config.chat_model || '');
  const [provider, setProvider] = useState(config.browser_provider || 'oya-cloud');
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [solver, setSolver] = useState(config.captcha_solver || '');
  const [solverKey, setSolverKey] = useState('');

  const needs = config.providers.find((p) => p.id === provider)?.needs ?? [];

  const persist = async (values: Record<string, string>) => {
    setSaving(true);
    try {
      await saveConfig(apiKey, values);
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (step === 0) {
      const values: Record<string, string> = { llm_provider: llm };
      if (llmKey) values.openai_api_key = llmKey;
      if (model) values.chat_model = model;
      if (!(await persist(values))) return;
    }
    if (step === 1) {
      const values: Record<string, string> = { browser_provider: provider };
      for (const field of needs) if (providerKeys[field]) values[field] = providerKeys[field];
      if (!(await persist(values))) return;
    }
    if (step === 2) {
      const values: Record<string, string> = { captcha_solver: solver };
      if (solverKey) values.captcha_api_key = solverKey;
      if (!(await persist(values))) return;
    }
    // The desktop sign-in is the last step, and it only exists for browsers on
    // our own infrastructure — there is nothing to hand cookies to otherwise.
    const finishing = step === STEPS.length - 1 || (step === 2 && !isOyaProvider(provider));
    if (finishing) {
      if (!(await persist({ onboarded: 'true' }))) return;
      onDone();
      return;
    }
    setStep(step + 1);
  };

  const field = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none';
  const card = (active: boolean) =>
    `rounded-lg border px-4 py-3 text-left transition-colors ${
      active ? 'border-accent bg-accent/10' : 'border-border bg-bg-card hover:bg-white/5'}`;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-8 flex items-center gap-2">
          {STEPS.filter((_, i) => i < STEPS.length - 1 || isOyaProvider(provider)).map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                i < step ? 'bg-accent text-black' : i === step ? 'border border-accent text-accent' : 'border border-border text-text-dim'}`}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? 'text-text' : 'text-text-dim'}`}>{label}</span>
              {(i < STEPS.length - 2 || isOyaProvider(provider)) && i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>

        <motion.div key={step} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          {step === 0 && (
            <>
              <h2 className="text-lg font-semibold text-text">Which model drives your agents?</h2>
              <p className="mt-1 text-sm text-text-dim">
                Stored against this API key and used for natural-language control.
                {config.inherited && ' This deployment already has a key configured; yours overrides it.'}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {LLM_PRESETS.map((p) => (
                  <button key={p.id} className={card(llm === p.id)}
                    onClick={() => { setLlm(p.id); if (!model) setModel(p.model); }}>
                    <div className="text-sm font-medium text-text">{p.label}</div>
                    <div className="mt-0.5 font-mono text-xs text-text-dim">{p.model}</div>
                  </button>
                ))}
              </div>
              <input className={`${field} mt-4`} type="password" autoComplete="off"
                placeholder={config.has_openai_key ? config.openai_api_key || 'Configured' : LLM_PRESETS.find((p) => p.id === llm)?.hint}
                value={llmKey} onChange={(e) => setLlmKey(e.target.value)} />
              <input className={`${field} mt-3`} placeholder="Default model"
                value={model} onChange={(e) => setModel(e.target.value)} />
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold text-text">Where should your browsers run?</h2>
              <p className="mt-1 text-sm text-text-dim">
                One setting. Your code calls <code className="font-mono text-text-muted">oya.browser.start()</code> either way.
              </p>
              <div className="mt-4 grid gap-2">
                {config.providers.map((p) => (
                  <button key={p.id} className={card(provider === p.id)} onClick={() => setProvider(p.id)}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">{p.label}</span>
                      {p.needs.length > 0 && (
                        <span className={`text-xs ${p.configured ? 'text-accent' : 'text-text-dim'}`}>
                          {p.configured ? 'configured' : 'needs an API key'}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {needs.map((f) => (
                <input key={f} className={`${field} mt-3`} type="password" autoComplete="off"
                  placeholder={f.replace(/_/g, ' ')}
                  value={providerKeys[f] || ''}
                  onChange={(e) => setProviderKeys({ ...providerKeys, [f]: e.target.value })} />
              ))}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-lg font-semibold text-text">Solve CAPTCHAs automatically?</h2>
              <p className="mt-1 text-sm text-text-dim">
                Providers that solve natively still will. This adds a solver for the rest.
                Sessions that used one are recorded in the audit trail.
              </p>
              <div className="mt-4 grid gap-2">
                {[
                  { id: '', label: 'No solver' },
                  { id: 'capsolver', label: 'CapSolver' },
                  { id: '2captcha', label: '2Captcha' },
                ].map((o) => (
                  <button key={o.id || 'none'} className={card(solver === o.id)} onClick={() => setSolver(o.id)}>
                    <span className="text-sm font-medium text-text">{o.label}</span>
                  </button>
                ))}
              </div>
              {solver && (
                <input className={`${field} mt-3`} type="password" autoComplete="off" placeholder="Solver API key"
                  value={solverKey} onChange={(e) => setSolverKey(e.target.value)} />
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-lg font-semibold text-text">Sign in once, on your own machine</h2>
              <p className="mt-1 text-sm text-text-dim">
                Open the desktop browser and log into the sites your agents need. Those cookies
                move to your remote browsers, which run the same fingerprint as this identity —
                so the sessions look like one device returning, not a fleet sharing an account.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={desktopSignInUrl(apiKey)}
                  className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black">
                  Open the desktop browser <ArrowRight className="h-3.5 w-3.5" />
                </a>
                <a href="/downloads" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-bg-card px-4 py-2 text-sm text-text hover:bg-white/5">
                  Download it first <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <p className="mt-3 text-xs text-text-dim">
                Opening it signs that browser in as this API key. Optional — Settings has the same link.
              </p>
            </>
          )}
        </motion.div>

        <div className="mt-8 flex items-center gap-3">
          <button onClick={next} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {step === STEPS.length - 1 || (step === 2 && !isOyaProvider(provider)) ? 'Finish' : 'Continue'}
          </button>
          {step > 0 && (
            <button onClick={() => setStep(step - 1)} className="text-sm text-text-dim hover:text-text">Back</button>
          )}
          <button onClick={onDone} className="ml-auto text-sm text-text-dim hover:text-text">Skip setup</button>
        </div>
      </div>
    </div>
  );
}
