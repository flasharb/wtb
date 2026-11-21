import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { site } from '@/lib/site';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const display = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [
    'Solana',
    'memecoin',
    'crypto trading bot',
    'Telegram trading bot',
    'Solana sniper',
    'auto trading',
    'launch scanner',
    'token calls',
    'Pump.fun',
    'DeFi',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    url: site.url,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: [{ url: '/og.png', width: 1232, height: 1232, alt: `${site.name} logo` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: ['/og.png'],
    creator: site.twitterHandle,
  },
  robots: { index: true, follow: true, 'max-image-preview': 'large' },
  icons: { icon: '/og.png', apple: '/og.png' },
};

export const viewport: Viewport = {
  themeColor: '#0a0620',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${site.url}/#org`,
        name: site.name,
        url: site.url,
        logo: `${site.url}/og.png`,
        sameAs: [site.botUrl, site.freeChannelUrl],
      },
      {
        '@type': 'WebSite',
        '@id': `${site.url}/#site`,
        name: site.name,
        url: site.url,
        publisher: { '@id': `${site.url}/#org` },
        description: site.description,
      },
    ],
  };

  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
