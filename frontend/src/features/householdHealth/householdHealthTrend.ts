import type { HouseholdHealthMetric, HouseholdHealthPoint } from './types';

export type HouseholdHealthTrendRange =
  | 'auto'
  | '3m'
  | '6m'
  | '1y'
  | '2y'
  | '5y'
  | 'all';

export interface HouseholdHealthDashboardPreferences {
  pinnedMetricIds: string[];
  rangesByMetricId: Record<string, HouseholdHealthTrendRange>;
}

export interface HouseholdHealthTrendRangeOption {
  value: HouseholdHealthTrendRange;
  label: string;
}

export type HouseholdHealthTrendDensity = 'sparse' | 'standard' | 'dense';

export interface HouseholdHealthTrendView {
  requestedRange: HouseholdHealthTrendRange;
  effectiveRange: Exclude<HouseholdHealthTrendRange, 'auto'>;
  points: HouseholdHealthPoint[];
  excludedPointIds: string[];
  actualRangeLabel: string;
  hasTrend: boolean;
  density: HouseholdHealthTrendDensity;
  displayReason: string;
  rangeReason: string;
}

export const HOUSEHOLD_HEALTH_TREND_RANGE_OPTIONS: HouseholdHealthTrendRangeOption[] =
  [
    { value: 'auto', label: '自动' },
    { value: '3m', label: '近 3 个月' },
    { value: '6m', label: '近 6 个月' },
    { value: '1y', label: '近 1 年' },
    { value: '2y', label: '近 2 年' },
    { value: '5y', label: '近 5 年' },
    { value: 'all', label: '全部' },
  ];

const RANGE_MONTHS: Record<
  Exclude<HouseholdHealthTrendRange, 'auto' | 'all'>,
  number
> = {
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '2y': 24,
  '5y': 60,
};

const AUTO_RANGE_ORDER: Exclude<HouseholdHealthTrendRange, 'auto' | 'all'>[] = [
  '3m',
  '6m',
  '1y',
  '2y',
  '5y',
];

interface ParsedPoint {
  point: HouseholdHealthPoint;
  dateValue: number;
}

const DAY_IN_MILLISECONDS = 86_400_000;

export const toHouseholdTrendTimestamp = (value: string): number | null => {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2] ?? 1);
  const day = Number(match[3] ?? 1);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const dateValue = Date.UTC(year, month - 1, day);
  const date = new Date(dateValue);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return dateValue;
};

export const formatHouseholdTrendAxisDate = (
  timestamp: number,
  spanDays: number
) => {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  if (spanDays <= 120) return `${month}月${day}日`;
  if (spanDays <= 730) return `${year}年${month}月`;
  return `${year}年`;
};

const resolveTrendDensity = (
  points: readonly ParsedPoint[]
): HouseholdHealthTrendDensity => {
  if (points.length <= 1) return 'sparse';

  const spanDays =
    (points.at(-1)!.dateValue - points[0].dateValue) / DAY_IN_MILLISECONDS;
  const averageGapDays = spanDays / (points.length - 1);

  if (points.length >= 60 || (points.length >= 24 && averageGapDays <= 31)) {
    return 'dense';
  }
  if (points.length <= 6 || averageGapDays >= 90) return 'sparse';
  return 'standard';
};

const buildDisplayReason = (
  density: HouseholdHealthTrendDensity,
  pointCount: number
) => {
  if (pointCount === 0) return '没有可显示的实际测量记录';
  if (density === 'dense') {
    return `高频记录仍按实际测量显示全部 ${pointCount} 条，仅缩小点位避免遮挡`;
  }
  if (density === 'sparse') {
    return `低频记录按实际测量日期显示全部 ${pointCount} 条，不按年份平均`;
  }
  return `按实际测量日期显示全部 ${pointCount} 条，不按年份平均`;
};

const subtractCalendarMonths = (dateValue: number, months: number) => {
  const anchor = new Date(dateValue);
  const targetYear = anchor.getUTCFullYear();
  const targetMonth = anchor.getUTCMonth() - months;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();
  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(anchor.getUTCDate(), lastDay)
  );
};

const resolveAutomaticRange = (
  earliestDate: number,
  latestDate: number
): Exclude<HouseholdHealthTrendRange, 'auto'> =>
  AUTO_RANGE_ORDER.find(
    range =>
      earliestDate >= subtractCalendarMonths(latestDate, RANGE_MONTHS[range])
  ) ?? 'all';

