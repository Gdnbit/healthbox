import type {
  VitalDataPoint,
  VitalTrendResponse,
} from '../components/medical/vitals/types';
import type { HealthBaselineComparison } from './healthBaselineComparison';

export const VITAL_VISUAL_EXPORT_LIMIT = 500;

export type VitalTrendExportMode =
  | 'empty'
  | 'snapshot'
  | 'comparison'
  | 'trend';

export interface VitalTrendExportLabels {
  member: string;
  generatedAt: string;
  vitalType: string;
  timeRange: string;
  mode: string;
  modeLabels: Record<VitalTrendExportMode, string>;
  observations: string;
  date: string;
  primaryValue: string;
  secondaryValue: string;
  displayValue: string;
  unit: string;
  context: string;
  recordId: string;
  primarySeries: string;
  secondarySeries: string;
  noContext: string;
  disclaimer: string;
  visualLimit: string;
  baselineRecord: string;
  targetRecord: string;
  absoluteChange: string;
}

export interface VitalTrendExportObservation {
  id: number;
  date: string;
  primaryValue: number;
  secondaryValue: number | null;
  displayValue: string;
  unit: string;
  context: string;
}

export interface VitalTrendExportModel {
  vitalType: string;
  vitalTypeLabel: string;
  patientLabel: string;
  timeRangeLabel: string;
  generatedAt: string;
  unit: string;
  mode: VitalTrendExportMode;
  dualSeries: boolean;
  visualExportAllowed: boolean;
  observations: VitalTrendExportObservation[];
  baselineSummary: {
    baselineId: number;
    targetId: number;
    baselineValue: string;
    targetValue: string;
    change: string;
  } | null;
  fileStem: string;
}

interface VitalTrendExportOptions {
  patientLabel: string;
  timeRangeLabel: string;
  generatedAt?: Date;
  comparison?: HealthBaselineComparison;
}

const EMPTY_VALUE = '—';

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const formatDelta = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? EMPTY_VALUE
    : String(Number(value.toPrecision(12)));

const dateTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const safeSlug = (value: string): string => {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return normalized || 'vital';
};

const utcFileTimestamp = (value: Date): string =>
  value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

const modeForCount = (count: number): VitalTrendExportMode => {
  if (count === 0) return 'empty';
  if (count === 1) return 'snapshot';
  if (count < 8) return 'comparison';
  return 'trend';
};

const observationFromPoint = (
  point: VitalDataPoint,
  unit: string
): VitalTrendExportObservation => {
  const secondaryValue = finiteOrNull(point.secondary_value);
  return {
    id: point.id,
    date: point.recorded_date?.trim() || EMPTY_VALUE,
    primaryValue: point.value,
    secondaryValue,
    displayValue:
      secondaryValue === null
        ? String(point.value)
        : `${point.value}/${secondaryValue}`,
    unit: unit.trim() || EMPTY_VALUE,
    context: point.glucose_context?.trim() || EMPTY_VALUE,
  };
};

export function buildVitalTrendExportModel(
  trend: VitalTrendResponse,
  options: VitalTrendExportOptions
): VitalTrendExportModel {
  const generatedAt = options.generatedAt || new Date();
  const observations = trend.data_points
    .map((point, index) => ({ point, index }))
    .sort((left, right) => {
      const difference =
        dateTimestamp(left.point.recorded_date) -
        dateTimestamp(right.point.recorded_date);
      return difference || left.index - right.index;
    })
    .map(({ point }) => observationFromPoint(point, trend.unit));
  const comparison = options.comparison;
  const baselineSummary =
    comparison?.reason === null && comparison.baseline && comparison.target
      ? {
          baselineId: comparison.baseline.id,
          targetId: comparison.target.id,
          baselineValue: comparison.baseline.displayValue || EMPTY_VALUE,
          targetValue: comparison.target.displayValue || EMPTY_VALUE,
          change:
            comparison.secondaryDelta === null
              ? formatDelta(comparison.primaryDelta)
              : `${formatDelta(comparison.primaryDelta)}/${formatDelta(comparison.secondaryDelta)}`,
        }
      : null;

  return {
    vitalType: trend.vital_type,
    vitalTypeLabel: trend.vital_type_label.trim() || trend.vital_type,
    patientLabel: options.patientLabel.trim() || EMPTY_VALUE,
    timeRangeLabel: options.timeRangeLabel.trim() || EMPTY_VALUE,
    generatedAt: generatedAt.toISOString(),
    unit: trend.unit.trim() || EMPTY_VALUE,
    mode: modeForCount(observations.length),
    dualSeries: observations.some(item => item.secondaryValue !== null),
    visualExportAllowed:
      observations.length > 0 &&
      observations.length <= VITAL_VISUAL_EXPORT_LIMIT,
    observations,
    baselineSummary,
    fileStem: `health-vital-${safeSlug(trend.vital_type)}-${utcFileTimestamp(
      generatedAt
    )}`,
  };
}

