import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabTestComponentForStack } from '../../services/api/labTestComponentApi';
import HealthCoverageEvidencePanel from './HealthCoverageEvidencePanel';

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revise: vi.fn(),
  void: vi.fn(),
}));

vi.mock('../../services/api/healthCoverageApi', () => ({
  default: apiMocks,
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: {
    listSourceDocuments: vi.fn().mockResolvedValue([
      {
        id: 21,
        display_name: 'Synthetic annual checkup',
        report_date: '2026-01-10',
      },
    ]),
  },
}));

const component: LabTestComponentForStack = {
  id: 8,
  lab_result_id: 108,
  test_name: 'Synthetic Metric A',
  canonical_test_name: 'Synthetic Metric A',
  test_code: 'SYN-A',
  value: 12,
  unit: 'unit/L',
  status: 'normal',
  result_type: 'quantitative',
  completed_date: '2026-01-10',
};

const statement = {
  id: 31,
  patient_id: 7,
  created_by_user_id: 2,
  record_key: 'synthetic-coverage-key',
  version_number: 1,
  exam_date: '2026-01-10',
  metric_key: 'synthetic metric a',
  metric_name: 'Synthetic Metric A',
  metric_code: 'SYN-A',
  absence_reason: 'not-performed' as const,
  absence_reason_system:
    'http://terminology.hl7.org/CodeSystem/data-absent-reason',
  verification_status: 'confirmed' as const,
  note: 'Synthetic note',
  source_document_id: 21,
  source_page: 2,
  source_locator: 'Synthetic row',
  status: 'active' as const,
  is_current: true,
  change_note: null,
  created_at: '2026-01-11T00:00:00Z',
};

const renderPanel = (onChanged = vi.fn()) =>
  render(
    <MantineProvider>
      <Notifications />
      <HealthCoverageEvidencePanel
        patientId={7}
        components={[component]}
        componentsLoading={false}
        componentsError={false}
        onChanged={onChanged}
        onOpenLabRecord={vi.fn()}
        onOpenSourceDocument={vi.fn()}
      />
    </MantineProvider>
  );

describe('HealthCoverageEvidencePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.list.mockResolvedValue([statement]);
    apiMocks.create.mockResolvedValue(statement);
  });

  it('shows counts, same-date conflict and provenance without a percentage', async () => {
    renderPanel();

    expect(
      (await screen.findAllByText('Synthetic Metric A')).length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('coverageEvidence.states.conflict')
    ).toBeInTheDocument();
    expect(
      screen.getByText('coverageEvidence.summary.recorded')
    ).toBeInTheDocument();
    expect(
      screen.getByText('coverageEvidence.summary.notPerformed')
    ).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'coverageEvidence.openSource 21',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'coverageEvidence.openLabRecord 108',
      })
    ).toBeInTheDocument();
  });

  it('requests complete version history only when explicitly enabled', async () => {
    renderPanel();
    const history = await screen.findByRole('switch', {
      name: 'coverageEvidence.showHistory',
    });
    fireEvent.click(history);
    await waitFor(() =>
      expect(apiMocks.list).toHaveBeenLastCalledWith(
        7,
        true,
        expect.any(AbortSignal)
      )
    );
  });
});
