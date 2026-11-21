import type { Metadata } from 'next';
import { Providers } from '@/modules/auth/Providers';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false }, // the app is private; don't index it
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
