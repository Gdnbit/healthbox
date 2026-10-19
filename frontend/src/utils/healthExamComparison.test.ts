import { describe, expect, it } from 'vitest';
import type { LabTestComponentForStack } from '../services/api/labTestComponentApi';
import {
  buildHealthExamComparison,
  buildHealthExamEpisodes,
} from './healthExamComparison';

const component = (
  id: number,
  overrides: Partial<LabTestComponentForStack> = {}
): LabTestComponentForStack => ({
  id,
  lab_result_id: 1000 + id,
  test_name: 'Synthetic metric A',
  canonical_test_name: 'synthetic-a',
  value: 10,
  unit: 'u/L',
  result_type: 'quantitative',
  completed_date: '2025-01-10',
  source_document_id: 101,
  ...overrides,
});

describe('buildHealthExamEpisodes', () => {
  it('groups source-backed records first and keeps unlinked lab results separate', () => {
    const episodes = buildHealthExamEpisodes([
      component(1),
      component(2, { test_name: 'Synthetic metric B' }),
      component(3, {
        source_document_id: null,
        lab_result_id: 301,
        completed_date: '2025-02-10',
      }),
      component(4, {
        source_document_id: null,
        lab_result_id: 302,
        completed_date: '2025-03-10',
      }),
    ]);

    expect(episodes.map(episode => episode.key)).toEqual([
      'lab:302',
      'lab:301',
      'source:101',
    ]);
    expect(episodes[2].componentIds).toEqual([1, 2]);
    expect(episodes[2].labResultIds).toEqual([1001, 1002]);
  });

  it('preserves all dates and flags a source episode date conflict', () => {
    const [episode] = buildHealthExamEpisodes([
      component(1),
      component(2, { completed_date: '2025-01-11' }),
    ]);

    expect(episode.recordDates).toEqual(['2025-01-10', '2025-01-11']);
    expect(episode.displayDate).toBe('2025-01-11');
    expect(episode.hasDateConflict).toBe(true);
  });
});

describe('buildHealthExamComparison', () => {
  it('selects the newest two dated episodes and calculates absolute same-unit delta', () => {
    const result = buildHealthExamComparison([
      component(1, { source_document_id: 101, value: 10 }),
      component(2, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        value: 12,
      }),
    ]);

    expect(result.target?.key).toBe('source:102');
    expect(result.baseline?.key).toBe('source:101');
    expect(result.rows[0]).toMatchObject({
      state: 'comparable_numeric',
      absoluteDelta: 2,
    });
  });

  it('does not treat a separate same-day episode as an earlier baseline', () => {
    const result = buildHealthExamComparison([
      component(1, { source_document_id: 101, completed_date: '2025-01-10' }),
      component(2, { source_document_id: 102, completed_date: '2026-01-10' }),
      component(3, {
        source_document_id: null,
        lab_result_id: 303,
        completed_date: '2026-01-10',
      }),
    ]);

    expect(result.target?.key).toBe('source:102');
    expect(result.baseline?.key).toBe('source:101');
  });

  it('restores an exact earlier target and baseline using stable episode keys', () => {
    const components = [
      component(1, { source_document_id: 101, completed_date: '2024-01-10' }),
      component(2, { source_document_id: 102, completed_date: '2025-01-10' }),
      component(3, { source_document_id: 103, completed_date: '2026-01-10' }),
    ];
    const result = buildHealthExamComparison(
      components,
      'source:102',
      'source:101'
    );

    expect(result.target?.key).toBe('source:102');
    expect(result.baseline?.key).toBe('source:101');
    expect(result.selectionError).toBeNull();
  });

  it.each([
    ['source:999', 'source:101', 'target_not_found'],
    ['source:102', 'source:999', 'baseline_not_found'],
    ['source:102', 'source:102', 'same_episode'],
    ['source:101', 'source:102', 'baseline_not_earlier'],
  ])('rejects invalid selection %s / %s', (target, baseline, reason) => {
    const result = buildHealthExamComparison(
      [
        component(1, { source_document_id: 101 }),
        component(2, {
          source_document_id: 102,
          completed_date: '2026-01-10',
        }),
      ],
      target,
      baseline
    );

    expect(result.selectionError).toBe(reason);
    expect(result.target?.key).toBe('source:102');
    expect(result.baseline?.key).toBe('source:101');
  });

  it('distinguishes missing, duplicate, unit and result incompatibilities', () => {
    const result = buildHealthExamComparison([
      component(1, { source_document_id: 101 }),
      component(2, {
        source_document_id: 101,
        test_name: 'Baseline only',
        canonical_test_name: 'baseline-only',
      }),
      component(3, {
        source_document_id: 101,
        test_name: 'Duplicate metric',
        canonical_test_name: 'duplicate',
      }),
      component(4, {
        source_document_id: 101,
        test_name: 'Duplicate metric',
        canonical_test_name: 'duplicate',
      }),
      component(5, {
        source_document_id: 101,
        test_name: 'Unit metric',
        canonical_test_name: 'unit',
      }),
      component(6, {
        source_document_id: 101,
        test_name: 'Result metric',
        canonical_test_name: 'result',
      }),
      component(11, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        value: 12,
      }),
      component(12, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        test_name: 'Target only',
        canonical_test_name: 'target-only',
      }),
      component(13, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        test_name: 'Duplicate metric',
        canonical_test_name: 'duplicate',
      }),
      component(15, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        test_name: 'Unit metric',
        canonical_test_name: 'unit',
        unit: 'mmol/L',
      }),
      component(16, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        test_name: 'Result metric',
        canonical_test_name: 'result',
        value: null,
        result_type: 'qualitative',
        qualitative_value: 'negative',
      }),
    ]);

    expect(
      Object.fromEntries(result.rows.map(row => [row.metricKey, row.state]))
    ).toMatchObject({
      'baseline-only': 'target_missing',
      'target-only': 'baseline_missing',
      duplicate: 'multiple_records',
      unit: 'incompatible_unit',
      result: 'incompatible_result',
    });
  });

  it('shows qualitative before and after text without a numeric delta', () => {
    const result = buildHealthExamComparison([
      component(1, {
        source_document_id: 101,
        value: null,
        result_type: 'qualitative',
        qualitative_value: 'negative',
      }),
      component(2, {
        source_document_id: 102,
        completed_date: '2026-01-10',
        value: null,
        result_type: 'qualitative',
        qualitative_value: 'positive',
      }),
    ]);

    expect(result.rows[0]).toMatchObject({
      state: 'comparable_text',
      absoluteDelta: null,
      baseline: { displayValue: 'negative' },
      target: { displayValue: 'positive' },
    });
  });
});
