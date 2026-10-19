import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrendResponse } from '../../services/api/labTestComponentApi';
import { downloadBlob } from '../../utils/downloadUtils';
import HealthMetricExportActions from './HealthMetricExportActions';

vi.mock('../../utils/downloadUtils', () => ({
  downloadBlob: vi.fn(),
}));

const response: TrendResponse = {
  test_name: 'Synthetic Marker',
  unit: 'mmol/L',
  category: 'chemistry',
  result_type: 'quantitative',
  is_aggregated: false,
  statistics: {
    count: 2,
    trend_direction: 'stable',
    normal_count: 2,
    abnormal_count: 0,
    result_type: 'quantitative',
  },
  data_points: [
    {
      id: 1,
      value: 5.2,
      unit: 'mmol/L',
      status: 'normal',
      ref_range_min: 3.9,
      ref_range_max: 6.1,
      recorded_date: '2025-03-01',
      created_at: '2025-03-01T00:00:00Z',
      lab_result: { id: 10, test_name: 'Synthetic Source A' },
    },
    {
      id: 2,
      value: 5.4,
      unit: 'mmol/L',
      status: 'normal',
      ref_range_min: 3.9,
      ref_range_max: 6.1,
      recorded_date: '2026-03-01',
      created_at: '2026-03-01T00:00:00Z',
      lab_result: { id: 11, test_name: 'Synthetic Source B' },
    },
  ],
};

const renderActions = (data: TrendResponse = response) =>
  render(
    <MantineProvider>
      <HealthMetricExportActions
        data={data}
        patientLabel="Synthetic Household Member"
      />
    </MantineProvider>
  );

describe('HealthMetricExportActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('downloads SVG with a portable MIME type and privacy-safe name', async () => {
    renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Download SVG' })
    );
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [svgBlob, svgName] = vi.mocked(downloadBlob).mock.calls[0];
    expect(svgBlob.type).toBe('image/svg+xml;charset=utf-8');
    expect(svgName).toMatch(
      /^health-metric-synthetic-marker-\d{8}T\d{6}Z\.svg$/
    );
    expect(svgName).not.toContain('Household');
  });

  it('downloads CSV with a portable MIME type and privacy-safe name', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Download CSV' })
    );
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [csvBlob, csvName] = vi.mocked(downloadBlob).mock.calls[0];
    expect(csvBlob.type).toBe('text/csv;charset=utf-8');
    expect(csvName).toMatch(
      /^health-metric-synthetic-marker-\d{8}T\d{6}Z\.csv$/
    );
  });

  it('prints only the dedicated report and cleans the body print marker', async () => {
    renderActions();

    expect(screen.getByTestId('health-metric-print-report')).toHaveTextContent(
      'Synthetic Source A'
    );
    expect(screen.getByTestId('health-metric-print-report')).toHaveTextContent(
      'Synthetic Source B'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export and print' }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Print / save PDF' })
    );

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(document.body).not.toHaveClass('health-metric-printing');
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
