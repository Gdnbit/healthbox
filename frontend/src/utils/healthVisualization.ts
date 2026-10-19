import type {
  ComponentCatalogEntry,
  ResultType,
  TrendDataPoint,
} from '../services/api/labTestComponentApi';

export const LONG_TERM_TREND_POINT_THRESHOLD = 8;

export type VisualizationMode =
  | 'empty'
  | 'snapshot'
  | 'comparison'
  | 'trend'
  | 'qualitative';

export interface CatalogSummary {
  totalMetrics: number;
  totalReadings: number;
  attentionCount: number;
  longTermTrendCount: number;
  latestDate: string | null;
}

export interface CatalogFilters {
  search?: string;
  status?: string;
  category?: string;
}

const ATTENTION_STATUSES = new Set([
  'abnormal',
  'borderline',
  'critical',
  'high',
  'low',
]);

const normalize = (value?: string | null) => (value || '').trim().toLowerCase();

export const isAttentionStatus = (status?: string | null): boolean =>
  ATTENTION_STATUSES.has(normalize(status));

export function selectVisualizationMode(
  dataPoints: TrendDataPoint[],
  resultType?: ResultType | null
): VisualizationMode {
  if (resultType && resultType !== 'quantitative') {
    const hasQualitativeContent = dataPoints.some(
      point =>
        (point.qualitative_value !== null &&
          point.qualitative_value !== undefined &&
          String(point.qualitative_value).trim() !== '') ||
        Boolean(point.textual_value?.trim())
    );
    return hasQualitativeContent ? 'qualitative' : 'empty';
  }

  const validCount = dataPoints.filter(
    point => typeof point.value === 'number' && Number.isFinite(point.value)
  ).length;

  if (validCount === 0) return 'empty';
  if (validCount === 1) return 'snapshot';
  if (validCount < LONG_TERM_TREND_POINT_THRESHOLD) return 'comparison';
  return 'trend';
}

export function buildCatalogSummary(
  items: ComponentCatalogEntry[]
): CatalogSummary {
  const validDates = items
    .map(item => item.latest_date)
    .filter((date): date is string => Boolean(date))
    .sort();

  return {
    totalMetrics: items.length,
    totalReadings: items.reduce(
      (sum, item) => sum + Math.max(0, item.reading_count || 0),
      0
    ),
    attentionCount: items.filter(item => isAttentionStatus(item.status)).length,
    longTermTrendCount: items.filter(
      item =>
        (item.result_type || 'quantitative') === 'quantitative' &&
        item.reading_count >= LONG_TERM_TREND_POINT_THRESHOLD
    ).length,
    latestDate: validDates.at(-1) || null,
  };
}

export function filterCatalogItems(
  items: ComponentCatalogEntry[],
  filters: CatalogFilters
): ComponentCatalogEntry[] {
  const search = normalize(filters.search);
  const status = normalize(filters.status);
  const category = normalize(filters.category);

  return items.filter(item => {
    const matchesSearch =
      !search ||
      normalize(item.test_name).includes(search) ||
      normalize(item.abbreviation).includes(search);
    const matchesStatus =
      !status ||
      status === 'all' ||
      (status === 'attention'
        ? isAttentionStatus(item.status)
        : normalize(item.status) === status);
    const matchesCategory =
      !category || category === 'all' || normalize(item.category) === category;

    return matchesSearch && matchesStatus && matchesCategory;
  });
}

export function getDistinctUnits(dataPoints: TrendDataPoint[]): string[] {
  const units = new Map<string, string>();
  dataPoints.forEach(point => {
    const displayUnit = (point.unit || '').trim();
    const key = normalize(displayUnit);
    if (key && !units.has(key)) units.set(key, displayUnit);
  });
  return Array.from(units.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
}

const referenceSignature = (point: TrendDataPoint) =>
  JSON.stringify([
    point.ref_range_min ?? null,
    point.ref_range_max ?? null,
    normalize(point.ref_range_text),
  ]);

export function hasReferenceRangeChanges(
  dataPoints: TrendDataPoint[]
): boolean {
  return new Set(dataPoints.map(referenceSignature)).size > 1;
}
