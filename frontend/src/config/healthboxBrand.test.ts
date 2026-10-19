import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('HealthBox public identity', () => {
  it('uses one product identity in page, install metadata, and package metadata', () => {
    const html = read('index.html');
    const manifest = JSON.parse(read('public/manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    expect(html).toContain('<title>HealthBox · 健康档案盒</title>');
    // Attribution belongs in source comments, not the visible product identity.
    const visibleHtml = html.replace(/<!--[\s\S]*?-->/g, '');
    expect(visibleHtml).not.toContain('MediKeep');
    expect(manifest.short_name).toBe('HealthBox');
    expect(manifest.name).toBe('HealthBox · 健康档案盒');
    expect(pkg.name).toBe('healthbox-frontend');
    expect(lock.name).toBe(pkg.name);
    expect(lock.packages[''].name).toBe(pkg.name);
    for (const icon of manifest.icons) {
      expect(
        existsSync(
          resolve(process.cwd(), 'public', icon.src.replace(/^\//, ''))
        )
      ).toBe(true);
      expect(icon.src).toContain('healthbox');
    }
  });

  it('keeps the demo avatar generic and removes the unverified portrait reference', () => {
    const page = read('src/pages/prototype/HouseholdHealthPrototype.tsx');
    expect(page).toContain('/assets/prototype/demo-avatar.svg');
    expect(page).not.toContain('lin-xiao-avatar.png');
    expect(read('public/assets/prototype/demo-avatar.svg')).toContain(
      'Generic demo avatar'
    );
  });
});
