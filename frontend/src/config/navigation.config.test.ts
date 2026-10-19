import { describe, expect, it } from 'vitest';
import { getNavigationSections, VIEWPORT_CONFIGS } from './navigation.config';

const itemIds = (isAdmin = false) =>
  Object.values(getNavigationSections('desktop', isAdmin)).flatMap(section =>
    section.items.map(item => item.id)
  );

const itemPaths = (isAdmin = false) =>
  Object.values(getNavigationSections('desktop', isAdmin)).flatMap(section =>
    section.items.map(item => item.path)
  );

describe('household navigation information architecture', () => {
  it('keeps ordinary navigation focused on five household tasks', () => {
    expect(itemIds()).toEqual([
      'family-health-home',
      'health-archive',
      'health-ai',
      'health-export',
      'account',
    ]);
  });

  it('does not expose upstream clinical entities in ordinary navigation', () => {
    expect(itemIds()).not.toEqual(
      expect.arrayContaining([
        'patient-info',
        'medications',
        'lab-results',
        'visits',
        'practitioners',
        'pharmacies',
        'data-models',
      ])
    );
    expect(itemPaths()).not.toContain('/family-history');
  });

  it('keeps explicit administration entry points for the administrator', () => {
    expect(itemIds(true)).toContain('admin-dashboard');
  });

  it('uses the four discoverable member destinations on mobile', () => {
    expect(VIEWPORT_CONFIGS.mobile.bottomNavItems).toEqual([
      'family-health-home',
      'health-archive',
      'health-ai',
      'account',
    ]);
  });
});
