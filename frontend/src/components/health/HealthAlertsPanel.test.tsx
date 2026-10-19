import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthAlertsPanel from './HealthAlertsPanel';

const apiMocks = vi.hoisted(() => ({
  evaluate: vi.fn(),
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn(),
}));

vi.mock('../../services/api/healthAlertApi', () => ({
  default: apiMocks,
}));

const alert = {
  alert_id: 'a'.repeat(64),
  alert_type: 'threshold' as const,
  severity: 'warning' as const,
  title: 'Synthetic metric',
  explanation: 'Synthetic explanation',
  rule_id: 'custom.4',
  rule_version: 2,
  rule_description: 'Synthetic threshold rule',
  evidence: {
    component_id: 31,
    lab_result_id: 21,
    observed_date: '2026-04-01',
    test_name: 'Synthetic metric',
    result_type: 'quantitative',
    numeric_value: 0,
    unit: 'u/L',
    status: 'normal',
    threshold_operator: 'lt',
    threshold_value: 1,
  },
  source: {
    lab_result_id: 21,
    source_document_id: 11,
    source_page: 2,
    source_locator: 'Synthetic table row',
    import_batch_id: 3,
  },
  calculated_at: '2026-07-22T08:00:00Z',
  limitations: 'Synthetic limitation',
  muted_until: null,
};

describe('HealthAlertsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.evaluate.mockResolvedValue({
      patient_id: 7,
      calculated_at: '2026-07-22T08:00:00Z',
      active_count: 1,
      muted_count: 0,
      alerts: [alert],
    });
    apiMocks.listRules.mockResolvedValue([]);
  });

  it('shows the stored zero value with provenance and rule version', async () => {
    render(
      <MantineProvider>
        <Notifications />
        <HealthAlertsPanel patientId={7} />
      </MantineProvider>
    );

    expect(await screen.findByText('Synthetic metric')).toBeInTheDocument();
    expect(screen.getByText('0 u/L')).toBeInTheDocument();
    expect(screen.getByText('Synthetic table row')).toBeInTheDocument();
    expect(screen.getByText(/custom\.4/)).toBeInTheDocument();
    expect(screen.getByText(/v2/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /not a diagnosis, risk score or treatment recommendation/i
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.evaluate).toHaveBeenCalledWith(
        7,
        false,
        expect.any(AbortSignal)
      )
    );
  });

  it('recalculates with muted alerts when requested', async () => {
    render(
      <MantineProvider>
        <Notifications />
        <HealthAlertsPanel patientId={7} />
      </MantineProvider>
    );

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Show muted',
    });
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(apiMocks.evaluate).toHaveBeenLastCalledWith(
        7,
        true,
        expect.any(AbortSignal)
      )
    );
  });
});
