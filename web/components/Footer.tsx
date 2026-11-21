import Link from 'next/link';
import { Logo } from './Logo';
import { nav, site } from '@/lib/site';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-ink-border/60 bg-ink-950/60">
      <div className="container-x py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-3 text-sm text-brand-100/60">{site.description}</p>
          </div>
          <div className="flex gap-12">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-brand-300">Product</h3>
              <ul className="mt-3 space-y-2">
                {nav.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} className="text-sm text-brand-100/70 hover:text-white">
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-brand-300">Join</h3>
              <ul className="mt-3 space-y-2">
                <li>
                  <a href={site.freeChannelUrl} target="_blank" rel="noopener" className="text-sm text-brand-100/70 hover:text-white">
                    Free calls channel
                  </a>
                </li>
                <li>
                  <a href={site.botUrl} target="_blank" rel="noopener" className="text-sm text-brand-100/70 hover:text-white">
                    Telegram bot
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-ink-border/60 pt-6 text-xs text-brand-100/50">
          <p>© {new Date().getFullYear()} {site.name}. Not financial advice. Crypto trading carries substantial risk — never invest more than you can afford to lose.</p>
        </div>
      </div>
    </footer>
  );
}
