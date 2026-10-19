import type {
  TrendDataPoint,
  TrendResponse,
} from '../services/api/labTestComponentApi';
import {
  getDistinctUnits,
  selectVisualizationMode,
  type VisualizationMode,
} from './healthVisualization';
import type { HealthBaselineComparison } from './healthBaselineComparison';

export interface HealthMetricExportLabels {
  metric: string;
  member: string;
  generatedAt: string;
  mode: string;
  category: string;
  dateRange: string;
  baselineRecord: string;
  targetRecord: string;
  absoluteChange: string;
  modeLabels: Record<VisualizationMode, string>;
  observations: string;
  date: string;
  value: string;
  unit: string;
  status: string;
  referenceRange: string;
  sourceRecord: string;
  sourceId: string;
  noData: string;
  unitMismatch: string;
  disclaimer: string;
}

export interface HealthMetricExportObservation {
  id: number;
  date: string;
  displayValue: string;
  numericValue: number | null;
  unit: string;
  status: string;
  referenceRange: string;
  sourceName: string;
  sourceId: number;
}

export interface HealthMetricExportModel {
  testName: string;
  category: string;
  unit: string;
  patientLabel: string;
  generatedAt: string;
  dateRangeLabel: string;
  baselineSummary: {
    baselineId: number;
    targetId: number;
    baselineValue: string;
    targetValue: string;
    change: string;
  } | null;
  mode: VisualizationMode;
  unitMismatch: boolean;
  observations: HealthMetricExportObservation[];
  fileStem: string;
}

interface BuildHealthMetricExportOptions {
  patientLabel: string;
  generatedAt?: Date;
  dateRangeLabel?: string;
  comparison?: HealthBaselineComparison;
}

const EMPTY_VALUE = '—';

const clinicalDate = (point: TrendDataPoint): string =>
  point.recorded_date ||
  point.lab_result.completed_date ||
  point.created_at ||
  '';

const formatNumber = (value?: number | null): string =>
  typeof value === 'number' && Number.isFinite(value)
    ? String(Number(value.toPrecision(12)))
    : EMPTY_VALUE;

const formatReferenceRange = (point: TrendDataPoint): string => {
  if (point.ref_range_text?.trim()) return point.ref_range_text.trim();
  if (point.ref_range_min !== null && point.ref_range_min !== undefined) {
    if (point.ref_range_max !== null && point.ref_range_max !== undefined) {
      return `${formatNumber(point.ref_range_min)}–${formatNumber(point.ref_range_max)}`;
    }
    return `≥ ${formatNumber(point.ref_range_min)}`;
  }
  if (point.ref_range_max !== null && point.ref_range_max !== undefined) {
    return `≤ ${formatNumber(point.ref_range_max)}`;
  }
  return EMPTY_VALUE;
};

const displayPointValue = (point: TrendDataPoint): string => {
  if (typeof point.value === 'number' && Number.isFinite(point.value)) {
    return formatNumber(point.value);
  }
  return (
    point.qualitative_value?.trim() ||
    point.textual_value?.trim() ||
    EMPTY_VALUE
  );
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
  return normalized || 'metric';
};

const utcFileTimestamp = (value: Date): string =>
  value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

