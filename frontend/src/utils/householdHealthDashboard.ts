import type {
  ComponentCatalogEntry,
  LabTestComponentForStack,
} from '../services/api/labTestComponentApi';
import { buildCatalogSummary } from './healthVisualization';

export type DataQualityRuleId =
  | 'missing_date'
  | 'missing_unit'
  | 'missing_result'
  | 'missing_reference'
  | 'missing_category'
  | 'uncanonicalized_name'
  | 'possible_duplicate';

export interface DataQualityIssue {
  ruleId: DataQualityRuleId;
  severity: 'warning' | 'info';
  componentId: number;
  labResultId: number;
  metricName: string;
  date: string | null;
}

export interface CoverageCell {
  count: number;
  statuses: string[];
  units: string[];
  labResultIds: number[];
}

export interface CoverageRow {
  key: string;
  metricName: string;
  cells: Record<string, CoverageCell>;
}

export interface CoverageMatrix {
  dates: string[];
  rows: CoverageRow[];
  excludedWithoutDate: number;
}

export interface FamilyPatientLike {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
}

export interface FamilyMemberHealthSummary {
  patientId: number;
  displayName: string;
  totalMetrics: number;
  totalReadings: number;
  attentionCount: number;
  longTermTrendCount: number;
  latestDate: string | null;
  totalVitalReadings: number;
  latestVitalDate: string | null;
  qualityIssueCount: number;
  explicitAbsenceCount: number;
  coverageNeedsReviewCount: number;
  coverageConflictCount: number;
}

export interface FamilyVitalsStatsLike {
  total_readings?: number | null;
  latest_reading_date?: string | null;
}

export interface FamilyCoverageSummaryLike {
  confirmedNotPerformed?: number;
  notApplicable?: number;
  unknown?: number;
  needsReview?: number;
  conflicts?: number;
}

const compactDate = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 10) : null;
};

export const getClinicalDate = (component: LabTestComponentForStack) =>
  compactDate(component.completed_date) || compactDate(component.ordered_date);

export const getNormalizedUnit = (unit?: string | null) =>
  (unit || '').trim().toLocaleLowerCase();

export const getNormalizedMetricKey = (component: LabTestComponentForStack) =>
  (
    component.canonical_test_name ||
    component.test_code ||
    component.test_name ||
    ''
  )
    .trim()
    .toLocaleLowerCase();

export const getMetricDisplayName = (component: LabTestComponentForStack) =>
  (
    component.canonical_test_name ||
    component.test_name ||
    component.test_code ||
    '—'
  ).trim();

const hasText = (value?: string | null) => Boolean(value?.trim());

const hasAnyResult = (component: LabTestComponentForStack) =>
  typeof component.value === 'number' ||
  hasText(component.qualitative_value) ||
  hasText(component.textual_value);

const isQuantitative = (component: LabTestComponentForStack) =>
  component.result_type === 'quantitative' ||
  (!component.result_type && typeof component.value === 'number');

const hasReference = (component: LabTestComponentForStack) =>
  typeof component.ref_range_min === 'number' ||
  typeof component.ref_range_max === 'number' ||
  hasText(component.ref_range_text);

const resultKey = (component: LabTestComponentForStack) => {
  if (typeof component.value === 'number') return `number:${component.value}`;
  if (hasText(component.qualitative_value)) {
    return `qualitative:${component.qualitative_value!.trim().toLocaleLowerCase()}`;
  }
  if (hasText(component.textual_value)) {
    return `text:${component.textual_value!.trim().toLocaleLowerCase()}`;
  }
  return 'empty';
};

const issue = (
  component: LabTestComponentForStack,
  ruleId: DataQualityRuleId,
  severity: DataQualityIssue['severity'] = 'warning'
): DataQualityIssue => ({
  ruleId,
  severity,
  componentId: component.id ?? 0,
  labResultId: component.lab_result_id,
  metricName: getMetricDisplayName(component),
  date: getClinicalDate(component),
});

