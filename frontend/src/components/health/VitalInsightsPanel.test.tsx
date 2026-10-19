import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VitalInsightsPanel from './VitalInsightsPanel';

const serviceMocks = vi.hoisted(() => ({
  getPatientVitals: vi.fn(),
  getPatientVitalsStats: vi.fn(),
}));

vi.mock('../../services/medical/vitalsService', () => ({
  vitalsService: serviceMocks,
}));

vi.mock('../../contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ unitSystem: 'metric' }),
}));

vi.mock('../../hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (value: string) => value.slice(0, 10),
  }),
}));

vi.mock('../medical/vitals', () => ({
  VitalTrendsPanel: ({
    opened,
    vitalType,
    patientLabel,
  }: {
    opened: boolean;
    vitalType: string | null;
    patientLabel?: string;
  }) =>
    opened ? (
      <div data-testid="vital-trends-panel" data-patient-label={patientLabel}>
        trend:{vitalType}
      </div>
    ) : null,
}));

const renderPanel = () =>
  render(
    <MemoryRouter>
      <MantineProvider>
        <VitalInsightsPanel
          patientId={7}
          patientHeight={68}
          patientLabel="Synthetic Household Member"
        />
      </MantineProvider>
    </MemoryRouter>
  );

describe('VitalInsightsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.getPatientVitals.mockResolvedValue([
      {
        id: 1,
        recorded_date: '2026-01-01T08:00:00Z',
        systolic_bp: 118,
        diastolic_bp: 76,
        weight: 150,
      },
      {
        id: 2,
        recorded_date: '2026-02-01T08:00:00Z',
        systolic_bp: 121,
        diastolic_bp: 79,
        weight: 152,
      },
    ]);
    serviceMocks.getPatientVitalsStats.mockResolvedValue({ total_readings: 2 });
  });

  it('loads a reconciled catalog and opens the existing trend surface', async () => {
    renderPanel();

    expect(await screen.findByText('121/79')).toBeInTheDocument();
    expect(screen.getByText('68.9')).toBeInTheDocument();
    expect(serviceMocks.getPatientVitals).toHaveBeenCalledWith(7);
    expect(serviceMocks.getPatientVitalsStats).toHaveBeenCalledWith(7);

    const bloodPressureValue = screen.getByText('121/79');
    const card = bloodPressureValue.closest('button');
    expect(card).not.toBeNull();
    fireEvent.click(card!);

    expect(await screen.findByTestId('vital-trends-panel')).toHaveTextContent(
      'trend:blood_pressure'
    );
    expect(screen.getByTestId('vital-trends-panel')).toHaveAttribute(
      'data-patient-label',
      'Synthetic Household Member'
    );
  });

  it('labels type counts as partial when the server total exceeds loaded rows', async () => {
    serviceMocks.getPatientVitalsStats.mockResolvedValue({
      total_readings: 12,
    });
    renderPanel();

    expect(await screen.findByText('121/79')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The server contains 12 records, but this directory loaded 2. Counts by type are partial.'
      )
    ).toBeInTheDocument();
  });

  it('keeps empty and failed record loads explicit', async () => {
    serviceMocks.getPatientVitals.mockResolvedValueOnce([]);
    serviceMocks.getPatientVitalsStats.mockResolvedValueOnce({
      total_readings: 0,
    });
    const { unmount } = renderPanel();
    expect(
      await screen.findByText(
        'No structured vital-sign measurements have been stored for this family member.'
      )
    ).toBeInTheDocument();
    unmount();

    serviceMocks.getPatientVitals.mockRejectedValueOnce(new Error('synthetic'));
    serviceMocks.getPatientVitalsStats.mockResolvedValueOnce({
      total_readings: 0,
    });
    renderPanel();
    expect(
      await screen.findByText('Unable to load vital signs.')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(serviceMocks.getPatientVitals).toHaveBeenCalled()
    );
  });
});
