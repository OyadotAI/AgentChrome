'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { apiUrl, apiKeyHeaders } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // A self-hosted deployment has API keys and no accounts, so a key is a
  // first-class way in — it is the identity the whole dashboard is scoped to.
  const [mode, setMode] = useState<'account' | 'key'>('account');
  const [apiKey, setApiKey] = useState('');

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  async function handleKeySubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const key = apiKey.trim();
    if (!key) { setError('Enter an API key'); return; }

    setSubmitting(true);
    try {
      // Prove the server accepts it before storing it, so a wrong key fails
      // here rather than as an empty dashboard.
      const res = await fetch(apiUrl('/config'), { headers: apiKeyHeaders(key) });
      if (!res.ok) throw new Error(res.status === 401 ? 'That key was rejected' : `Could not verify the key (${res.status})`);
      localStorage.setItem('oya_api_key', key);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not verify the key');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!password) {
      setError('Password is required');
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Invalid email or password';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  // Don't render until auth state is resolved
  if (authLoading || user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12">
      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-[40%] left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-accent/[0.04] blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[420px]">
        {/* Brand */}
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-40" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-text">
            Oya Browser
          </span>
        </div>

        {/* Card */}
        <div className="relative rounded-2xl border border-border bg-bg-card/70 p-8 shadow-2xl shadow-black/40 backdrop-blur-xl">
          {/* Gradient top border accent */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-accent/50 to-transparent" />

          <h1 className="mb-1 font-display text-2xl font-bold text-text">
            Welcome back
          </h1>
          <p className="mb-6 text-sm text-text-muted">
            {mode === 'account' ? 'Sign in to your account to continue' : 'Paste an API key from this deployment'}
          </p>

          <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
            {(['account', 'key'] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setError(''); }}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  mode === m ? 'bg-accent/10 text-text' : 'text-text-dim hover:text-text-muted'}`}>
                {m === 'account' ? 'Account' : 'API key'}
              </button>
            ))}
          </div>

          {mode === 'key' ? (
            <form onSubmit={handleKeySubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="apiKey" className="block text-sm font-medium text-text-muted">API key</label>
                <input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder="Paste your key"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); if (error) setError(''); }}
                  className="block w-full rounded-lg border border-border bg-bg-input px-3.5 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
              {error && <p className="text-sm text-red" role="alert">{error}</p>}
              <button type="submit" disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Checking...</> : <>Continue<ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-text-muted"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                className="block w-full rounded-lg border border-border bg-bg-input px-3.5 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-text-muted"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  className="block w-full rounded-lg border border-border bg-bg-input px-3.5 py-2.5 pr-11 text-sm text-text placeholder:text-text-dim focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-muted"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-red" role="alert">
                {error}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/25 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
          )}
        </div>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-text-muted">
          Don&apos;t have an account?{' '}
          <Link
            href="/signup"
            className="font-medium text-accent hover:text-accent-hover"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
