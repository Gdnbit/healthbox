import { describe, expect, it } from 'vitest';
import type {
  ComponentCatalogEntry,
  LabTestComponentForStack,
} from '../services/api/labTestComponentApi';
import {
  buildAnnualCoverageMatrix,
  buildCoverageMatrix,
  buildFamilyMemberSummary,
  evaluateDataQuality,
} from './householdHealthDashboard';

const makeComponent = (
  id: number,
  overrides: Partial<LabTestComponentForStack> = {}
): LabTestComponentForStack => ({
  id,
  lab_result_id: 100 + id,
  test_name: '虚构指标甲',
  canonical_test_name: 'Synthetic metric A',
  test_code: 'SYN-A',
  value: 10,
  unit: 'u/L',
  ref_range_min: 5,
  ref_range_max: 20,
  status: 'normal',
  category: 'chemistry',
  result_type: 'quantitative',
  completed_date: '2025-01-10',
  ...overrides,
});

const makeCatalogEntry = (
  name: string,
  overrides: Partial<ComponentCatalogEntry> = {}
): ComponentCatalogEntry => ({
  test_name: name,
  trend_test_name: name,
  latest_value: 10,
  unit: 'u/L',
  status: 'normal',
  category: 'chemistry',
  result_type: 'quantitative',
  reading_count: 1,
  trend_direction: 'stable',
  latest_date: '2025-01-10',
  ...overrides,
});

describe('evaluateDataQuality', () => {
  it('reports stable, explainable rules without mutating observations', () => {
    const original = makeComponent(1, {
      canonical_test_name: null,
      test_code: null,
      unit: null,
      ref_range_min: null,
      ref_range_max: null,
      category: null,
      completed_date: null,
      ordered_date: null,
    });
    const before = structuredClone(original);

    expect(evaluateDataQuality([original]).map(issue => issue.ruleId)).toEqual([
      'missing_date',
      'missing_unit',
      'missing_reference',
      'missing_category',
      'uncanonicalized_name',
    ]);
    expect(original).toEqual(before);
  });

  it('reports a missing result once when every result representation is empty', () => {
    const issues = evaluateDataQuality([
      makeComponent(1, {
        value: null,
        qualitative_value: null,
        textual_value: null,
        result_type: 'textual',
      }),
    ]);

    expect(issues.map(issue => issue.ruleId)).toContain('missing_result');
    expect(
      issues.filter(issue => issue.ruleId === 'missing_result')
    ).toHaveLength(1);
  });

  it('flags only later records in a same-day, same-unit, same-result duplicate set', () => {
    const issues = evaluateDataQuality([
      makeComponent(1),
      makeComponent(2, { lab_result_id: 202 }),
      makeComponent(3, { unit: 'mmol/L' }),
      makeComponent(4, { completed_date: '2025-02-10' }),
    ]);

    expect(
      issues
        .filter(issue => issue.ruleId === 'possible_duplicate')
        .map(issue => issue.componentId)
    ).toEqual([2]);
  });
});

describe('buildCoverageMatrix', () => {
  it('groups normalized metrics by clinical date and preserves cell evidence', () => {
    const matrix = buildCoverageMatrix([
      makeComponent(1),
      makeComponent(2, { status: 'high', lab_result_id: 202 }),
      makeComponent(3, {
        test_name: '虚构指标乙',
        canonical_test_name: 'Synthetic metric B',
        test_code: 'SYN-B',
        completed_date: '2025-02-10',
        unit: 'mmol/L',
      }),
      makeComponent(4, { completed_date: null, ordered_date: null }),
    ]);

    expect(matrix.dates).toEqual(['2025-01-10', '2025-02-10']);
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[0].cells['2025-01-10']).toEqual({
      count: 2,
      statuses: ['high', 'normal'],
      units: ['u/L'],
      labResultIds: [101, 202],
    });
    expect(matrix.excludedWithoutDate).toBe(1);
  });

  it('aggregates the same evidence by year without inventing missing checks', () => {
    const matrix = buildAnnualCoverageMatrix([
      makeComponent(1),
      makeComponent(2, { completed_date: '2025-09-10', status: 'high' }),
      makeComponent(3, { completed_date: '2026-01-10' }),
      makeComponent(4, { completed_date: null, ordered_date: null }),
    ]);

    expect(matrix.dates).toEqual(['2025', '2026']);
    expect(matrix.rows[0].cells['2025']).toMatchObject({
      count: 2,
      statuses: ['high', 'normal'],
    });
    expect(matrix.rows[0].cells['2026']).toMatchObject({ count: 1 });
    expect(matrix.excludedWithoutDate).toBe(1);
  });
});

describe('buildFamilyMemberSummary', () => {
  it('reconciles catalog coverage and quality issue counts for one member', () => {
    const catalog = [
      makeCatalogEntry('虚构指标甲', { reading_count: 8 }),
      makeCatalogEntry('虚构指标乙', {
        reading_count: 2,
        status: 'high',
        latest_date: '2025-03-10',
      }),
    ];
    const components = [makeComponent(1), makeComponent(2, { unit: null })];

    expect(
      buildFamilyMemberSummary(
        { id: 7, first_name: '虚构', last_name: '成员' },
        catalog,
        components,
        { total_readings: 4, latest_reading_date: '2025-04-10T08:00:00Z' },
        {
          confirmedNotPerformed: 2,
          notApplicable: 1,
          unknown: 3,
          needsReview: 4,
          conflicts: 1,
        }
      )
    ).toEqual({
      patientId: 7,
      displayName: '虚构 成员',
      totalMetrics: 2,
      totalReadings: 10,
      attentionCount: 1,
      longTermTrendCount: 1,
      latestDate: '2025-04-10',
      totalVitalReadings: 4,
      latestVitalDate: '2025-04-10',
      qualityIssueCount: 1,
      explicitAbsenceCount: 6,
      coverageNeedsReviewCount: 4,
      coverageConflictCount: 1,
    });
  });
});
