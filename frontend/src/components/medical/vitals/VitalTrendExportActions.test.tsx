import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '../../../utils/downloadUtils';
import type { VitalTrendResponse } from './types';
import VitalTrendExportActions from './VitalTrendExportActions';

vi.mock('../../../utils/downloadUtils', () => ({
  downloadBlob: vi.fn(),
}));

const response: VitalTrendResponse = {
  vital_type: 'blood_pressure',
  vital_type_label: 'Synthetic Blood Pressure',
  unit: 'mmHg',
  data_points: [
    {
      id: 901,
      value: 118,
      secondary_value: 76,
      recorded_date: '2026-01-01T08:00:00Z',
    },
    {
      id: 902,
      value: 121,
      secondary_value: 79,
      recorded_date: '2026-02-01T08:00:00Z',
    },
  ],
  statistics: {
    count: 2,
    latest: 121,
    average: 119.5,
    min: 118,
    max: 121,
    std_dev: 1.5,
    secondary_latest: 79,
    secondary_average: 77.5,
    secondary_min: 76,
    secondary_max: 79,
    secondary_std_dev: 1.5,
  },
  reference_range: null,
};

const renderActions = (data: VitalTrendResponse = response) =>
  render(
    <MantineProvider>
      <VitalTrendExportActions
        trendData={data}
        patientLabel="Synthetic Household Member"
        timeRangeLabel="All Dates"
      />
    </MantineProvider>
  );

describe('VitalTrendExportActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('downloads a standalone SVG with a privacy-safe filename', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Download SVG' })
    );

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(blob.type).toBe('image/svg+xml;charset=utf-8');
    expect(filename).toMatch(
      /^health-vital-blood-pressure-\d{8}T\d{6}Z\.svg$/
    );
    expect(filename).not.toContain('Household');
  });

  it('downloads a complete UTF-8 CSV with a privacy-safe filename', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Download CSV' })
    );

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(blob.type).toBe('text/csv;charset=utf-8');
    expect(filename).toMatch(
      /^health-vital-blood-pressure-\d{8}T\d{6}Z\.csv$/
    );
  });

  it('prints the dedicated report and always removes the body marker', async () => {
    renderActions();

    const report = screen.getByTestId('vital-trend-print-report');
    expect(report).toHaveTextContent('901');
    expect(report).toHaveTextContent('118/76');
    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Print / save PDF' })
    );

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveClass('vital-trend-printing');
  });

  it('keeps full CSV available but disables oversized visual exports', async () => {
    renderActions({
      ...response,
      data_points: Array.from({ length: 501 }, (_, index) => ({
        id: index + 1,
        value: 110 + (index % 10),
        secondary_value: 70 + (index % 8),
        recorded_date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      })),
      statistics: { ...response.statistics, count: 501 },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    expect(
      await screen.findByText(
        'SVG and print are limited to 500 observations; CSV remains complete.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Download SVG').closest('button')).toBeDisabled();
    expect(
      screen.getByText('Print / save PDF').closest('button')
    ).toBeDisabled();
    expect(screen.getByText('Download CSV').closest('button')).toBeEnabled();
  });

  it('disables export when no observations are available', () => {
    renderActions({
      ...response,
      data_points: [],
      statistics: { ...response.statistics, count: 0 },
    });

    expect(
      screen.getByRole('button', { name: 'Export and print' })
    ).toBeDisabled();
  });
});
