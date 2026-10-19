export const PRODUCT_HOME_PATH = '/family-health';
export const ADMIN_HOME_PATH = '/admin';
export const RETIRED_MEMBER_ROUTE_PATHS = ['/family-history'] as const;

export const HOUSEHOLD_PAGE_KEYS = [
  'home',
  'archive',
  'assistant',
  'export',
  'more',
  'guidance',
] as const;
export type HouseholdPageKey = (typeof HOUSEHOLD_PAGE_KEYS)[number];

interface ProductReturnOptions {
  isAdmin?: boolean;
}

const BLOCKED_RETURN_PATHS = [
  '/login',
  '/user-creation',
  '/auth/sso/callback',
  '/change-password',
  '/privacy-consent',
  '/prototype',
  '/test',
  '/kill-sw',
];

const matchesPathPrefix = (pathname: string, prefix: string): boolean =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const HOUSEHOLD_PAGE_KEY_SET = new Set<string>(HOUSEHOLD_PAGE_KEYS);
const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });

export const householdPageFromSearch = (
  search: string | URLSearchParams
): HouseholdPageKey => {
  const params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  const requestedPage = params.get('page');
  return requestedPage && HOUSEHOLD_PAGE_KEY_SET.has(requestedPage)
    ? (requestedPage as HouseholdPageKey)
    : 'home';
};

export const householdPagePath = (page: HouseholdPageKey): string =>
  page === 'home'
    ? PRODUCT_HOME_PATH
    : `${PRODUCT_HOME_PATH}?page=${encodeURIComponent(page)}`;

interface NavigationLocation {
  pathname: string;
  search?: string;
  hash?: string;
}

export const isProductNavigationPathActive = (
  location: NavigationLocation,
  target: string
): boolean => {
  const parsedTarget = new URL(target, 'https://household-health.invalid');
  if (location.pathname !== parsedTarget.pathname) return false;

  if (parsedTarget.pathname === PRODUCT_HOME_PATH) {
    const currentPage = householdPageFromSearch(location.search ?? '');
    const targetPage = householdPageFromSearch(parsedTarget.search);
    return currentPage === targetPage;
  }

  return parsedTarget.search
    ? (location.search ?? '') === parsedTarget.search
    : true;
};

/**
 * Resolve an authentication return target without allowing open redirects,
 * auth loops, development routes, or privilege escalation into /admin.
 */
export const resolveProductReturnPath = (
  candidate: unknown,
  { isAdmin = false }: ProductReturnOptions = {}
): string => {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return PRODUCT_HOME_PATH;
  }

  if (
    candidate !== candidate.trim() ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    hasControlCharacter(candidate)
  ) {
    return PRODUCT_HOME_PATH;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate, 'https://household-health.invalid');
  } catch {
    return PRODUCT_HOME_PATH;
  }

  if (parsed.origin !== 'https://household-health.invalid') {
    return PRODUCT_HOME_PATH;
  }

  const { pathname, search, hash } = parsed;
  if (
    BLOCKED_RETURN_PATHS.some(prefix => matchesPathPrefix(pathname, prefix)) ||
    RETIRED_MEMBER_ROUTE_PATHS.some(prefix =>
      matchesPathPrefix(pathname, prefix)
    ) ||
    (!isAdmin && matchesPathPrefix(pathname, ADMIN_HOME_PATH))
  ) {
    return PRODUCT_HOME_PATH;
  }

  if (pathname === '/' || pathname === '/dashboard') {
    return PRODUCT_HOME_PATH;
  }

  return `${pathname}${search}${hash}`;
};

export const toLocationReturnTarget = (location: unknown): string | null => {
  if (typeof location === 'string') return location;
  if (!location || typeof location !== 'object') return null;

  const route = location as {
    pathname?: unknown;
    search?: unknown;
    hash?: unknown;
  };
  if (typeof route.pathname !== 'string') return null;

  return `${route.pathname}${
    typeof route.search === 'string' ? route.search : ''
  }${typeof route.hash === 'string' ? route.hash : ''}`;
};
