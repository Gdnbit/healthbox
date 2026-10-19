import type {
  HouseholdHealthMetric,
  HouseholdHealthReport,
  HouseholdHealthSnapshot,
} from './types';

export type HouseholdHealthExportScope =
  | 'all-loaded'
  | 'recent-five-years'
  | 'latest-report';

export interface HouseholdHealthExportOptions {
  scope: HouseholdHealthExportScope;
  metricIds?: readonly string[];
  includeReports?: boolean;
}

export interface HouseholdHealthExportObservation {
  id: string;
  date: string;
  metricId: string;
  metricLabel: string;
  kind: HouseholdHealthMetric['kind'];
  displayValue: string;
  unit: string;
  status: string;
  sourceDocumentId: number | null;
}

export interface HouseholdHealthExportModel {
  subjectLabel: string;
  generatedAt: string;
  scope: HouseholdHealthExportScope;
  scopeLabel: string;
  dateRangeLabel: string;
  observations: HouseholdHealthExportObservation[];
  reports: HouseholdHealthReport[];
  sourceErrors: string[];
}

const scopeLabels: Record<HouseholdHealthExportScope, string> = {
  'all-loaded': '全部已加载面板数据',
  'recent-five-years': '最近 5 年面板数据',
  'latest-report': '最近一份报告及关联指标',
};

const validTime = (value: string): number | null => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

const datePart = (value: string): string => value.slice(0, 10);

const subtractUtcYears = (value: string, years: number): number | null => {
  const time = validTime(value);
  if (time === null) return null;
  const date = new Date(time);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.getTime();
};

const observationValue = (
  value: number,
  secondaryValue: number | null
): string =>
  secondaryValue === null ? String(value) : `${value}/${secondaryValue}`;

const latestReport = (
  reports: readonly HouseholdHealthReport[]
): HouseholdHealthReport | null =>
  [...reports].sort((a, b) => {
    const dateDelta =
      (validTime(b.date) ?? -Infinity) - (validTime(a.date) ?? -Infinity);
    return dateDelta || b.sourceDocumentId - a.sourceDocumentId;
  })[0] ?? null;

const latestDataDate = (
  metrics: readonly HouseholdHealthMetric[],
  reports: readonly HouseholdHealthReport[]
): string | null => {
  const dates = [
    ...metrics.flatMap(metric => metric.points.map(point => point.date)),
    ...reports.map(report => report.date),
  ]
    .filter(value => validTime(value) !== null)
    .sort((a, b) => (validTime(a) ?? 0) - (validTime(b) ?? 0));
  return dates[dates.length - 1] ?? null;
};

const resolveDateRange = (
  observations: readonly HouseholdHealthExportObservation[],
  reports: readonly HouseholdHealthReport[]
): string => {
  const dates = [
    ...observations.map(item => item.date),
    ...reports.map(item => item.date),
  ]
    .filter(value => validTime(value) !== null)
    .map(datePart)
    .sort();

  if (dates.length === 0) return '暂无可导出的日期';
  if (dates[0] === dates[dates.length - 1]) return dates[0];
  return `${dates[0]}—${dates[dates.length - 1]}`;
};

export const buildHouseholdHealthExportModel = (
  subjectLabel: string,
  snapshot: HouseholdHealthSnapshot,
  options: HouseholdHealthExportOptions,
  generatedAt = new Date().toISOString()
): HouseholdHealthExportModel => {
  const selectedIds = new Set(
    options.metricIds ?? snapshot.metrics.map(metric => metric.id)
  );
  const selectedMetrics = snapshot.metrics.filter(metric =>
    selectedIds.has(metric.id)
  );
  const newestReport = latestReport(snapshot.reports);
  const newestDate = latestDataDate(selectedMetrics, snapshot.reports);
  const recentCutoff =
    options.scope === 'recent-five-years' && newestDate
      ? subtractUtcYears(newestDate, 5)
      : null;

  const observations = selectedMetrics
    .flatMap(metric =>
      metric.points.flatMap(point => {
        const pointTime = validTime(point.date);
        const inScope =
          options.scope === 'latest-report'
            ? newestReport !== null &&
              point.sourceDocumentId === newestReport.sourceDocumentId
            : recentCutoff === null ||
              (pointTime !== null && pointTime >= recentCutoff);
        if (!inScope) return [];

        return [
          {
            id: point.id,
            date: datePart(point.date),
            metricId: metric.id,
            metricLabel: metric.label,
            kind: metric.kind,
            displayValue: observationValue(point.value, point.secondaryValue),
            unit: metric.unit,
            status: point.status || '未记录',
            sourceDocumentId: point.sourceDocumentId,
          } satisfies HouseholdHealthExportObservation,
        ];
      })
    )
    .sort(
      (a, b) =>
        (validTime(a.date) ?? 0) - (validTime(b.date) ?? 0) ||
        a.metricLabel.localeCompare(b.metricLabel, 'zh-CN') ||
        a.id.localeCompare(b.id)
    );

  const reports =
    options.includeReports === false
      ? []
      : snapshot.reports
          .filter(report => {
            if (options.scope === 'latest-report') {
              return report.sourceDocumentId === newestReport?.sourceDocumentId;
            }
            if (recentCutoff === null) return true;
            const reportTime = validTime(report.date);
            return reportTime !== null && reportTime >= recentCutoff;
          })
          .sort(
            (a, b) =>
              (validTime(a.date) ?? 0) - (validTime(b.date) ?? 0) ||
              a.sourceDocumentId - b.sourceDocumentId
          );

  return {
    subjectLabel: subjectLabel || '未命名成员',
    generatedAt,
    scope: options.scope,
    scopeLabel: scopeLabels[options.scope],
    dateRangeLabel: resolveDateRange(observations, reports),
    observations,
    reports,
    sourceErrors: snapshot.errors.map(
      error => `${error.section}: ${error.message}`
    ),
  };
};