export function buildHealthMetricExportModel(
  data: TrendResponse,
  options: BuildHealthMetricExportOptions
): HealthMetricExportModel {
  const generatedAt = options.generatedAt || new Date();
  const sortedPoints = [...data.data_points].sort((left, right) =>
    clinicalDate(left).localeCompare(clinicalDate(right))
  );
  const resultType = data.result_type || data.statistics.result_type;
  const mode = selectVisualizationMode(sortedPoints, resultType);
  const units = getDistinctUnits(sortedPoints);
  const comparison = options.comparison;
  const baselineSummary =
    comparison?.reason === null && comparison.baseline && comparison.target
      ? {
          baselineId: comparison.baseline.id,
          targetId: comparison.target.id,
          baselineValue: comparison.baseline.displayValue || EMPTY_VALUE,
          targetValue: comparison.target.displayValue || EMPTY_VALUE,
          change:
            comparison.kind === 'qualitative'
              ? `${comparison.baseline.displayValue || EMPTY_VALUE} → ${comparison.target.displayValue || EMPTY_VALUE}`
              : comparison.secondaryDelta === null
                ? formatNumber(comparison.primaryDelta)
                : `${formatNumber(comparison.primaryDelta)}/${formatNumber(comparison.secondaryDelta)}`,
        }
      : null;

  return {
    testName: data.test_name.trim() || EMPTY_VALUE,
    category: data.category?.trim() || EMPTY_VALUE,
    unit: data.unit?.trim() || units[0] || EMPTY_VALUE,
    patientLabel: options.patientLabel.trim() || EMPTY_VALUE,
    generatedAt: generatedAt.toISOString(),
    dateRangeLabel: options.dateRangeLabel?.trim() || EMPTY_VALUE,
    baselineSummary,
    mode,
    unitMismatch: units.length > 1,
    observations: sortedPoints.map(point => ({
      id: point.id,
      date: clinicalDate(point) || EMPTY_VALUE,
      displayValue: displayPointValue(point),
      numericValue:
        typeof point.value === 'number' && Number.isFinite(point.value)
          ? point.value
          : null,
      unit: point.unit?.trim() || data.unit?.trim() || EMPTY_VALUE,
      status: point.status?.trim() || 'unknown',
      referenceRange: formatReferenceRange(point),
      sourceName: point.lab_result.test_name?.trim() || EMPTY_VALUE,
      sourceId: point.lab_result.id,
    })),
    fileStem: `health-metric-${safeSlug(data.test_name)}-${utcFileTimestamp(
      generatedAt
    )}`,
  };
}

