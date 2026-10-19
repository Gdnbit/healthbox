import { describe, expect, it, vi } from 'vitest';
import type {
  ComponentCatalogResponse,
  TrendResponse,
} from '../../services/api/labTestComponentApi';
import type { HealthSourceDocument } from '../../services/api/healthImportApi';
import {
  loadHouseholdHealthSnapshot,
  type HouseholdHealthDataDependencies,
} from './householdHealthData';
import {
  buildHouseholdHealthExportModel,
  renderHouseholdHealthExportText,
} from './householdHealthExport';
import {
  buildHouseholdAiHandoff,
  renderHouseholdAiHandoffText,
} from './householdHealthAiHandoff';

const sourceDocument = (
  overrides: Partial<HealthSourceDocument> = {}
): HealthSourceDocument => ({
  id: 41,
  patient_id: 7,
  display_name: '年度体检报告',
  original_filename: 'report.pdf',
  document_type: 'checkup',
  report_date: '2026-06-18',
  facility: '市第一医院',
  mime_type: 'application/pdf',
  size_bytes: 1024,
  sha256: 'abc',
  storage_backend: 'local',
  status: 'active',
  created_at: '2026-06-18T09:00:00Z',
  updated_at: '2026-06-18T09:00:00Z',
  ...overrides,
});

const trend = (
  testName: string,
  unit: string,
  values: Array<[number, string, number]>
): TrendResponse => ({
  test_name: testName,
  unit,
  data_points: values.map(([id, recordedDate, value]) => ({
    id,
    value,
    unit,
    recorded_date: recordedDate,
    created_at: `${recordedDate}T08:00:00Z`,
    lab_result: { id: id + 100, test_name: testName },
  })),
  statistics: {
    count: values.length,
    latest: values[values.length - 1]?.[2],
    average: null,
    min: null,
    max: null,
    std_dev: null,
    trend_direction: 'stable',
    normal_count: values.length,
    abnormal_count: 0,
  },
  is_aggregated: false,
  result_type: 'quantitative',
});

const dependencies = (
  overrides: Partial<HouseholdHealthDataDependencies> = {}
): HouseholdHealthDataDependencies => ({
  getVitals: vi.fn().mockResolvedValue([]),
  getCatalog: vi.fn().mockResolvedValue({
    items: [],
    total: 0,
  } satisfies ComponentCatalogResponse),
  getTrend: vi.fn(),
  getSourceDocuments: vi.fn().mockResolvedValue([]),
  getParseTasks: vi.fn().mockResolvedValue([]),
  getImportBatches: vi.fn().mockResolvedValue([]),
  ...overrides,
});

