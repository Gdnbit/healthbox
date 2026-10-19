import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthInsights from './HealthInsights';

const apiMocks = vi.hoisted(() => ({
  getComponentCatalog: vi.fn(),
  getTrendsByPatientAndTest: vi.fn(),
  getAllForPatient: vi.fn(),
}));
const vitalApiMocks = vi.hoisted(() => ({
  getPatientVitals: vi.fn(),
  getPatientVitalsStats: vi.fn(),
}));
const coverageApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revise: vi.fn(),
  void: vi.fn(),
}));
const hookMocks = vi.hoisted(() => ({
  patientList: [{ id: 7, first_name: '虚构', last_name: '成员' }],
}));

vi.mock('../hooks/useGlobalData', () => ({
  useCurrentPatient: () => ({
    patient: { id: 7, first_name: '虚构', last_name: '成员' },
    loading: false,
  }),
  usePatientList: () => ({
    patientList: hookMocks.patientList,
    loading: false,
  }),
  useCacheManager: () => ({
    setCurrentPatient: vi.fn(),
    invalidateAll: vi.fn(),
  }),
}));

vi.mock('../components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

vi.mock('../components/medical', () => ({
  PatientSelector: () => <div data-testid="patient-selector" />,
}));

vi.mock('../components/medical/vitals', () => ({
  VitalTrendsPanel: ({ patientLabel }: { patientLabel?: string }) => (
    <div data-testid="vital-trends-props" data-patient-label={patientLabel} />
  ),
}));

vi.mock('../contexts/UserPreferencesContext', () => ({
  useUserPreferences: () => ({ unitSystem: 'metric' }),
}));

vi.mock('../hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (value: string) => value.slice(0, 10),
  }),
}));

vi.mock('../services/logger', () => ({
  default: { error: vi.fn() },
}));

vi.mock('../components/health/HealthMetricDetail', () => ({
  default: ({
    data,
    patientLabel,
    dateRangeLabel,
    baselineId,
  }: {
    data?: { test_name?: string };
    patientLabel?: string;
    dateRangeLabel?: string;
    baselineId?: number | null;
  }) => (
    <div
      data-testid="metric-detail"
      data-patient-label={patientLabel}
      data-date-range={dateRangeLabel}
      data-baseline-id={baselineId || undefined}
    >
      {data?.test_name || 'no selection'}
    </div>
  ),
}));

vi.mock('../services/api/labTestComponentApi', () => ({
  labTestComponentApi: apiMocks,
}));

vi.mock('../services/medical/vitalsService', () => ({
  vitalsService: vitalApiMocks,
}));

vi.mock('../services/api/healthCoverageApi', () => ({
  default: coverageApiMocks,
}));

vi.mock('../services/api/healthImportApi', () => ({
  default: { listSourceDocuments: vi.fn().mockResolvedValue([]) },
}));

const catalog = {
  total: 2,
  items: [
    {
      test_name: '虚构指标甲',
      trend_test_name: '虚构指标甲',
      latest_value: 12,
      unit: 'u/L',
      status: 'high',
      category: 'chemistry',
      result_type: 'quantitative' as const,
      reading_count: 3,
      trend_direction: 'stable' as const,
      latest_date: '2025-03-01',
    },
    {
      test_name: '虚构指标乙',
      trend_test_name: '虚构指标乙',
      latest_value: 8,
      unit: 'mmol/L',
      status: 'normal',
      category: 'chemistry',
      result_type: 'quantitative' as const,
      reading_count: 8,
      trend_direction: 'stable' as const,
      latest_date: '2025-02-01',
    },
  ],
};