export function buildHealthMetricFilename(
  model: HealthMetricExportModel,
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

export function renderHealthMetricCsv(
  model: HealthMetricExportModel,
  labels: HealthMetricExportLabels
): string {
  const metadata = [
    [labels.metric, model.testName],
    [labels.member, model.patientLabel],
    [labels.generatedAt, model.generatedAt],
    [labels.mode, labels.modeLabels[model.mode]],
    [labels.category, model.category],
    [labels.dateRange, model.dateRangeLabel],
    [labels.unit, model.unit],
    [labels.observations, model.observations.length],
    ...(model.baselineSummary
      ? [
          [
            labels.baselineRecord,
            `#${model.baselineSummary.baselineId} · ${model.baselineSummary.baselineValue}`,
          ],
          [
            labels.targetRecord,
            `#${model.baselineSummary.targetId} · ${model.baselineSummary.targetValue}`,
          ],
          [labels.absoluteChange, model.baselineSummary.change],
        ]
      : []),
    [labels.disclaimer, labels.disclaimer],
  ];
  const header = [
    labels.date,
    labels.value,
    labels.unit,
    labels.status,
    labels.referenceRange,
    labels.sourceRecord,
    labels.sourceId,
  ];
  const lines = metadata.map(([key, value]) =>
    [csvCell(String(key)), csvCell(value as string | number)].join(',')
  );
  lines.push('');
  lines.push(header.map(value => csvCell(value)).join(','));
  for (const observation of model.observations) {
    lines.push(
      [
        csvCell(observation.date),
        observation.numericValue === null
          ? csvCell(observation.displayValue)
          : csvCell(observation.numericValue, true),
        csvCell(observation.unit),
        csvCell(observation.status),
        csvCell(observation.referenceRange),
        csvCell(observation.sourceName),
        csvCell(observation.sourceId, true),
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

const svgText = (
  x: number,
  y: number,
  text: string | number,
  attributes = ''
): string => `<text x="${x}" y="${y}" ${attributes}>${escapeXml(text)}</text>`;

const chartSeries = (
  model: HealthMetricExportModel,
  labels: HealthMetricExportLabels,
  top: number
): string => {
  const left = 92;
  const width = 1040;
  const height = 280;
  const bottom = top + height;

  if (model.unitMismatch) {
    return `<g data-series-kind="unit-mismatch">${svgText(
      left,
      top + 120,
      labels.unitMismatch,
      'font-size="22" fill="#c92a2a"'
    )}</g>`;
  }
  if (model.mode === 'empty') {
    return `<g data-series-kind="empty">${svgText(
      left,
      top + 120,
      labels.noData,
      'font-size="22" fill="#667085"'
    )}</g>`;
  }
  if (model.mode === 'qualitative') {
    const rows = model.observations
      .map((item, index) => {
        const y = top + 42 + index * 30;
        return `${svgText(left, y, item.date, 'font-size="15" fill="#475467"')}${svgText(
          left + 190,
          y,
          item.displayValue,
          'font-size="16" font-weight="600" fill="#101828"'
        )}`;
      })
      .join('');
    return `<g data-series-kind="qualitative">${rows}</g>`;
  }
  if (model.mode === 'snapshot') {
    const item = model.observations.find(
      observation => observation.numericValue !== null
    );
    return `<g data-series-kind="snapshot">${svgText(
      600,
      top + 125,
      item?.displayValue || EMPTY_VALUE,
      'text-anchor="middle" font-size="70" font-weight="700" fill="#1971c2"'
    )}${svgText(
      600,
      top + 170,
      item?.unit || model.unit,
      'text-anchor="middle" font-size="22" fill="#475467"'
    )}</g>`;
  }

  const numeric = model.observations.filter(
    observation => observation.numericValue !== null
  );
  const values = numeric.map(item => item.numericValue as number);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  const yFor = (value: number) => bottom - ((value - minimum) / span) * height;
  const xFor = (index: number) =>
    numeric.length === 1
      ? left + width / 2
      : left + (index / (numeric.length - 1)) * width;
  const axes = `<path d="M ${left} ${top} V ${bottom} H ${left + width}" fill="none" stroke="#98a2b3" stroke-width="1.5"/>`;
  const dateLabels = numeric
    .map((item, index) =>
      svgText(
        xFor(index),
        bottom + 24,
        item.date,
        'text-anchor="middle" font-size="11" fill="#667085"'
      )
    )
    .join('');

  if (model.mode === 'trend') {
    const points = numeric
      .map(
        (item, index) =>
          `${xFor(index).toFixed(2)},${yFor(item.numericValue as number).toFixed(2)}`
      )
      .join(' ');
    const dots = numeric
      .map(
        (item, index) =>
          `<circle cx="${xFor(index)}" cy="${yFor(
            item.numericValue as number
          )}" r="5" fill="#1971c2"/>`
      )
      .join('');
    return `<g data-series-kind="line">${axes}<polyline points="${points}" fill="none" stroke="#1971c2" stroke-width="4" stroke-linejoin="round"/>${dots}${dateLabels}</g>`;
  }

  const slot = width / Math.max(1, numeric.length);
  const zeroY = yFor(0);
  const bars = numeric
    .map((item, index) => {
      const valueY = yFor(item.numericValue as number);
      const x = left + index * slot + slot * 0.2;
      const barWidth = slot * 0.6;
      const y = Math.min(zeroY, valueY);
      const barHeight = Math.max(2, Math.abs(zeroY - valueY));
      const color = [
        'high',
        'low',
        'critical',
        'abnormal',
        'borderline',
      ].includes(item.status.toLowerCase())
        ? '#f08c00'
        : '#1971c2';
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${color}"/>`;
    })
    .join('');
  return `<g data-series-kind="bars">${axes}${bars}${dateLabels}</g>`;
};

export function renderHealthMetricSvg(
  model: HealthMetricExportModel,
  labels: HealthMetricExportLabels
): string {
  const width = 1200;
  const chartTop = 205;
  const tableTop = 555;
  const tableHeaderHeight = 34;
  const tableRowHeight = 30;
  const tableHeight =
    tableHeaderHeight + model.observations.length * tableRowHeight;
  const disclaimerY = tableTop + tableHeight + 52;
  const height = disclaimerY + 45;
  const columns = [
    { x: 48, width: 145, label: labels.date },
    { x: 193, width: 145, label: labels.value },
    { x: 338, width: 115, label: labels.unit },
    { x: 453, width: 125, label: labels.status },
    { x: 578, width: 180, label: labels.referenceRange },
    { x: 758, width: 330, label: labels.sourceRecord },
    { x: 1088, width: 64, label: labels.sourceId },
  ];
  const headerCells = columns
    .map(column => {
      return `<rect x="${column.x}" y="${tableTop}" width="${column.width}" height="${tableHeaderHeight}" fill="#e7f5ff" stroke="#adb5bd"/>${svgText(
        column.x + 8,
        tableTop + 22,
        column.label,
        'font-size="13" font-weight="700" fill="#1d2939"'
      )}`;
    })
    .join('');
  const bodyRows = model.observations
    .map((observation, rowIndex) => {
      const y = tableTop + tableHeaderHeight + rowIndex * tableRowHeight;
      const values = [
        observation.date,
        observation.displayValue,
        observation.unit,
        observation.status,
        observation.referenceRange,
        observation.sourceName,
        observation.sourceId,
      ];
      return columns
        .map(
          (column, columnIndex) =>
            `<rect x="${column.x}" y="${y}" width="${column.width}" height="${tableRowHeight}" fill="${
              rowIndex % 2 ? '#f8f9fa' : '#ffffff'
            }" stroke="#dee2e6"/>${svgText(
              column.x + 8,
              y + 20,
              values[columnIndex],
              'font-size="12" fill="#344054"'
            )}`
        )
        .join('');
    })
    .join('');
  const description = `${model.testName}; ${model.patientLabel}; ${model.observations.length} ${labels.observations}; ${labels.disclaimer}`;
  const baselineLine = model.baselineSummary
    ? `${labels.baselineRecord} #${model.baselineSummary.baselineId}: ${model.baselineSummary.baselineValue} · ${labels.targetRecord} #${model.baselineSummary.targetId}: ${model.baselineSummary.targetValue} · ${labels.absoluteChange}: ${model.baselineSummary.change}`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="metric-export-title metric-export-desc"><title id="metric-export-title">${escapeXml(
    model.testName
  )}</title><desc id="metric-export-desc">${escapeXml(
    description
  )}</desc><rect width="100%" height="100%" fill="#ffffff"/>${svgText(
    48,
    52,
    model.testName,
    'font-size="30" font-weight="700" fill="#101828"'
  )}${svgText(
    48,
    84,
    `${labels.member}: ${model.patientLabel}`,
    'font-size="16" fill="#475467"'
  )}${svgText(
    48,
    110,
    `${labels.generatedAt}: ${model.generatedAt}`,
    'font-size="14" fill="#667085"'
  )}${svgText(
    48,
    136,
    `${labels.dateRange}: ${model.dateRangeLabel}`,
    'font-size="14" fill="#667085"'
  )}${
    baselineLine
      ? svgText(48, 162, baselineLine, 'font-size="14" fill="#475467"')
      : ''
  }${svgText(
    600,
    84,
    `${labels.mode}: ${labels.modeLabels[model.mode]}`,
    'font-size="16" fill="#475467"'
  )}${svgText(
    600,
    110,
    `${labels.unit}: ${model.unit} · ${labels.observations}: ${model.observations.length}`,
    'font-size="14" fill="#667085"'
  )}${chartSeries(model, labels, chartTop)}<g data-export-section="source-table">${svgText(
    48,
    tableTop - 18,
    labels.observations,
    'font-size="20" font-weight="700" fill="#101828"'
  )}${headerCells}${bodyRows}</g>${svgText(
    48,
    disclaimerY,
    labels.disclaimer,
    'font-size="15" font-weight="600" fill="#c92a2a"'
  )}</svg>`;
}
