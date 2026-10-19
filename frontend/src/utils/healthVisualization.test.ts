import { describe, expect, it } from 'vitest';
import type {
  ComponentCatalogEntry,
  TrendDataPoint,
} from '../services/api/labTestComponentApi';
import {
  buildCatalogSummary,
  filterCatalogItems,
  getDistinctUnits,
  hasReferenceRangeChanges,
  selectVisualizationMode,
} from './healthVisualization';

const makePoint = (
  id: number,
  overrides: Partial<TrendDataPoint> = {}
): TrendDataPoint => ({
  id,
  value: 10 + id,
  unit: 'u/L',
  status: 'normal',
  ref_range_min: 5,
  ref_range_max: 20,
  recorded_date: `2025-${String(id).padStart(2, '0')}-01`,
  created_at: `2025-${String(id).padStart(2, '0')}-01T00:00:00Z`,
  lab_result: {
    id,
    test_name: `虚构来源 ${id}`,
    completed_date: `2025-${String(id).padStart(2, '0')}-01`,
  },
  result_type: 'quantitative',
  ...overrides,
});

const makeEntry = (
  testName: string,
  overrides: Partial<ComponentCatalogEntry> = {}
): ComponentCatalogEntry => ({
  test_name: testName,
  trend_test_name: testName,
  latest_value: 12,
  unit: 'u/L',
  status: 'normal',
  category: 'chemistry',
  result_type: 'quantitative',
  reading_count: 1,
  trend_direction: 'stable',
  latest_date: '2025-01-01',
  ...overrides,
});

describe('selectVisualizationMode', () => {
  it.each([
    [0, 'empty'],
    [1, 'snapshot'],
    [2, 'comparison'],
    [7, 'comparison'],
    [8, 'trend'],
  ] as const)('maps %i quantitative points to %s', (count, expected) => {
    const points = Array.from({ length: count }, (_, index) =>
      makePoint(index + 1)
    );
    expect(selectVisualizationMode(points, 'quantitative')).toBe(expected);
  });

  it('ignores missing quantitative values when deciding the mode', () => {
    expect(
      selectVisualizationMode(
        [makePoint(1), makePoint(2, { value: null })],
        'quantitative'
      )
    ).toBe('snapshot');
  });

  it('uses a qualitative sequence instead of a numeric trend line', () => {
    expect(
      selectVisualizationMode(
        [makePoint(1, { value: null, qualitative_value: 'positive' })],
        'qualitative'
      )
    ).toBe('qualitative');
  });

  it('uses the same non-numeric sequence for textual observations', () => {
    expect(
      selectVisualizationMode(
        [makePoint(1, { value: null, textual_value: 'synthetic note' })],
        'textual'
      )
    ).toBe('qualitative');
  });
});

describe('catalog summary and filtering', () => {
  const entries = [
    makeEntry('虚构指标甲', {
      reading_count: 8,
      latest_date: '2025-02-01',
    }),
    makeEntry('虚构指标乙', {
      status: 'high',
      category: 'hematology',
      reading_count: 3,
      latest_date: '2025-03-01',
    }),
    makeEntry('虚构指标丙', {
      result_type: 'qualitative',
      reading_count: 4,
      latest_value: null,
      latest_qualitative_value: 'negative',
      latest_date: null,
    }),
  ];

  it('summarizes coverage without calling sparse data a trend', () => {
    expect(buildCatalogSummary(entries)).toEqual({
      totalMetrics: 3,
      totalReadings: 15,
      attentionCount: 1,
      longTermTrendCount: 1,
      latestDate: '2025-03-01',
    });
  });

  it('combines search, status and category filters', () => {
    expect(
      filterCatalogItems(entries, {
        search: '乙',
        status: 'attention',
        category: 'hematology',
      }).map(item => item.test_name)
    ).toEqual(['虚构指标乙']);
  });
});

describe('provenance-safe comparisons', () => {
  it('detects unit mismatches instead of silently merging them', () => {
    expect(
      getDistinctUnits([
        makePoint(1),
        makePoint(2, { unit: 'mmol/L' }),
        makePoint(3, { unit: ' U/L ' }),
      ])
    ).toEqual(['mmol/L', 'u/L']);
  });

  it('detects reference range changes across observations', () => {
    expect(
      hasReferenceRangeChanges([
        makePoint(1),
        makePoint(2, { ref_range_max: 22 }),
      ])
    ).toBe(true);
    expect(hasReferenceRangeChanges([makePoint(1), makePoint(2)])).toBe(false);
  });
});
