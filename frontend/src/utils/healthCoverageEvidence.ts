import type { LabTestComponentForStack } from '../services/api/labTestComponentApi';
import {
  getClinicalDate,
  getMetricDisplayName,
  getNormalizedMetricKey,
  getNormalizedUnit,
} from './householdHealthDashboard';

export type CoverageAbsenceReason =
  | 'not-performed'
  | 'not-applicable'
  | 'unknown';
export type CoverageVerification =
  | 'needs_review'
  | 'confirmed'
  | 'questionable';
export type CoverageEvidenceState =
  | 'recorded'
  | 'not-performed'
  | 'not-applicable'
  | 'unknown'
  | 'needs-review'
  | 'questionable'
  | 'conflict';

export interface HealthCoverageStatementLike {
  id: number;
  patient_id: number;
  record_key: string;
  version_number: number;
  exam_date: string;
  metric_key: string;
  metric_name: string;
  metric_code?: string | null;
  absence_reason: CoverageAbsenceReason;
  verification_status: CoverageVerification;
  source_document_id?: number | null;
  status: 'active' | 'superseded' | 'voided';
  is_current: boolean;
}

export interface CoverageEvidenceCell {
  observationCount: number;
  observationIds: number[];
  labResultIds: number[];
  statuses: string[];
  units: string[];
  statementCount: number;
  statementIds: number[];
  statementReasons: CoverageAbsenceReason[];
  verificationStatuses: CoverageVerification[];
  sourceDocumentIds: number[];
  statementDates: string[];
  conflictCount: number;
  states: CoverageEvidenceState[];
  primaryState: CoverageEvidenceState;
}

export interface CoverageEvidenceRow {
  metricKey: string;
  metricName: string;
  cells: Record<string, CoverageEvidenceCell>;
}

export interface CoverageEvidenceMatrix {
  periods: string[];
  rows: CoverageEvidenceRow[];
}

export interface CoverageEvidenceSummary {
  recordedObservations: number;
  confirmedNotPerformed: number;
  notApplicable: number;
  unknown: number;
  needsReview: number;
  questionable: number;
  conflicts: number;
  undatedObservations: number;
}

export interface CoverageEvidenceResult {
  matrix: CoverageEvidenceMatrix;
  summary: CoverageEvidenceSummary;
}

const stateOrder: CoverageEvidenceState[] = [
  'recorded',
  'not-performed',
  'not-applicable',
  'unknown',
  'needs-review',
  'questionable',
  'conflict',
];

const normalizeKey = (value: string) =>
  value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');

const uniqueSorted = <T extends string | number>(values: T[]) =>
  Array.from(new Set(values)).sort((left, right) =>
    String(left).localeCompare(String(right))
  );

const statementState = (
  statement: HealthCoverageStatementLike
): CoverageEvidenceState => {
  if (statement.verification_status === 'needs_review') return 'needs-review';
  if (statement.verification_status === 'questionable') return 'questionable';
  return statement.absence_reason;
};

const emptyCell = (): CoverageEvidenceCell => ({
  observationCount: 0,
  observationIds: [],
  labResultIds: [],
  statuses: [],
  units: [],
  statementCount: 0,
  statementIds: [],
  statementReasons: [],
  verificationStatuses: [],
  sourceDocumentIds: [],
  statementDates: [],
  conflictCount: 0,
  states: [],
  primaryState: 'recorded',
});

const finalizeCell = (cell: CoverageEvidenceCell): CoverageEvidenceCell => {
  const states = uniqueSorted(cell.states).sort(
    (left, right) => stateOrder.indexOf(left) - stateOrder.indexOf(right)
  );
  const primaryState = cell.conflictCount
    ? 'conflict'
    : cell.observationCount
      ? 'recorded'
      : states[0];
  return {
    ...cell,
    observationIds: uniqueSorted(cell.observationIds),
    labResultIds: uniqueSorted(cell.labResultIds),
    statuses: uniqueSorted(cell.statuses),
    units: uniqueSorted(cell.units),
    statementIds: uniqueSorted(cell.statementIds),
    statementReasons: uniqueSorted(cell.statementReasons),
    verificationStatuses: uniqueSorted(cell.verificationStatuses),
    sourceDocumentIds: uniqueSorted(cell.sourceDocumentIds),
    statementDates: uniqueSorted(cell.statementDates),
    states,
    primaryState,
  };
};

