import type { MetadataRoute } from 'next';
import { site } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ['', '/calls', '/pricing', '/faq'];
  return routes.map((path) => ({
    url: `${site.url}${path}`,
    lastModified: now,
    changeFrequency: path === '/calls' ? 'hourly' : 'weekly',
    priority: path === '' ? 1 : path === '/calls' ? 0.9 : 0.7,
  }));
}
