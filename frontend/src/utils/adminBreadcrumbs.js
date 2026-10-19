// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
/**
 * Breadcrumb generation for admin routes.
 * Maps admin paths to human-readable labels and builds crumb arrays.
 */

const ADMIN_ROUTE_LABELS = {
  '/admin': '系统管理',
  '/admin/data-models': '数据模型',
  '/admin/users': '用户管理',
  '/admin/account-invitations': '成员邀请',
  '/admin/archive-circles': '档案互见管理',
  '/admin/delegated-upload': '管理员代上传',
  '/admin/member-data-maintenance': '成员数据维护',
  '/admin/trash': '回收站',
  '/admin/audit-log': '审计日志',
  '/admin/system-health': '系统状态',
  '/admin/backup': '备份管理',
  '/admin/tools': '维护工具',
  '/admin/ai-service': 'AI 服务',
  '/admin/settings': '设置',
  '/admin/create-user': '创建用户',
  '/admin/analytics': '统计分析',
};

/**
 * Humanize a snake_case or kebab-case model name.
 * e.g. "lab_result" -> "Lab Result", "emergency-contact" -> "Emergency Contact"
 */
function humanize(str) {
  return str.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Generate breadcrumb items for an admin pathname.
 *
 * @param {string} pathname - Current location pathname
 * @returns {Array<{label: string, path: string|null}>}
 *   Last item has path=null (current page). Returns single crumb for dashboard root.
 */
export function generateAdminBreadcrumbs(pathname) {
  // Always start with Admin root
  const crumbs = [{ label: '系统管理', path: '/admin' }];

  // Dashboard root — just the single crumb
  if (pathname === '/admin' || pathname === '/admin/') {
    return crumbs;
  }

  // Static route match
  if (ADMIN_ROUTE_LABELS[pathname]) {
    crumbs.push({ label: ADMIN_ROUTE_LABELS[pathname], path: null });
    return crumbs;
  }

  // Dynamic model routes: /admin/models/:modelName[/:recordId[/edit|/create]]
  const modelMatch = pathname.match(
    /^\/admin\/models\/([^/]+)(?:\/([^/]+))?(?:\/(edit|create))?$/
  );

  if (modelMatch) {
    const [, modelName, recordId, action] = modelMatch;
    const modelLabel = humanize(modelName);

    crumbs.push({ label: '数据模型', path: '/admin/data-models' });
    crumbs.push({
      label: modelLabel,
      path: recordId ? `/admin/models/${modelName}` : null,
    });

    if (recordId && recordId !== 'create') {
      if (action === 'edit') {
        crumbs.push({
          label: `Record ${recordId}`,
          path: `/admin/models/${modelName}/${recordId}`,
        });
        crumbs.push({ label: '编辑', path: null });
      } else {
        crumbs.push({
          label: `Record ${recordId}`,
          path: null,
        });
      }
    } else if (recordId === 'create') {
      crumbs.push({ label: '创建', path: null });
    }

    return crumbs;
  }

  // Fallback: split pathname and build crumbs from segments
  const segments = pathname
    .replace(/^\/admin\/?/, '')
    .split('/')
    .filter(Boolean);
  let currentPath = '/admin';

  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    const isLast = i === segments.length - 1;
    const label = ADMIN_ROUTE_LABELS[currentPath] || humanize(segments[i]);
    crumbs.push({ label, path: isLast ? null : currentPath });
  }

  return crumbs;
}
