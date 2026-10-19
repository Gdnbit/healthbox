import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TrendResponse } from '../../services/api/labTestComponentApi';
import HealthMetricDetail from './HealthMetricDetail';

const makeResponse = (count: number): TrendResponse => ({
  test_name: '虚构指标甲',
  unit: 'u/L',
  category: 'chemistry',
  result_type: 'quantitative',
  is_aggregated: false,
  data_points: Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    value: 10 + index,
    unit: 'u/L',
    status: index === count - 1 ? 'high' : 'normal',
    ref_range_min: 5,
    ref_range_max: index === 1 ? 21 : 20,
    recorded_date: `2025-${String(index + 1).padStart(2, '0')}-01`,
    created_at: `2025-${String(index + 1).padStart(2, '0')}-01T00:00:00Z`,
    result_type: 'quantitative',
    lab_result: {
      id: index + 1,
      test_name: `虚构来源 ${index + 1}`,
      completed_date: `2025-${String(index + 1).padStart(2, '0')}-01`,
    },
  })),
  statistics: {
    count,
    latest: count ? 9 + count : null,
    trend_direction: 'stable',
    normal_count: Math.max(0, count - 1),
    abnormal_count: count ? 1 : 0,
    result_type: 'quantitative',
  },
});

const renderDetail = (response: TrendResponse) =>
  render(
    <MantineProvider>
      <HealthMetricDetail
        data={response}
        loading={false}
        patientLabel="虚构 成员"
      />
    </MantineProvider>
  );

describe('HealthMetricDetail', () => {
  it('uses a discrete comparison and preserves source details for sparse data', () => {
    renderDetail(makeResponse(3));

    expect(screen.getByTestId('health-metric-visualization')).toHaveAttribute(
      'data-visualization-mode',
      'comparison'
    );
    expect(screen.getAllByText('Discrete comparison').length).toBeGreaterThan(
      0
    );
    expect(
      screen.getByText('Reference ranges changed between records.')
    ).toBeInTheDocument();
    expect(screen.getAllByText('虚构来源 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('5–20').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Export and print' })
    ).toBeEnabled();
  });

  it('only enables a long-term line view at eight valid points', () => {
    renderDetail(makeResponse(8));

    expect(screen.getByTestId('health-metric-visualization')).toHaveAttribute(
      'data-visualization-mode',
      'trend'
    );
    expect(screen.getAllByText('Long-term trend').length).toBeGreaterThan(0);
  });

  it('shows an explicit empty state when no observations are available', () => {
    renderDetail(makeResponse(0));
    expect(
      screen.getByText('No observations available for this metric.')
    ).toBeInTheDocument();
  });

  it('opens the exact lab record and source document from a trend point', () => {
    const response = makeResponse(2);
    response.data_points[1].source_document_id = 2702;
    response.data_points[1].source_page = 3;
    response.data_points[1].source_locator = 'Synthetic row';
    const openRecord = vi.fn();
    const openSource = vi.fn();

    render(
      <MantineProvider>
        <HealthMetricDetail
          data={response}
          loading={false}
          patientLabel="虚构 成员"
          onOpenLabRecord={openRecord}
          onOpenSourceDocument={openSource}
        />
      </MantineProvider>
    );

    const sourceRow = screen.getByText(/Synthetic row/).closest('tr');
    expect(sourceRow).not.toBeNull();
    fireEvent.click(
      within(sourceRow as HTMLTableRowElement).getByRole('button', {
        name: 'visualizationContext.source.openRecord',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'visualizationContext.source.openSource',
      })
    );
    expect(openRecord).toHaveBeenCalledWith(2);
    expect(openSource).toHaveBeenCalledWith(2702);
    expect(screen.getByText(/Synthetic row/)).toBeInTheDocument();
  });
});
