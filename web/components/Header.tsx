'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Logo } from './Logo';
import { nav, site } from '@/lib/site';

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // The /app dashboard has its own top bar — don't stack the marketing header there.
  const hidden = pathname?.startsWith('/app');

  // Close the mobile menu on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hidden) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-ink-border/60 bg-ink-950/80 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between gap-3">
        <Link href="/" aria-label="Stack Alpha home" onClick={close}>
          <Logo />
        </Link>

        {/* Desktop nav + CTAs */}
        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm font-medium text-brand-100/80 transition hover:text-white">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="btn-ghost">Free calls</a>
          <Link href="/app" className="btn-primary">Launch app</Link>
        </div>

        {/* Mobile: Launch app always visible + hamburger */}
        <div className="relative flex items-center gap-2 md:hidden" ref={menuRef}>
          <Link href="/app" onClick={close} className="btn-primary !px-4 !py-2 text-sm">Launch app</Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-ink-border bg-white/5 text-brand-100 active:scale-95"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>

          {open && (
            <div className="absolute right-0 top-12 w-60 rounded-2xl border border-ink-border bg-ink-850 p-3 shadow-glow-lg">
              <nav className="flex flex-col" aria-label="Mobile">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} onClick={close} className="rounded-lg px-3 py-2.5 text-sm font-medium text-brand-100 hover:bg-white/5">
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-2 flex flex-col gap-2 border-t border-ink-border pt-3">
                <Link href="/app" onClick={close} className="btn-primary w-full">Launch app</Link>
                <a href={site.freeChannelUrl} target="_blank" rel="noopener" onClick={close} className="btn-ghost w-full">Free calls channel</a>
                <a href={site.botUrl} target="_blank" rel="noopener" onClick={close} className="btn-ghost w-full">Open the bot</a>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