export const buildCoverageEvidence = (
  components: LabTestComponentForStack[],
  statements: HealthCoverageStatementLike[],
  periodMode: 'date' | 'year'
): CoverageEvidenceResult => {
  const rows = new Map<string, CoverageEvidenceRow>();
  const periods = new Set<string>();
  const exactObservations = new Set<string>();
  const currentStatements = statements.filter(
    statement => statement.is_current && statement.status === 'active'
  );
  let undatedObservations = 0;

  const ensureRow = (metricKey: string, metricName: string) => {
    const row = rows.get(metricKey) || {
      metricKey,
      metricName,
      cells: {},
    };
    rows.set(metricKey, row);
    return row;
  };

  components.forEach(component => {
    const metricKey = getNormalizedMetricKey(component);
    const date = getClinicalDate(component);
    if (!metricKey) return;
    if (!date) {
      undatedObservations += 1;
      return;
    }
    exactObservations.add(`${metricKey}::${date}`);
    const period = periodMode === 'year' ? date.slice(0, 4) : date;
    periods.add(period);
    const row = ensureRow(metricKey, getMetricDisplayName(component));
    const cell = row.cells[period] || emptyCell();
    cell.observationCount += 1;
    if (component.id) cell.observationIds.push(component.id);
    cell.labResultIds.push(component.lab_result_id);
    if (component.status?.trim()) cell.statuses.push(component.status.trim());
    const unit = getNormalizedUnit(component.unit);
    if (unit) cell.units.push(component.unit!.trim());
    cell.states.push('recorded');
    row.cells[period] = cell;
  });

  let conflicts = 0;
  currentStatements.forEach(statement => {
    const metricKey = normalizeKey(statement.metric_key);
    if (!metricKey || !/^\d{4}-\d{2}-\d{2}$/.test(statement.exam_date)) return;
    const period =
      periodMode === 'year'
        ? statement.exam_date.slice(0, 4)
        : statement.exam_date;
    periods.add(period);
    const row = ensureRow(metricKey, statement.metric_name.trim() || metricKey);
    const cell = row.cells[period] || emptyCell();
    cell.statementCount += 1;
    cell.statementIds.push(statement.id);
    cell.statementReasons.push(statement.absence_reason);
    cell.verificationStatuses.push(statement.verification_status);
    cell.statementDates.push(statement.exam_date);
    if (statement.source_document_id) {
      cell.sourceDocumentIds.push(statement.source_document_id);
    }
    cell.states.push(statementState(statement));
    if (
      statement.verification_status === 'confirmed' &&
      exactObservations.has(`${metricKey}::${statement.exam_date}`)
    ) {
      cell.conflictCount += 1;
      cell.states.push('conflict');
      conflicts += 1;
    }
    row.cells[period] = cell;
  });

  const sortedPeriods = Array.from(periods).sort();
  const sortedRows = Array.from(rows.values())
    .map(row => ({
      ...row,
      cells: Object.fromEntries(
        Object.entries(row.cells).map(([period, cell]) => [
          period,
          finalizeCell(cell),
        ])
      ),
    }))
    .sort((left, right) =>
      left.metricName.localeCompare(right.metricName, undefined, {
        sensitivity: 'base',
      })
    );

  return {
    matrix: { periods: sortedPeriods, rows: sortedRows },
    summary: {
      recordedObservations: components.length,
      confirmedNotPerformed: currentStatements.filter(
        statement =>
          statement.verification_status === 'confirmed' &&
          statement.absence_reason === 'not-performed'
      ).length,
      notApplicable: currentStatements.filter(
        statement =>
          statement.verification_status === 'confirmed' &&
          statement.absence_reason === 'not-applicable'
      ).length,
      unknown: currentStatements.filter(
        statement =>
          statement.verification_status === 'confirmed' &&
          statement.absence_reason === 'unknown'
      ).length,
      needsReview: currentStatements.filter(
        statement => statement.verification_status === 'needs_review'
      ).length,
      questionable: currentStatements.filter(
        statement => statement.verification_status === 'questionable'
      ).length,
      conflicts,
      undatedObservations,
    },
  };
};
