import Link from 'next/link';

/** Shared Oya identity, from A2ABaseAI/frontend. */
export function OyaLogo({ size = 24 }: { size?: number }) {
  return <svg viewBox="0 0 512 512" width={size} height={size} fill="none" aria-hidden="true" className="shrink-0">
    <circle cx="276" cy="276" r="160" stroke="var(--primary)" strokeWidth="80" />
    <circle cx="236" cy="236" r="160" stroke="var(--foreground)" strokeWidth="80" />
  </svg>;
}

export function OyaWordmark({ href = '/' }: { href?: string }) {
  return <Link href={href} className="inline-flex shrink-0 items-center gap-2.5" aria-label="Oya Browser home">
    <OyaLogo /><span className="font-display text-[15px] tracking-tight">Oya<span className="ml-2 font-sans text-xs font-medium tracking-normal text-text-muted">Browser</span></span>
  </Link>;
}