export const evaluateDataQuality = (
  components: LabTestComponentForStack[]
): DataQualityIssue[] => {
  const issues: DataQualityIssue[] = [];
  const duplicateKeys = new Set<string>();

  components.forEach(component => {
    const date = getClinicalDate(component);

    if (!date) issues.push(issue(component, 'missing_date'));
    if (
      isQuantitative(component) &&
      typeof component.value === 'number' &&
      !hasText(component.unit)
    ) {
      issues.push(issue(component, 'missing_unit'));
    }
    if (!hasAnyResult(component))
      issues.push(issue(component, 'missing_result'));
    if (
      isQuantitative(component) &&
      typeof component.value === 'number' &&
      !hasReference(component)
    ) {
      issues.push(issue(component, 'missing_reference', 'info'));
    }
    if (!hasText(component.category)) {
      issues.push(issue(component, 'missing_category', 'info'));
    }
    if (
      !hasText(component.canonical_test_name) &&
      !hasText(component.test_code)
    ) {
      issues.push(issue(component, 'uncanonicalized_name', 'info'));
    }

    if (date && hasAnyResult(component)) {
      const duplicateKey = [
        getNormalizedMetricKey(component),
        date,
        getNormalizedUnit(component.unit),
        resultKey(component),
      ].join('::');

      if (duplicateKeys.has(duplicateKey)) {
        issues.push(issue(component, 'possible_duplicate'));
      } else {
        duplicateKeys.add(duplicateKey);
      }
    }
  });

  return issues;
};

const buildCoverageMatrixByPeriod = (
  components: LabTestComponentForStack[],
  toPeriod: (_date: string) => string
): CoverageMatrix => {
  const dates = new Set<string>();
  const rows = new Map<string, CoverageRow>();
  let excludedWithoutDate = 0;

  components.forEach(component => {
    const date = getClinicalDate(component);
    if (!date) {
      excludedWithoutDate += 1;
      return;
    }

    const period = toPeriod(date);
    dates.add(period);
    const key = getNormalizedMetricKey(component);
    const row = rows.get(key) || {
      key,
      metricName: getMetricDisplayName(component),
      cells: {},
    };
    const cell = row.cells[period] || {
      count: 0,
      statuses: [],
      units: [],
      labResultIds: [],
    };

    cell.count += 1;
    if (hasText(component.status)) cell.statuses.push(component.status!.trim());
    if (hasText(component.unit)) cell.units.push(component.unit!.trim());
    cell.labResultIds.push(component.lab_result_id);

    cell.statuses = Array.from(new Set(cell.statuses)).sort();
    cell.units = Array.from(
      new Map(cell.units.map(unit => [getNormalizedUnit(unit), unit])).values()
    ).sort((a, b) => a.localeCompare(b));
    cell.labResultIds = Array.from(new Set(cell.labResultIds)).sort(
      (a, b) => a - b
    );

    row.cells[period] = cell;
    rows.set(key, row);
  });

  return {
    dates: Array.from(dates).sort(),
    rows: Array.from(rows.values()).sort((a, b) =>
      a.metricName.localeCompare(b.metricName)
    ),
    excludedWithoutDate,
  };
};

export const buildCoverageMatrix = (
  components: LabTestComponentForStack[]
): CoverageMatrix => buildCoverageMatrixByPeriod(components, _date => _date);

export const buildAnnualCoverageMatrix = (
  components: LabTestComponentForStack[]
): CoverageMatrix =>
  buildCoverageMatrixByPeriod(components, date => date.slice(0, 4));

export const buildFamilyMemberSummary = (
  patient: FamilyPatientLike,
  catalog: ComponentCatalogEntry[],
  components: LabTestComponentForStack[],
  vitalStats?: FamilyVitalsStatsLike | null,
  coverage?: FamilyCoverageSummaryLike | null
): FamilyMemberHealthSummary => {
  const catalogSummary = buildCatalogSummary(catalog);
  const latestVitalDate = compactDate(vitalStats?.latest_reading_date);
  const latestDate =
    [catalogSummary.latestDate, latestVitalDate]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null;
  const rawVitalReadings = Number(vitalStats?.total_readings ?? 0);
  const totalVitalReadings =
    Number.isFinite(rawVitalReadings) && rawVitalReadings > 0
      ? Math.floor(rawVitalReadings)
      : 0;
  const displayName = [patient.first_name, patient.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    patientId: patient.id,
    displayName: displayName || `#${patient.id}`,
    ...catalogSummary,
    latestDate,
    totalVitalReadings,
    latestVitalDate,
    qualityIssueCount: evaluateDataQuality(components).length,
    explicitAbsenceCount:
      (coverage?.confirmedNotPerformed || 0) +
      (coverage?.notApplicable || 0) +
      (coverage?.unknown || 0),
    coverageNeedsReviewCount: coverage?.needsReview || 0,
    coverageConflictCount: coverage?.conflicts || 0,
  };
};
