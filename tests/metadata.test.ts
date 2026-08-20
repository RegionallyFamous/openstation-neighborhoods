import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public discovery metadata', () => {
  it('publishes canonical, Open Graph, and X card metadata', () => {
    const html = readFileSync('index.html', 'utf8');

    expect(html).toContain('<link rel="canonical" href="https://openstation.chat/"');
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('name="twitter:image"');
    expect(html).toContain('type="application/ld+json"');
  });

  it('keeps robots and sitemap URLs aligned with the production domain', () => {
    const robots = readFileSync('public/robots.txt', 'utf8');
    const sitemap = readFileSync('public/sitemap.xml', 'utf8');

    expect(robots).toContain('Sitemap: https://openstation.chat/sitemap.xml');
    expect(sitemap).toContain('<loc>https://openstation.chat/</loc>');
  });
});
