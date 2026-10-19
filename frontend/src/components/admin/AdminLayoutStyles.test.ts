import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const adminLayoutCss = readFileSync(
  resolve(process.cwd(), 'src/components/admin/AdminLayout.css'),
  'utf8'
);

describe('AdminLayout responsive style scope', () => {
  it('does not apply emergency admin rules to every page element', () => {
    expect(adminLayoutCss).not.toMatch(
      /^\s{2}(?:\*|button|table|h[1-6])(?:,|\s*\{)/gmu
    );
    expect(adminLayoutCss).toContain('.admin-layout button');
    expect(adminLayoutCss).toContain('.admin-layout table');
    expect(adminLayoutCss).toContain('.admin-layout *');
  });
});
