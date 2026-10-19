import { describe, expect, it } from 'vitest';
import type { HouseholdHealthMetric } from './types';
import {
  buildHouseholdTrendView,
  formatHouseholdTrendAxisDate,
  getDefaultPinnedHouseholdMetricIds,
  normalizePinnedHouseholdMetricIds,
  toHouseholdTrendTimestamp,
} from './householdHealthTrend';

const metric = (
  id: string,
  label: string,
  dates: string[]
): HouseholdHealthMetric => ({
  id,
  kind: id.startsWith('vital:') ? 'vital' : 'lab',
  label,
  unit: '单位',
  latestStatus: null,
  points: dates.map((date, index) => ({
    id: `${id}:${index + 1}`,
    date,
    value: index + 1,
    secondaryValue: null,
    sourceDocumentId: index + 10,
    status: null,
  })),
});

describe('householdHealthTrend', () => {
  it('uses the shortest automatic window that still contains every dated observation', () => {
    const threeMonthView = buildHouseholdTrendView(
      metric('vital:weight', '体重', [
        '2026-04-28',
        '2026-05-28',
        '2026-06-28',
        '2026-07-28',
      ]),
      'auto'
    );
    const fiveYearView = buildHouseholdTrendView(
      metric('lab:glucose', '空腹血糖', [
        '2021-07-28',
        '2022-07-28',
        '2023-07-28',
        '2024-07-28',
        '2025-07-28',
        '2026-07-28',
      ]),
      'auto'
    );

    expect(threeMonthView.effectiveRange).toBe('3m');
    expect(threeMonthView.points).toHaveLength(4);
    expect(threeMonthView.actualRangeLabel).toBe('2026-04-28—2026-07-28');
    expect(fiveYearView.effectiveRange).toBe('5y');
    expect(fiveYearView.points).toHaveLength(6);
  });

  it('filters from the newest real observation with inclusive calendar boundaries', () => {
    const source = metric('vital:weight', '体重', [
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
      '2026',
    ]);

    const view = buildHouseholdTrendView(source, '2y');

    expect(view.points.map(point => point.id)).toEqual([
      'vital:weight:4',
      'vital:weight:5',
      'vital:weight:6',
    ]);
    expect(view.points.map(point => point.value)).toEqual([4, 5, 6]);
    expect(view.actualRangeLabel).toBe('2024—2026');
    expect(view.hasTrend).toBe(true);
  });

  it('does not invent a line for a single point and reports undated exclusions', () => {
    const source = metric('lab:single', '单次指标', ['不是日期', '2026-07-28']);

    const view = buildHouseholdTrendView(source, 'all');

    expect(view.points.map(point => point.id)).toEqual(['lab:single:2']);
    expect(view.excludedPointIds).toEqual(['lab:single:1']);
    expect(view.hasTrend).toBe(false);
  });

  it('keeps sparse observations and repeated measurements in the same year as separate real points', () => {
    const source = metric('vital:weight', '体重', [
      '2021-06-12',
      '2023-02-11',
      '2023-09-18',
      '2026-06-18',
    ]);

    const view = buildHouseholdTrendView(source, 'all');

    expect(view.points.map(point => point.date)).toEqual([
      '2021-06-12',
      '2023-02-11',
      '2023-09-18',
      '2026-06-18',
    ]);
    expect(view.density).toBe('sparse');
    expect(view.displayReason).toContain('不按年份平均');
  });

  it('keeps every high-frequency observation instead of silently averaging or sampling', () => {
    const dates = Array.from(
      { length: 30 },
      (_, index) => `2026-01-${String(index + 1).padStart(2, '0')}`
    );

    const view = buildHouseholdTrendView(
      metric('vital:daily', '每日记录', dates),
      'all'
    );

    expect(view.density).toBe('dense');
    expect(view.points).toHaveLength(30);
    expect(view.points.map(point => point.date)).toEqual(dates);
    expect(view.displayReason).toContain('仅缩小点位');
  });

  it('formats a real time axis without converting observations into yearly categories', () => {
    const first = toHouseholdTrendTimestamp('2023-09-18');
    const last = toHouseholdTrendTimestamp('2026-06-18');

    expect(first).toBe(Date.UTC(2023, 8, 18));
    expect(last).toBe(Date.UTC(2026, 5, 18));
    expect(
      formatHouseholdTrendAxisDate(first!, (last! - first!) / 86_400_000)
    ).toBe('2023年');
    expect(
      formatHouseholdTrendAxisDate(toHouseholdTrendTimestamp('2026-06-18')!, 45)
    ).toBe('6月18日');
  });

  it('chooses at most two understandable metrics that really have a trend', () => {
    const metrics = [
      metric('lab:alt', '丙氨酸氨基转移酶', ['2025', '2026']),
      metric('vital:weight', '体重', ['2025', '2026']),
      metric('lab:glucose', '空腹血糖', ['2026']),
      metric('vital:bp', '血压', ['2025', '2026']),
    ];

    expect(getDefaultPinnedHouseholdMetricIds(metrics)).toEqual([
      'vital:bp',
      'vital:weight',
    ]);
  });

  it('preserves a user order while removing duplicates and unavailable metrics', () => {
    const metrics = [
      metric('vital:bp', '血压', ['2025', '2026']),
      metric('vital:weight', '体重', ['2025', '2026']),
      metric('lab:glucose', '空腹血糖', ['2025', '2026']),
    ];

    expect(
      normalizePinnedHouseholdMetricIds(metrics, [
        'lab:missing',
        'lab:glucose',
        'lab:glucose',
        'vital:bp',
        'vital:weight',
      ])
    ).toEqual(['lab:glucose', 'vital:bp']);
  });
});
