import { describe, expect, it } from 'vitest';
import { shouldOpenAdminSidebarInitially } from './adminLayoutResponsive';

describe('admin layout responsive defaults', () => {
  it('keeps navigation closed on phone and tablet-width entry', () => {
    expect(shouldOpenAdminSidebarInitially(390)).toBe(false);
    expect(shouldOpenAdminSidebarInitially(768)).toBe(false);
  });

  it('keeps navigation open on desktop entry', () => {
    expect(shouldOpenAdminSidebarInitially(769)).toBe(true);
    expect(shouldOpenAdminSidebarInitially(1440)).toBe(true);
  });
});
