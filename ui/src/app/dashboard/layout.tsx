'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { ToastProvider } from '@/components/dashboard/toast';
import { apiUrl, apiKeyHeaders } from '@/lib/api';

/**
 * An API key is enough to be here.
 *
 * The key is the identity for everything this dashboard shows — browsers,
 * personas, settings, usage — so requiring a hosted account on top of it would
 * lock a self-hosted deployment (which has API_KEYS and no Supabase) out of its
 * own UI. A signed-in account still works, and is what mints keys in the first
 * place.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [keyOk, setKeyOk] = useState<boolean | null>(null);

  useEffect(() => {
    const key = localStorage.getItem('oya_api_key') || '';
    let cancelled = false;
    const check = key ? fetch(apiUrl('/config'), { headers: apiKeyHeaders(key) }).then((res) => res.ok) : Promise.resolve(false);
    check.then((ok) => { if (!cancelled) setKeyOk(ok); })
      .catch(() => { if (!cancelled) setKeyOk(false); });
    return () => { cancelled = true; };
  }, []);

  const checking = loading || keyOk === null;
  const allowed = !!user || keyOk === true;

  useEffect(() => {
    if (!checking && !allowed) router.replace('/login');
  }, [checking, allowed, router]);

  if (checking || !allowed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          {checking && <p className="text-text-muted text-sm">Loading...</p>}
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      {children}
    </ToastProvider>
  );
}
