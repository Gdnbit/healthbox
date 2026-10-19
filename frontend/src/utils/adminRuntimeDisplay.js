const ZH_STATUS_LABELS = {
  healthy: '健康',
  ok: '正常',
  operational: '运行正常',
  warning: '警告',
  slow: '响应缓慢',
  error: '错误',
  unhealthy: '异常',
  failed: '失败',
  info: '信息',
};

const UPTIME_UNITS = {
  minute: 'minute',
  minutes: 'minute',
  hour: 'hour',
  hours: 'hour',
  day: 'day',
  days: 'day',
};

const ZH_MODEL_LABELS = {
  User: '用户',
  Patient: '健康档案',
  LabResult: '检验结果',
  Medication: '用药记录',
  Procedure: '医疗程序',
  Allergy: '过敏记录',
  Immunization: '免疫接种',
  Condition: '健康状况',
};

const ZH_ACTION_LABELS = {
  created: '创建',
  updated: '更新',
  deleted: '删除',
  viewed: '查看',
  downloaded: '下载',
  login: '登录',
};

const isChinese = language => String(language || '').startsWith('zh');

export function formatSystemStatus(status, language) {
  if (!status) return status;
  const normalized = String(status).toLowerCase();
  return isChinese(language) ? ZH_STATUS_LABELS[normalized] || status : status;
}

export function formatSystemUptime(uptime, language) {
  if (!uptime) return uptime;
  if (!isChinese(language)) return uptime;
  const match = String(uptime)
    .trim()
    .match(/^(\d+)\s+(minute|minutes|hour|hours|day|days)$/i);
  if (!match) return uptime;
  const count = Number(match[1]);
  const unit = UPTIME_UNITS[match[2].toLowerCase()];
  const labels = { minute: '分钟', hour: '小时', day: '天' };
  return `${count} ${labels[unit]}`;
}

function formatActivityDescription(description, language) {
  if (!isChinese(language)) return description;
  if (description === 'Versioned household privacy notice decision recorded') {
    return '已记录家庭健康档案隐私说明决定';
  }

  const loginMatch = description?.match(/^User logged in: (.+)$/);
  if (loginMatch) {
    return `用户登录：${loginMatch[1]}`;
  }

  const passwordMatch = description?.match(/^Password changed for user: (.+)$/);
  if (passwordMatch) {
    return `用户密码已修改：${passwordMatch[1]}`;
  }

  return description;
}

export function formatAdminActivity(activity, language) {
  const rawAction = activity.action || 'created';
  const action = rawAction.toLowerCase();
  return {
    description: formatActivityDescription(activity.description, language),
    modelName: isChinese(language)
      ? ZH_MODEL_LABELS[activity.model_name] || activity.model_name
      : activity.model_name,
    action: isChinese(language)
      ? ZH_ACTION_LABELS[action] || rawAction
      : rawAction,
  };
}
