import Link from 'next/link';
import { Logo } from './Logo';
import { nav, site } from '@/lib/site';

// Mobile-first header. The mobile menu uses a native <details> so it needs zero client JS.
export function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink-border/60 bg-ink-950/80 backdrop-blur">
      <div className="container-x flex h-16 items-center justify-between gap-4">
        <Link href="/" aria-label="Stack Alpha home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="text-sm font-medium text-brand-100/80 transition hover:text-white">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="btn-ghost">
            Free calls
          </a>
          <Link href="/app" className="btn-primary">
            Launch app
          </Link>
        </div>

        {/* Mobile menu */}
        <details className="group relative md:hidden">
          <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-ink-border bg-white/5 [&::-webkit-details-marker]:hidden">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-100">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="absolute right-0 top-12 w-60 rounded-2xl border border-ink-border bg-ink-850 p-3 shadow-glow-lg">
            <nav className="flex flex-col" aria-label="Mobile">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2.5 text-sm font-medium text-brand-100 hover:bg-white/5">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="mt-2 flex flex-col gap-2 border-t border-ink-border pt-3">
              <Link href="/app" className="btn-primary w-full">
                Launch app
              </Link>
              <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="btn-ghost w-full">
                Free calls channel
              </a>
              <a href={site.botUrl} target="_blank" rel="noopener" className="btn-ghost w-full">
                Open the bot
              </a>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