const rangeLabel = (range: HouseholdHealthTrendRange) =>
  HOUSEHOLD_HEALTH_TREND_RANGE_OPTIONS.find(option => option.value === range)
    ?.label ?? '全部';

const understandableMetricRank = (label: string) => {
  const normalized = label.trim().toLocaleLowerCase();
  const priorities = [
    ['血压'],
    ['体重', 'bmi', '腰围'],
    ['静息脉率', '脉率', '心率'],
    ['血糖', '葡萄糖'],
    ['血脂', '胆固醇', '甘油三酯'],
  ];
  const priority = priorities.findIndex(terms =>
    terms.some(term => normalized.includes(term))
  );
  return priority === -1 ? priorities.length : priority;
};

export const buildHouseholdTrendView = (
  metric: HouseholdHealthMetric,
  requestedRange: HouseholdHealthTrendRange = 'auto'
): HouseholdHealthTrendView => {
  const parsedPoints: ParsedPoint[] = [];
  const excludedPointIds: string[] = [];

  metric.points.forEach(point => {
    const dateValue = toHouseholdTrendTimestamp(point.date);
    if (dateValue === null) {
      excludedPointIds.push(point.id);
      return;
    }
    parsedPoints.push({ point, dateValue });
  });

  parsedPoints.sort(
    (left, right) =>
      left.dateValue - right.dateValue ||
      left.point.id.localeCompare(right.point.id)
  );

  if (parsedPoints.length === 0) {
    return {
      requestedRange,
      effectiveRange: requestedRange === 'auto' ? 'all' : requestedRange,
      points: [],
      excludedPointIds,
      actualRangeLabel: '暂无日期',
      hasTrend: false,
      density: 'sparse',
      displayReason: '没有可显示的实际测量记录',
      rangeReason: '没有可用于时间取景的正式日期',
    };
  }

  const earliestDate = parsedPoints[0].dateValue;
  const latestDate = parsedPoints.at(-1)!.dateValue;
  const effectiveRange =
    requestedRange === 'auto'
      ? resolveAutomaticRange(earliestDate, latestDate)
      : requestedRange;
  const cutoff =
    effectiveRange === 'all'
      ? Number.NEGATIVE_INFINITY
      : subtractCalendarMonths(latestDate, RANGE_MONTHS[effectiveRange]);
  const visibleParsedPoints = parsedPoints.filter(
    item => item.dateValue >= cutoff
  );
  const points = visibleParsedPoints.map(item => item.point);
  const density = resolveTrendDensity(visibleParsedPoints);
  const actualRangeLabel =
    points.length === 0
      ? '暂无日期'
      : points[0].date === points.at(-1)!.date
        ? points[0].date
        : `${points[0].date}—${points.at(-1)!.date}`;

  return {
    requestedRange,
    effectiveRange,
    points,
    excludedPointIds,
    actualRangeLabel,
    hasTrend: points.length >= 2,
    density,
    displayReason: buildDisplayReason(density, points.length),
    rangeReason:
      requestedRange === 'auto'
        ? `自动按 ${parsedPoints.length} 条正式记录的实际跨度选择${rangeLabel(
            effectiveRange
          )}`
        : `按你选择的${rangeLabel(requestedRange)}显示`,
  };
};

export const getDefaultPinnedHouseholdMetricIds = (
  metrics: readonly HouseholdHealthMetric[]
) =>
  metrics
    .filter(metric => buildHouseholdTrendView(metric, 'all').hasTrend)
    .map((metric, index) => ({
      id: metric.id,
      index,
      rank: understandableMetricRank(metric.label),
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, 2)
    .map(metric => metric.id);

export const normalizePinnedHouseholdMetricIds = (
  metrics: readonly HouseholdHealthMetric[],
  requestedIds: readonly string[]
) => {
  const eligibleIds = new Set(
    metrics
      .filter(metric => buildHouseholdTrendView(metric, 'all').hasTrend)
      .map(metric => metric.id)
  );
  const normalized = Array.from(new Set(requestedIds))
    .filter(id => eligibleIds.has(id))
    .slice(0, 2);

  return normalized.length > 0
    ? normalized
    : getDefaultPinnedHouseholdMetricIds(metrics);
};