const neutralizeSpreadsheetFormula = (value: string): string =>
  /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;

const csvCell = (value: string | number, trustedNumeric = false): string => {
  const raw = String(value);
  const safe = trustedNumeric ? raw : neutralizeSpreadsheetFormula(raw);
  return `"${safe.replace(/"/g, '""')}"`;
};

export const renderHouseholdHealthExportCsv = (
  model: HouseholdHealthExportModel
): string => {
  const lines = [
    [csvCell('家庭健康面板摘要'), csvCell(model.scopeLabel)].join(','),
    [csvCell('主体'), csvCell(model.subjectLabel)].join(','),
    [csvCell('生成时间'), csvCell(model.generatedAt)].join(','),
    [csvCell('时间范围'), csvCell(model.dateRangeLabel)].join(','),
    [
      csvCell('数据完整性'),
      csvCell(
        model.sourceErrors.length === 0
          ? '已加载分区未报告错误'
          : `有 ${model.sourceErrors.length} 个数据分区未完整加载`
      ),
    ].join(','),
    '',
    [
      '记录类型',
      '日期',
      '项目',
      '数值',
      '单位',
      '状态',
      '机构/来源',
      '来源文档ID',
    ]
      .map(value => csvCell(value))
      .join(','),
  ];

  for (const observation of model.observations) {
    lines.push(
      [
        csvCell(observation.kind === 'vital' ? '生命体征' : '检验指标'),
        csvCell(observation.date),
        csvCell(observation.metricLabel),
        csvCell(observation.displayValue),
        csvCell(observation.unit),
        csvCell(observation.status),
        csvCell(
          observation.sourceDocumentId === null
            ? '未关联报告原件'
            : `来源文档 #${observation.sourceDocumentId}`
        ),
        observation.sourceDocumentId === null
          ? csvCell('')
          : csvCell(observation.sourceDocumentId, true),
      ].join(',')
    );
  }

  for (const report of model.reports) {
    lines.push(
      [
        csvCell('报告原件'),
        csvCell(datePart(report.date)),
        csvCell(report.title),
        csvCell(''),
        csvCell(''),
        csvCell(report.statusLabel),
        csvCell(report.facility),
        csvCell(report.sourceDocumentId, true),
      ].join(',')
    );
  }

  lines.push(
    '',
    [
      csvCell('说明'),
      csvCell(
        '本文件整理当前家庭健康面板已加载的正式记录，不构成诊断或治疗建议。'
      ),
    ].join(',')
  );
  return `\ufeff${lines.join('\r\n')}\r\n`;
};

export const renderHouseholdHealthExportText = (
  model: HouseholdHealthExportModel
): string => {
  const observations =
    model.observations.length === 0
      ? ['- 暂无所选指标记录']
      : model.observations.map(
          item =>
            `- ${item.date}｜${item.metricLabel}：${item.displayValue}${
              item.unit ? ` ${item.unit}` : ''
            }｜来源：${
              item.sourceDocumentId === null
                ? '未关联报告原件'
                : `文档 #${item.sourceDocumentId}`
            }`
        );
  const reports =
    model.reports.length === 0
      ? ['- 未包含报告来源']
      : model.reports.map(
          item =>
            `- ${datePart(item.date)}｜${item.title}｜${item.facility}｜文档 #${
              item.sourceDocumentId
            }`
        );

  return [
    '# 家庭健康面板摘要',
    `主体：${model.subjectLabel}`,
    `范围：${model.scopeLabel}`,
    `日期：${model.dateRangeLabel}`,
    `生成时间：${model.generatedAt}`,
    `数据完整性：${
      model.sourceErrors.length === 0
        ? '已加载分区未报告错误'
        : `有 ${model.sourceErrors.length} 个数据分区未完整加载`
    }`,
    '',
    '## 指标记录',
    ...observations,
    '',
    '## 报告来源',
    ...reports,
    '',
    '说明：本摘要只整理当前面板已加载的正式记录，不构成诊断或治疗建议。',
  ].join('\n');
};

export const buildHouseholdHealthExportFilename = (
  generatedAt: string
): string => {
  const safeDate = datePart(generatedAt).replace(/[^0-9-]/g, '') || 'export';
  return `household-health-summary-${safeDate}.csv`;
};