describe('HealthInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getComponentCatalog.mockResolvedValue(catalog);
    apiMocks.getTrendsByPatientAndTest.mockResolvedValue({
      test_name: '虚构指标甲',
      unit: 'u/L',
      data_points: [],
      statistics: {
        count: 0,
        trend_direction: 'stable',
        normal_count: 0,
        abnormal_count: 0,
      },
      is_aggregated: false,
    });
    apiMocks.getAllForPatient.mockResolvedValue([]);
    vitalApiMocks.getPatientVitals.mockResolvedValue([]);
    vitalApiMocks.getPatientVitalsStats.mockResolvedValue({
      total_readings: 2,
      latest_reading_date: '2025-04-01T08:00:00Z',
    });
    coverageApiMocks.list.mockResolvedValue([]);
  });

  it('renders the dashboard shell and requests the existing metric catalog', async () => {
    render(
      <MemoryRouter>
        <MantineProvider>
          <HealthInsights />
        </MantineProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Health insights')).toBeInTheDocument();
    expect(screen.getByTestId('patient-selector')).toBeInTheDocument();
    expect(screen.getByTestId('metric-detail')).toHaveAttribute(
      'data-patient-label',
      '虚构 成员'
    );
    expect(screen.getByText('Metrics')).toBeInTheDocument();
    expect(screen.getByText('Household overview')).toBeInTheDocument();
    expect(await screen.findByText('2 vital records')).toBeInTheDocument();
    expect(
      screen.getByText('0 explicit absence statements')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Checkup coverage' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Exam comparison' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Vital signs' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Data quality' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Sources and review' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Rule-based alerts' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This page organizes records and source-report flags only. It does not provide a diagnosis or treatment advice.'
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.getComponentCatalog).toHaveBeenCalledWith(
        7,
        { limit: 500 },
        expect.any(AbortSignal)
      )
    );
    await waitFor(() =>
      expect(apiMocks.getAllForPatient).toHaveBeenCalledWith(
        7,
        expect.any(AbortSignal)
      )
    );
    await waitFor(() =>
      expect(coverageApiMocks.list).toHaveBeenCalledWith(
        7,
        false,
        expect.any(AbortSignal)
      )
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Vital signs' }));
    expect(
      await screen.findByText(
        'No structured vital-sign measurements have been stored for this family member.'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('vital-trends-props')).toHaveAttribute(
      'data-patient-label',
      '虚构 成员'
    );
    expect(screen.queryByText('Metrics')).not.toBeInTheDocument();
  });

  it('mounts the evidence-aware coverage panel for the selected member', async () => {
    render(
      <MemoryRouter initialEntries={['/health-insights?view=coverage']}>
        <MantineProvider>
          <HealthInsights />
        </MantineProvider>
      </MemoryRouter>
    );

    expect(
      await screen.findByText(/Coverage evidence|coverageEvidence\.title/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Counts are shown as evidence only|coverageEvidence\.noPercentageNotice/
      )
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(coverageApiMocks.list).toHaveBeenCalledWith(
        7,
        false,
        expect.any(AbortSignal)
      )
    );
  });

  it('keeps the member summary usable when only vital statistics fail', async () => {
    vitalApiMocks.getPatientVitalsStats.mockRejectedValue(
      new Error('synthetic stats failure')
    );

    render(
      <MemoryRouter>
        <MantineProvider>
          <HealthInsights />
        </MantineProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('0 vital records')).toBeInTheDocument();
    expect(
      screen.queryByText('This member’s summary could not be loaded.')
    ).not.toBeInTheDocument();
  });

  it('restores an explicit metric date window from the URL and sends exact inclusive dates', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/health-insights?view=metrics&metric_from=2025-01-01&metric_to=2025-12-31&metric_baseline=702',
        ]}
      >
        <MantineProvider>
          <HealthInsights />
        </MantineProvider>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('health-metric-date-from')).toHaveValue(
      '2025-01-01'
    );
    expect(screen.getByTestId('health-metric-date-to')).toHaveValue(
      '2025-12-31'
    );
    await waitFor(() =>
      expect(apiMocks.getTrendsByPatientAndTest).toHaveBeenCalledWith(
        7,
        '虚构指标甲',
        {
          limit: 500,
          unit: 'u/L',
          dateFrom: '2025-01-01',
          dateTo: '2025-12-31',
        },
        expect.any(AbortSignal)
      )
    );
    expect(screen.getByTestId('metric-detail')).toHaveAttribute(
      'data-baseline-id',
      '702'
    );
  });

  it('restores exact exam episode keys from the URL and renders a deterministic delta', async () => {
    apiMocks.getAllForPatient.mockResolvedValue([
      {
        id: 701,
        lab_result_id: 801,
        test_name: 'Synthetic metric A',
        canonical_test_name: 'synthetic-a',
        value: 10,
        unit: 'u/L',
        result_type: 'quantitative',
        completed_date: '2025-01-10',
        source_document_id: 101,
      },
      {
        id: 702,
        lab_result_id: 802,
        test_name: 'Synthetic metric A',
        canonical_test_name: 'synthetic-a',
        value: 12,
        unit: 'u/L',
        result_type: 'quantitative',
        completed_date: '2026-01-10',
        source_document_id: 102,
      },
    ]);

    render(
      <MemoryRouter
        initialEntries={[
          '/health-insights?view=exams&exam_target=source%3A102&exam_baseline=source%3A101',
        ]}
      >
        <MantineProvider>
          <HealthInsights />
        </MantineProvider>
      </MemoryRouter>
    );

    expect(await screen.findByText('Exam comparison')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Target exam' })).toHaveValue(
      '2026-01-10 · Source document #102'
    );
    expect(
      screen.getByRole('textbox', { name: 'Earlier baseline exam' })
    ).toHaveValue('2025-01-10 · Source document #101');
    expect(screen.getByText('+2 u/L')).toBeInTheDocument();
  });
});