export function buildVitalTrendExportFilename(
  model: VitalTrendExportModel,
  extension: 'svg' | 'csv'
): string {
  return `${model.fileStem}.${extension}`;
}

const neutralizeSpreadsheetFormula = (value: string): string =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const csvCell = (value: string | number, trustedNumeric = false): string => {
  const raw = String(value);
  const safe = trustedNumeric ? raw : neutralizeSpreadsheetFormula(raw);
  return `"${safe.replace(/"/g, '""')}"`;
};

export function renderVitalTrendCsv(
  model: VitalTrendExportModel,
  labels: VitalTrendExportLabels
): string {
  const metadata: Array<[string, string | number]> = [
    [labels.vitalType, model.vitalTypeLabel],
    [labels.member, model.patientLabel],
    [labels.generatedAt, model.generatedAt],
    [labels.timeRange, model.timeRangeLabel],
    [labels.mode, labels.modeLabels[model.mode]],
    [labels.unit, model.unit],
    [labels.observations, model.observations.length],
    ...(model.baselineSummary
      ? ([
          [
            labels.baselineRecord,
            `#${model.baselineSummary.baselineId} · ${model.baselineSummary.baselineValue}`,
          ],
          [
            labels.targetRecord,
            `#${model.baselineSummary.targetId} · ${model.baselineSummary.targetValue}`,
          ],
          [labels.absoluteChange, model.baselineSummary.change],
        ] as Array<[string, string | number]>)
      : []),
    [labels.disclaimer, labels.disclaimer],
  ];
  const lines = metadata.map(([key, value]) =>
    [csvCell(key), csvCell(value)].join(',')
  );
  lines.push('');
  lines.push(
    [
      labels.date,
      labels.primaryValue,
      labels.secondaryValue,
      labels.displayValue,
      labels.unit,
      labels.context,
      labels.recordId,
    ]
      .map(value => csvCell(value))
      .join(',')
  );
  for (const observation of model.observations) {
    lines.push(
      [
        csvCell(observation.date),
        csvCell(observation.primaryValue, true),
        observation.secondaryValue === null
          ? csvCell(EMPTY_VALUE)
          : csvCell(observation.secondaryValue, true),
        csvCell(observation.displayValue),
        csvCell(observation.unit),
        csvCell(
          observation.context === EMPTY_VALUE
            ? labels.noContext
            : observation.context
        ),
        csvCell(observation.id, true),
      ].join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

const escapeXml = (value: string | number): string =>
  String(value).replace(/[&<>"']/g, character => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return replacements[character];
  });

const numberRange = (
  observations: VitalTrendExportObservation[]
): { min: number; max: number } => {
  const values = observations.flatMap(item =>
    item.secondaryValue === null
      ? [item.primaryValue]
      : [item.primaryValue, item.secondaryValue]
  );
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  const padding = (max - min) * 0.08;
  return { min: min - padding, max: max + padding };
};

export function renderVitalTrendSvg(
  model: VitalTrendExportModel,
  labels: VitalTrendExportLabels
): string {
  if (!model.visualExportAllowed) throw new Error(labels.visualLimit);

  const width = 1200;
  const chartLeft = 92;
  const chartTop = 215;
  const chartWidth = 1020;
  const chartHeight = 250;
  const tableTop = 525;
  const rowHeight = 30;
  const height = tableTop + 72 + model.observations.length * rowHeight + 78;
  const range = numberRange(model.observations);
  const xFor = (index: number): number =>
    model.observations.length === 1
      ? chartLeft + chartWidth / 2
      : chartLeft + (index * chartWidth) / (model.observations.length - 1);
  const yFor = (value: number): number =>
    chartTop + ((range.max - value) / (range.max - range.min)) * chartHeight;

  const primaryPoints = model.observations
    .map((item, index) => `${xFor(index)},${yFor(item.primaryValue)}`)
    .join(' ');
  const secondaryPoints = model.observations
    .map((item, index) =>
      item.secondaryValue === null
        ? null
        : `${xFor(index)},${yFor(item.secondaryValue)}`
    )
    .filter((value): value is string => value !== null)
    .join(' ');

  const series: string[] = [];
  if (model.mode === 'trend') {
    series.push(
      `<polyline data-series="primary" points="${primaryPoints}" fill="none" stroke="#228be6" stroke-width="3"/>`
    );
    if (model.dualSeries) {
      series.push(
        `<polyline data-series="secondary" points="${secondaryPoints}" fill="none" stroke="#fa5252" stroke-width="3"/>`
      );
    }
  }
  series.push(
    `<g data-series="primary">${model.observations
      .map(
        (item, index) =>
          `<circle cx="${xFor(index)}" cy="${yFor(item.primaryValue)}" r="5" fill="#228be6"/>`
      )
      .join('')}</g>`
  );
  if (model.dualSeries) {
    series.push(
      `<g data-series="secondary">${model.observations
        .map((item, index) =>
          item.secondaryValue === null
            ? ''
            : `<circle cx="${xFor(index)}" cy="${yFor(item.secondaryValue)}" r="5" fill="#fa5252"/>`
        )
        .join('')}</g>`
    );
  }

  const columns = [180, 130, 130, 160, 100, 250, 100];
  const headers = [
    labels.date,
    labels.primaryValue,
    labels.secondaryValue,
    labels.displayValue,
    labels.unit,
    labels.context,
    labels.recordId,
  ];
  const tableRows = [
    headers.map((header, column) => {
      const x =
        48 + columns.slice(0, column).reduce((sum, item) => sum + item, 0);
      return `<rect x="${x}" y="${tableTop + 34}" width="${columns[column]}" height="34" fill="#e7f5ff" stroke="#adb5bd"/><text x="${x + 8}" y="${tableTop + 56}" font-size="12" font-weight="700" fill="#1d2939">${escapeXml(header)}</text>`;
    }),
    ...model.observations.map((item, row) => {
      const values: Array<string | number> = [
        item.date,
        item.primaryValue,
        item.secondaryValue ?? EMPTY_VALUE,
        item.displayValue,
        item.unit,
        item.context === EMPTY_VALUE ? labels.noContext : item.context,
        item.id,
      ];
      const y = tableTop + 68 + row * rowHeight;
      return values.map((value, column) => {
        const x =
          48 + columns.slice(0, column).reduce((sum, item) => sum + item, 0);
        return `<rect x="${x}" y="${y}" width="${columns[column]}" height="${rowHeight}" fill="#ffffff" stroke="#dee2e6"/><text x="${x + 8}" y="${y + 20}" font-size="12" fill="#344054">${escapeXml(value)}</text>`;
      });
    }),
  ]
    .flat(2)
    .join('');

  const description = `${model.vitalTypeLabel}; ${model.patientLabel}; ${model.observations.length} ${labels.observations}; ${labels.disclaimer}`;
  const baselineLine = model.baselineSummary
    ? `${labels.baselineRecord} #${model.baselineSummary.baselineId}: ${model.baselineSummary.baselineValue} · ${labels.targetRecord} #${model.baselineSummary.targetId}: ${model.baselineSummary.targetValue} · ${labels.absoluteChange}: ${model.baselineSummary.change}`
    : '';
  const secondaryLegend = model.dualSeries
    ? `<circle cx="758" cy="179" r="5" fill="#fa5252"/><text x="770" y="184" font-size="14" fill="#475467">${escapeXml(labels.secondarySeries)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="vital-export-title vital-export-desc"><title id="vital-export-title">${escapeXml(model.vitalTypeLabel)}</title><desc id="vital-export-desc">${escapeXml(description)}</desc><rect width="100%" height="100%" fill="#ffffff"/><text x="48" y="52" font-size="30" font-weight="700" fill="#101828">${escapeXml(model.vitalTypeLabel)}</text><text x="48" y="84" font-size="16" fill="#475467">${escapeXml(labels.member)}: ${escapeXml(model.patientLabel)}</text><text x="48" y="110" font-size="14" fill="#667085">${escapeXml(labels.generatedAt)}: ${escapeXml(model.generatedAt)}</text><text x="600" y="84" font-size="16" fill="#475467">${escapeXml(labels.timeRange)}: ${escapeXml(model.timeRangeLabel)}</text><text x="600" y="110" font-size="14" fill="#667085">${escapeXml(labels.mode)}: ${escapeXml(labels.modeLabels[model.mode])} · ${escapeXml(labels.unit)}: ${escapeXml(model.unit)}</text>${baselineLine ? `<text x="48" y="136" font-size="14" fill="#475467">${escapeXml(baselineLine)}</text>` : ''}<circle cx="568" cy="179" r="5" fill="#228be6"/><text x="580" y="184" font-size="14" fill="#475467">${escapeXml(labels.primarySeries)}</text>${secondaryLegend}<line x1="${chartLeft}" y1="${chartTop + chartHeight}" x2="${chartLeft + chartWidth}" y2="${chartTop + chartHeight}" stroke="#98a2b3"/><line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartTop + chartHeight}" stroke="#98a2b3"/>${series.join('')}${model.observations
    .map(
      (item, index) =>
        `<text x="${xFor(index)}" y="${chartTop + chartHeight + 22}" text-anchor="middle" font-size="11" fill="#667085">${escapeXml(item.date.slice(0, 10))}</text>`
    )
    .join(
      ''
    )}<g data-export-section="record-table"><text x="48" y="${tableTop + 22}" font-size="20" font-weight="700" fill="#101828">${escapeXml(labels.observations)}</text>${tableRows}</g><text x="48" y="${height - 32}" font-size="15" font-weight="600" fill="#c92a2a">${escapeXml(labels.disclaimer)}</text></svg>`;
}
