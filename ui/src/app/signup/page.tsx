'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';

export default function SignupPage() {
  const router = useRouter();
  const { user, loading: authLoading, signup } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

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
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    try {
      await signup(email, password, displayName.trim() || undefined);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Something went wrong. Please try again.';
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
        <div className="absolute -top-[40%] left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-indigo/[0.04] blur-[120px]" />
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
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-indigo/50 to-transparent" />

          <h1 className="mb-1 font-display text-2xl font-bold text-text">
            Create your account
          </h1>
          <p className="mb-8 text-sm text-text-muted">
            Get started with Oya Browser in seconds
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Display name */}
            <div className="space-y-1.5">
              <label
                htmlFor="displayName"
                className="block text-sm font-medium text-text-muted"
              >
                Display name{' '}
                <span className="text-text-dim">(optional)</span>
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                placeholder="How should we call you?"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="block w-full rounded-lg border border-border bg-bg-input px-3.5 py-2.5 text-sm text-text placeholder:text-text-dim focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
            </div>

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
                  autoComplete="new-password"
                  placeholder="Min. 8 characters"
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
              {/* Password strength hint */}
              {password.length > 0 && password.length < 8 && (
                <p className="text-xs text-yellow">
                  {8 - password.length} more character{8 - password.length !== 1 ? 's' : ''} needed
                </p>
              )}
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
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-[#0c0c0a] shadow-lg shadow-accent/25 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer link */}
        <p className="mt-6 text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link
            href="/login"
            className="font-medium text-accent hover:text-accent-hover"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
