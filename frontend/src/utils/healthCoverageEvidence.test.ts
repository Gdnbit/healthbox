import { describe, expect, it } from 'vitest';
import golden from '../../../evals/coverage-evidence/golden/merged-matrix.json';
import type { LabTestComponentForStack } from '../services/api/labTestComponentApi';
import {
  buildCoverageEvidence,
  type HealthCoverageStatementLike,
} from './healthCoverageEvidence';

const component = (id: number, date: string): LabTestComponentForStack => ({
  id,
  lab_result_id: 100 + id,
  test_name: 'Synthetic Metric A',
  canonical_test_name: 'Synthetic Metric A',
  test_code: 'SYN-A',
  value: 10 + id,
  unit: 'unit/L',
  status: 'normal',
  result_type: 'quantitative',
  completed_date: date,
});

const statement = (
  id: number,
  date: string,
  overrides: Partial<HealthCoverageStatementLike> = {}
): HealthCoverageStatementLike => ({
  id,
  patient_id: 7,
  record_key: `synthetic-${id}`,
  version_number: 1,
  exam_date: date,
  metric_key: 'synthetic metric a',
  metric_name: 'Synthetic Metric A',
  absence_reason: 'not-performed',
  verification_status: 'confirmed',
  status: 'active',
  is_current: true,
  source_document_id: 200 + id,
  ...overrides,
});

describe('buildCoverageEvidence', () => {
  it('matches the exact-date golden contract and preserves conflicts', () => {
    const components = [component(1, '2025-01-10'), component(2, '2026-01-10')];
    const statements = [
      statement(11, '2025-06-10'),
      statement(12, '2026-01-10'),
    ];
    const before = structuredClone({ components, statements });

    const evidence = buildCoverageEvidence(components, statements, 'date');
    const row = evidence.matrix.rows[0];
    const actual = {
      periods: evidence.matrix.periods,
      rows: [
        {
          metric_key: row.metricKey,
          cells: Object.fromEntries(
            evidence.matrix.periods.map(period => {
              const cell = row.cells[period];
              return [
                period,
                {
                  state: cell.primaryState,
                  observation_count: cell.observationCount,
                  statement_count: cell.statementCount,
                  conflict_count: cell.conflictCount,
                },
              ];
            })
          ),
        },
      ],
      summary: {
        recorded_observations: evidence.summary.recordedObservations,
        confirmed_not_performed: evidence.summary.confirmedNotPerformed,
        not_applicable: evidence.summary.notApplicable,
        unknown: evidence.summary.unknown,
        needs_review: evidence.summary.needsReview,
        conflicts: evidence.summary.conflicts,
        percentage: null,
      },
    };

    expect(actual).toEqual(golden);
    expect(evidence.matrix.rows[0].cells['2026-01-10']).toMatchObject({
      observationIds: [2],
      labResultIds: [102],
      statementIds: [12],
      sourceDocumentIds: [212],
      states: ['recorded', 'not-performed', 'conflict'],
    });
    expect(evidence.summary).not.toHaveProperty('percentage');
    expect({ components, statements }).toEqual(before);
  });

  it('aggregates annual evidence without inventing a same-year conflict', () => {
    const evidence = buildCoverageEvidence(
      [component(1, '2025-01-10'), component(2, '2026-01-10')],
      [statement(11, '2025-06-10'), statement(12, '2026-01-10')],
      'year'
    );

    expect(evidence.matrix.periods).toEqual(['2025', '2026']);
    expect(evidence.matrix.rows[0].cells['2025']).toMatchObject({
      observationCount: 1,
      statementCount: 1,
      conflictCount: 0,
      states: ['recorded', 'not-performed'],
    });
    expect(evidence.matrix.rows[0].cells['2026'].conflictCount).toBe(1);
  });

  it('keeps review status distinct and ignores superseded or voided versions', () => {
    const evidence = buildCoverageEvidence(
      [],
      [
        statement(1, '2025-01-10', {
          verification_status: 'needs_review',
        }),
        statement(2, '2025-02-10', {
          verification_status: 'questionable',
        }),
        statement(3, '2025-03-10', {
          status: 'superseded',
          is_current: false,
        }),
        statement(4, '2025-04-10', { status: 'voided' }),
      ],
      'date'
    );

    expect(evidence.matrix.periods).toEqual(['2025-01-10', '2025-02-10']);
    expect(evidence.summary.needsReview).toBe(1);
    expect(evidence.summary.questionable).toBe(1);
    expect(evidence.summary.confirmedNotPerformed).toBe(0);
  });

  it('counts undated formal observations without adding a matrix period', () => {
    const undated = component(5, '');
    undated.completed_date = null;
    undated.ordered_date = null;

    const evidence = buildCoverageEvidence([undated], [], 'date');
    expect(evidence.matrix.periods).toEqual([]);
    expect(evidence.summary.recordedObservations).toBe(1);
    expect(evidence.summary.undatedObservations).toBe(1);
  });
});
