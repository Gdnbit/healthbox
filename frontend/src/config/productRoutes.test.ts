import { describe, expect, it } from 'vitest';
import {
  householdPageFromSearch,
  householdPagePath,
  isProductNavigationPathActive,
  PRODUCT_HOME_PATH,
  RETIRED_MEMBER_ROUTE_PATHS,
  resolveProductReturnPath,
} from './productRoutes';

describe('household product routes', () => {
  it('uses the household health workspace as the product home', () => {
    expect(PRODUCT_HOME_PATH).toBe('/family-health');
  });

  it('preserves a safe same-origin deep link including query and hash', () => {
    expect(
      resolveProductReturnPath('/health-insights?view=metrics#latest')
    ).toBe('/health-insights?view=metrics#latest');
  });

  it.each([
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example/steal',
    'javascript:alert(1)',
  ])('rejects an external or ambiguous return target: %s', candidate => {
    expect(resolveProductReturnPath(candidate)).toBe(PRODUCT_HOME_PATH);
  });

  it.each([
    '/login',
    '/user-creation',
    '/auth/sso/callback',
    '/change-password',
    '/privacy-consent',
  ])('prevents authentication and activation redirect loops: %s', candidate => {
    expect(resolveProductReturnPath(candidate)).toBe(PRODUCT_HOME_PATH);
  });

  it('rejects administrator deep links for an ordinary member', () => {
    expect(resolveProductReturnPath('/admin/users')).toBe(PRODUCT_HOME_PATH);
  });

  it.each([
    '/family-history',
    '/family-history?member=42',
    '/family-history#sharing',
  ])(
    'canonicalizes a retired directional-sharing deep link to the household workspace: %s',
    candidate => {
      expect(resolveProductReturnPath(candidate)).toBe(PRODUCT_HOME_PATH);
    }
  );

  it('keeps the removed family-history UI in the explicit retired-route list', () => {
    expect(RETIRED_MEMBER_ROUTE_PATHS).toEqual(['/family-history']);
  });

  it('allows a validated administrator deep link for an administrator', () => {
    expect(
      resolveProductReturnPath('/admin/users?status=active', { isAdmin: true })
    ).toBe('/admin/users?status=active');
  });

  it('maps a household page query to a refresh-safe workspace view', () => {
    expect(householdPageFromSearch('?page=archive')).toBe('archive');
    expect(householdPageFromSearch('?page=assistant')).toBe('assistant');
    expect(householdPageFromSearch('?page=unknown')).toBe('home');
  });

  it('creates canonical household workspace links', () => {
    expect(householdPagePath('home')).toBe(PRODUCT_HOME_PATH);
    expect(householdPagePath('export')).toBe(
      `${PRODUCT_HOME_PATH}?page=export`
    );
  });

  it('distinguishes household subpages that share one pathname', () => {
    const location = {
      pathname: PRODUCT_HOME_PATH,
      search: '?page=archive',
      hash: '',
    };

    expect(
      isProductNavigationPathActive(location, householdPagePath('archive'))
    ).toBe(true);
    expect(
      isProductNavigationPathActive(location, householdPagePath('home'))
    ).toBe(false);
  });
});
