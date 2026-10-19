import { describe, expect, it } from 'vitest';
import cases from '../../../evals/visualization-context/cases/context-cases.json';
import golden from '../../../evals/visualization-context/golden/context-contract.json';
import {
  buildHealthBaselineComparison,
  type ComparableHealthPoint,
} from './healthBaselineComparison';

const labPoints: ComparableHealthPoint[] = cases.lab_points.map(point => ({
  id: point.id,
  date: point.date,
  primaryValue: point.value,
  displayValue: String(point.value),
  unit: point.unit,
  kind: 'quantitative',
}));

describe('health baseline comparison', () => {
  it('uses stable date/id ordering and defaults to the immediately previous record', () => {
    const comparison = buildHealthBaselineComparison([
      labPoints[2],
      labPoints[0],
      labPoints[1],
    ]);

    expect(comparison.reason).toBeNull();
    expect(comparison.target?.id).toBe(golden.lab_default.target_id);
    expect(comparison.baseline?.id).toBe(golden.lab_default.baseline_id);
    expect(comparison.primaryDelta).toBe(golden.lab_default.primary_delta);
  });

  it('allows an exact earlier record ID as a custom baseline', () => {
    const comparison = buildHealthBaselineComparison(
      labPoints,
      golden.lab_custom_baseline.baseline_id
    );

    expect(comparison.target?.id).toBe(golden.lab_custom_baseline.target_id);
    expect(comparison.baseline?.id).toBe(
      golden.lab_custom_baseline.baseline_id
    );
    expect(comparison.primaryDelta).toBe(
      golden.lab_custom_baseline.primary_delta
    );
  });

  it('calculates both blood-pressure components independently', () => {
    const points: ComparableHealthPoint[] = cases.blood_pressure_points.map(
      point => ({
        id: point.id,
        date: point.date,
        primaryValue: point.primary,
        secondaryValue: point.secondary,
        displayValue: `${point.primary}/${point.secondary}`,
        unit: point.unit,
        kind: 'quantitative',
      })
    );
    const comparison = buildHealthBaselineComparison(points);

    expect(comparison.primaryDelta).toBe(golden.blood_pressure.primary_delta);
    expect(comparison.secondaryDelta).toBe(
      golden.blood_pressure.secondary_delta
    );
  });

  it('shows exact before/after values for qualitative records without a delta', () => {
    const comparison = buildHealthBaselineComparison([
      {
        id: 1,
        date: '2025-01-01',
        displayValue: 'negative',
        kind: 'qualitative',
      },
      {
        id: 2,
        date: '2025-02-01',
        displayValue: 'positive',
        kind: 'qualitative',
      },
    ]);

    expect(comparison.reason).toBeNull();
    expect(comparison.baseline?.displayValue).toBe('negative');
    expect(comparison.target?.displayValue).toBe('positive');
    expect(comparison.primaryDelta).toBeNull();
  });

  it('refuses missing, incompatible and non-prior baselines', () => {
    expect(buildHealthBaselineComparison([]).reason).toBe(
      'insufficient_points'
    );
    expect(buildHealthBaselineComparison(labPoints, 999).reason).toBe(
      'invalid_baseline'
    );
    expect(
      buildHealthBaselineComparison(
        [labPoints[0], { ...labPoints[1], unit: 'other' }],
        labPoints[0].id
      ).reason
    ).toBe('incompatible_unit');
    expect(
      buildHealthBaselineComparison(
        [labPoints[0], { ...labPoints[1], primaryValue: null }],
        labPoints[0].id
      ).reason
    ).toBe('missing_value');
    expect(
      buildHealthBaselineComparison(labPoints, golden.lab_default.target_id)
        .reason
    ).toBe('invalid_baseline');
  });
});
