export type ComparableHealthPointKind = 'quantitative' | 'qualitative';

export interface ComparableHealthPoint {
  id: number;
  date: string;
  primaryValue?: number | null;
  secondaryValue?: number | null;
  displayValue?: string | null;
  unit?: string | null;
  kind: ComparableHealthPointKind;
}

export type HealthBaselineReason =
  | 'insufficient_points'
  | 'missing_value'
  | 'invalid_baseline'
  | 'incompatible_unit';

export interface HealthBaselineComparison {
  target: ComparableHealthPoint | null;
  baseline: ComparableHealthPoint | null;
  candidates: ComparableHealthPoint[];
  primaryDelta: number | null;
  secondaryDelta: number | null;
  kind: ComparableHealthPointKind | null;
  reason: HealthBaselineReason | null;
}

const normalizedUnit = (value?: string | null) =>
  (value || '').trim().toLocaleLowerCase();

export const sortComparableHealthPoints = (
  points: ComparableHealthPoint[]
): ComparableHealthPoint[] =>
  [...points].sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    return byDate !== 0 ? byDate : left.id - right.id;
  });

const refused = (
  reason: HealthBaselineReason,
  target: ComparableHealthPoint | null,
  baseline: ComparableHealthPoint | null,
  candidates: ComparableHealthPoint[]
): HealthBaselineComparison => ({
  target,
  baseline,
  candidates,
  primaryDelta: null,
  secondaryDelta: null,
  kind: target?.kind || null,
  reason,
});

export const buildHealthBaselineComparison = (
  points: ComparableHealthPoint[],
  baselineId?: number | null
): HealthBaselineComparison => {
  const sorted = sortComparableHealthPoints(points);
  if (sorted.length < 2) {
    return refused(
      'insufficient_points',
      sorted.at(-1) || null,
      null,
      sorted.slice(0, -1)
    );
  }

  const target = sorted[sorted.length - 1];
  const candidates = sorted.slice(0, -1);
  const baseline =
    baselineId === undefined || baselineId === null
      ? candidates[candidates.length - 1]
      : candidates.find(point => point.id === baselineId) || null;

  if (!baseline) {
    return refused('invalid_baseline', target, null, candidates);
  }
  if (target.kind !== baseline.kind) {
    return refused('missing_value', target, baseline, candidates);
  }
  if (normalizedUnit(target.unit) !== normalizedUnit(baseline.unit)) {
    return refused('incompatible_unit', target, baseline, candidates);
  }

  if (target.kind === 'qualitative') {
    if (!target.displayValue?.trim() || !baseline.displayValue?.trim()) {
      return refused('missing_value', target, baseline, candidates);
    }
    return {
      target,
      baseline,
      candidates,
      primaryDelta: null,
      secondaryDelta: null,
      kind: 'qualitative',
      reason: null,
    };
  }

  if (
    typeof target.primaryValue !== 'number' ||
    !Number.isFinite(target.primaryValue) ||
    typeof baseline.primaryValue !== 'number' ||
    !Number.isFinite(baseline.primaryValue)
  ) {
    return refused('missing_value', target, baseline, candidates);
  }

  const hasSecondary =
    target.secondaryValue !== null &&
    target.secondaryValue !== undefined &&
    baseline.secondaryValue !== null &&
    baseline.secondaryValue !== undefined;
  const mismatchedSecondary =
    (target.secondaryValue !== null && target.secondaryValue !== undefined) !==
    (baseline.secondaryValue !== null && baseline.secondaryValue !== undefined);
  if (
    mismatchedSecondary ||
    (hasSecondary &&
      (!Number.isFinite(target.secondaryValue) ||
        !Number.isFinite(baseline.secondaryValue)))
  ) {
    return refused('missing_value', target, baseline, candidates);
  }

  return {
    target,
    baseline,
    candidates,
    primaryDelta: target.primaryValue - baseline.primaryValue,
    secondaryDelta: hasSecondary
      ? (target.secondaryValue as number) - (baseline.secondaryValue as number)
      : null,
    kind: 'quantitative',
    reason: null,
  };
};
