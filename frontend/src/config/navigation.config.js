// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { PRODUCT_HOME_PATH } from './productRoutes';

// Breakpoint definitions
export const BREAKPOINTS = {
  mobile: 768,
  tablet: 1024,
  laptop: 1200,
  desktop: 1440,
};

/**
 * Navigation sections shared across all viewports
 *
 * NOTE: The 'name' and 'title' fields are Chinese-first household fallbacks.
 * Components using this config should use getTranslatedNavigationSections() helper
 * to get the translated navigation structure.
 */
export const NAVIGATION_SECTIONS = {
  householdWorkspace: {
    titleKey: 'navigation:householdNav.section',
    title: '家庭健康',
    priority: 1,
    items: [
      {
        nameKey: 'navigation:householdNav.home',
        name: '首页',
        path: PRODUCT_HOME_PATH,
        icon: '🏠',
        id: 'family-health-home',
        alwaysVisible: true,
      },
      {
        nameKey: 'navigation:householdNav.archive',
        name: '健康档案',
        path: `${PRODUCT_HOME_PATH}?page=archive`,
        icon: '📁',
        id: 'health-archive',
        alwaysVisible: true,
      },
      {
        nameKey: 'navigation:householdNav.ai',
        name: '问问 AI',
        path: `${PRODUCT_HOME_PATH}?page=assistant`,
        icon: '✨',
        id: 'health-ai',
        requiredCapability: 'canUseAi',
      },
      {
        nameKey: 'navigation:householdNav.export',
        name: '导出打印',
        path: `${PRODUCT_HOME_PATH}?page=export`,
        icon: '📤',
        id: 'health-export',
        requiredCapability: 'canExport',
      },
      {
        nameKey: 'navigation:householdNav.account',
        name: '我的',
        path: `${PRODUCT_HOME_PATH}?page=more`,
        icon: '👤',
        id: 'account',
        alwaysVisible: true,
      },
    ],
  },
};

// Admin section (conditionally added based on user role)
export const ADMIN_SECTION = {
  titleKey: 'navigation:sidebarNav.sections.administration',
  title: 'Administration',
  priority: 6,
  requiresAdmin: true,
  items: [
    {
      nameKey: 'navigation:sidebarNav.items.adminDashboard',
      name: 'Admin Dashboard',
      path: '/admin',
      icon: '🔧',
      id: 'admin-dashboard',
    },
    {
      nameKey: 'navigation:sidebarNav.items.dataModels',
      name: 'Data Models',
      path: '/admin/data-models',
      icon: '🗃️',
      id: 'data-models',
    },
    {
      nameKey: 'navigation:sidebarNav.items.backupManagement',
      name: 'Backup Management',
      path: '/admin/backup',
      icon: '💾',
      id: 'backup',
    },
    {
      nameKey: 'navigation:sidebarNav.items.systemHealth',
      name: 'System Health',
      path: '/admin/system-health',
      icon: '🔍',
      id: 'system-health',
    },
  ],
};

// Viewport-specific configurations
export const VIEWPORT_CONFIGS = {
  mobile: {
    maxSections: 5,
    layout: 'sidebar',
    showLabels: true,
    featuredOnly: false,
    bottomNavItems: [
      'family-health-home',
      'health-archive',
      'health-ai',
      'account',
    ],
  },
  tablet: {
    maxSections: 5,
    layout: 'dropdown',
    compactMode: true,
  },
  laptop: {
    maxSections: 6,
    layout: 'dropdown',
    showAllSections: true,
  },
  desktop: {
    maxSections: 7,
    layout: 'dropdown',
    showAllSections: true,
    expandedMode: true,
  },
};

// Helper function to get navigation sections based on viewport and user role
export const getNavigationSections = (
  viewport,
  isAdmin = false,
  capabilities = {}
) => {
  // Removed frequent navigation logging for performance

  const sections = Object.fromEntries(
    Object.entries(NAVIGATION_SECTIONS).map(([key, section]) => [
      key,
      {
        ...section,
        items: section.items.filter(item => {
          if (!item.requiredCapability) return true;
          return capabilities[item.requiredCapability] !== false;
        }),
      },
    ])
  );

  // Add admin section if user is admin
  if (isAdmin) {
    sections.admin = ADMIN_SECTION;
  }

  // Apply viewport-specific modifications
  const config = VIEWPORT_CONFIGS[viewport];

  if (config?.hideSections) {
    config.hideSections.forEach(sectionKey => {
      delete sections[sectionKey];
    });
  }

  return sections;
};

// Helper to get featured items for quick access
export const getFeaturedItems = () => {
  const featured = [];

  Object.values(NAVIGATION_SECTIONS).forEach(section => {
    section.items.forEach(item => {
      if (item.featured || item.alwaysVisible) {
        featured.push({
          ...item,
          sectionTitle: section.title,
        });
      }
    });
  });

  return featured;
};