describe('loadHouseholdHealthSnapshot', () => {
  it('does not call record APIs when no subject is selected', async () => {
    const deps = dependencies();

    const result = await loadHouseholdHealthSnapshot(null, deps);

    expect(result.subjectState).toBe('missing');
    expect(result.metrics).toEqual([]);
    expect(result.reports).toEqual([]);
    expect(deps.getVitals).not.toHaveBeenCalled();
    expect(deps.getCatalog).not.toHaveBeenCalled();
  });

  it('keeps only real vital observations and prioritizes useful household trends', async () => {
    const deps = dependencies({
      getVitals: vi.fn().mockResolvedValue({
        data: [
          {
            id: 2,
            recorded_date: '2026-01-02',
            systolic_bp: 124,
            diastolic_bp: 80,
            weight: 150,
          },
          {
            id: 1,
            recorded_date: '2025-01-02',
            systolic_bp: 128,
            diastolic_bp: 82,
            weight: 152,
          },
        ],
      }),
    });

    const result = await loadHouseholdHealthSnapshot(7, deps);

    expect(result.metrics.map(metric => metric.label)).toEqual([
      '血压',
      '体重',
    ]);
    expect(result.metrics[0].points).toEqual([
      {
        id: 'vital:blood_pressure:1',
        date: '2025-01-02',
        value: 128,
        secondaryValue: 82,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'vital:blood_pressure:2',
        date: '2026-01-02',
        value: 124,
        secondaryValue: 80,
        sourceDocumentId: null,
        status: null,
      },
    ]);
  });

  it('converts imperial vital storage values before dashboard, export, print, and AI handoff rendering', async () => {
    const deps = dependencies({
      getVitals: vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            recorded_date: '2025-01-02',
            weight: 150,
            temperature: 98.6,
          },
          {
            id: 2,
            recorded_date: '2026-01-02',
            weight: 160,
            temperature: 100.4,
          },
        ],
      }),
    });

    const result = await loadHouseholdHealthSnapshot(7, deps);
    const weight = result.metrics.find(metric => metric.id === 'vital:weight');
    const temperature = result.metrics.find(
      metric => metric.id === 'vital:temperature'
    );

    expect(weight?.unit).toBe('kg');
    expect(weight?.points.map(point => point.value)).toEqual([68, 72.6]);
    expect(temperature?.unit).toBe('°C');
    expect(temperature?.points.map(point => point.value)).toEqual([37, 38]);

    const exportModel = buildHouseholdHealthExportModel(
      '虚构成员',
      result,
      { scope: 'all-loaded', includeReports: false },
      '2026-07-29T00:00:00Z'
    );
    expect(
      exportModel.observations.find(item => item.id === 'vital:weight:1')
    ).toMatchObject({ displayValue: '68', unit: 'kg' });
    expect(
      exportModel.observations.find(item => item.id === 'vital:temperature:1')
    ).toMatchObject({ displayValue: '37', unit: '°C' });

    const printableAndCopyableText =
      renderHouseholdHealthExportText(exportModel);
    expect(printableAndCopyableText).toContain('体重：68 kg');
    expect(printableAndCopyableText).toContain('体温：37 °C');
    expect(printableAndCopyableText).not.toContain('体重：150 kg');
    expect(printableAndCopyableText).not.toContain('体温：98.6 °C');

    const handoff = buildHouseholdAiHandoff(result, {
      questionId: 'recent_changes',
      question: '最近有哪些变化？',
      range: 'all',
      selectedMetricIds: ['vital:weight', 'vital:temperature'],
      generatedAt: '2026-07-29T00:00:00Z',
    });
    const handoffText = renderHouseholdAiHandoffText(handoff);
    expect(handoffText).toContain('体重：68 kg');
    expect(handoffText).toContain('体温：37 °C');
    expect(handoffText).not.toContain('体重：150 kg');
    expect(handoffText).not.toContain('体温：98.6 °C');
  });

  it('keeps lab units in separate series and does not interpolate missing dates', async () => {
    const catalog: ComponentCatalogResponse = {
      total: 2,
      items: [
        {
          test_name: '空腹血糖',
          trend_test_name: 'glucose',
          latest_value: 5,
          unit: 'mmol/L',
          reading_count: 2,
          trend_direction: 'stable',
          result_type: 'quantitative',
        },
        {
          test_name: '空腹血糖',
          trend_test_name: 'glucose',
          latest_value: 90,
          unit: 'mg/dL',
          reading_count: 2,
          trend_direction: 'stable',
          result_type: 'quantitative',
        },
      ],
    };
    const getTrend = vi.fn(
      (
        _patientId: number,
        _name: string,
        options?: { limit?: number; unit?: string | null }
      ) =>
        options?.unit === 'mmol/L'
          ? Promise.resolve(
              trend('glucose', 'mmol/L', [
                [1, '2024-01-01', 5.2],
                [2, '2026-01-01', 5],
              ])
            )
          : Promise.resolve(
              trend('glucose', 'mg/dL', [
                [3, '2024-01-01', 94],
                [4, '2026-01-01', 90],
              ])
            )
    );
    const deps = dependencies({
      getCatalog: vi.fn().mockResolvedValue(catalog),
      getTrend,
    });

    const result = await loadHouseholdHealthSnapshot(7, deps);

    expect(result.metrics).toHaveLength(2);
    expect(result.metrics.map(metric => metric.id)).toEqual([
      'lab:glucose:mmol/L',
      'lab:glucose:mg/dL',
    ]);
    expect(result.metrics[0].points.map(point => point.date)).toEqual([
      '2024-01-01',
      '2026-01-01',
    ]);
    expect(getTrend).toHaveBeenCalledWith(
      7,
      'glucose',
      expect.objectContaining({ unit: 'mmol/L' }),
      undefined
    );
  });

  it('keeps the complete scalar catalog for archive, export, and AI scope instead of the dashboard card limit', async () => {
    const items: ComponentCatalogResponse['items'] = Array.from(
      { length: 7 },
      (_, index) => ({
        test_name: `虚构指标 ${index + 1}`,
        trend_test_name: `synthetic_metric_${index + 1}`,
        latest_value: index + 1,
        unit: 'u',
        reading_count: index === 6 ? 1 : 2,
        trend_direction: 'stable',
        result_type: 'quantitative',
      })
    );
    const getTrend = vi.fn(
      (_patientId: number, name: string, options?: { unit?: string | null }) => {
        const index = Number(name.replace('synthetic_metric_', ''));
        return Promise.resolve(
          trend(
            name,
            options?.unit || 'u',
            index === 7
              ? [[70, '2026-01-01', 7]]
              : [
                  [index * 10, '2025-01-01', index],
                  [index * 10 + 1, '2026-01-01', index + 0.1],
                ]
          )
        );
      }
    );
    const deps = dependencies({
      getCatalog: vi.fn().mockResolvedValue({ items, total: items.length }),
      getTrend,
    });

    const result = await loadHouseholdHealthSnapshot(7, deps);

    expect(result.metrics).toHaveLength(7);
    expect(getTrend).toHaveBeenCalledTimes(7);
    expect(result.metrics.at(-1)).toMatchObject({
      id: 'lab:synthetic_metric_7:u',
      points: [expect.objectContaining({ value: 7 })],
    });
  });

  it('preserves available sections when another API fails', async () => {
    const deps = dependencies({
      getVitals: vi.fn().mockRejectedValue(new Error('vitals unavailable')),
      getSourceDocuments: vi
        .fn()
        .mockResolvedValue([sourceDocument({ size_bytes: 2_621_440 })]),
    });

    const result = await loadHouseholdHealthSnapshot(7, deps);

    expect(result.reports).toEqual([
      expect.objectContaining({
        id: 'source:41',
        title: '年度体检报告',
        date: '2026-06-18',
        facility: '市第一医院',
        sizeLabel: '2.5 MB',
      }),
    ]);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ section: 'vitals' })])
    );
  });

  it('joins source documents with parse tasks and review batches', async () => {
    const deps = dependencies({
      getSourceDocuments: vi.fn().mockResolvedValue([sourceDocument()]),
      getParseTasks: vi.fn().mockResolvedValue([
        {
          id: 51,
          patient_id: 7,
          source_document_id: 41,
          created_by_user_id: 3,
          import_batch_id: 61,
          idempotency_key: 'parse-51',
          parser_name: 'local-core-lab',
          parser_version: '1.0.0',
          status: 'succeeded',
          attempt_count: 1,
          summary: {},
          created_at: '2026-06-18T10:00:00Z',
          updated_at: '2026-06-18T10:03:00Z',
        },
      ]),
      getImportBatches: vi.fn().mockResolvedValue([
        {
          id: 61,
          patient_id: 7,
          source_document_id: 41,
          idempotency_key: 'batch-61',
          parser_name: 'local-core-lab',
          parser_version: '1.0.0',
          status: 'reviewed',
          summary: {
            total: 2,
            pending: 0,
            accepted: 2,
            rejected: 0,
            duplicate: 0,
            quality_issue_count: 0,
          },
          items: [],
          created_at: '2026-06-18T10:02:00Z',
          reviewed_at: '2026-06-18T10:04:00Z',
        },
      ]),
    });

    const result = await loadHouseholdHealthSnapshot(7, deps);

    expect(result.reports[0]).toMatchObject({
      statusLabel: '待确认入库',
      processingState: 'ready_to_commit',
      processingAction: 'review_batch',
      processingActionLabel: '确认入库',
      parseTaskId: 51,
      importBatchId: 61,
    });
  });
});
