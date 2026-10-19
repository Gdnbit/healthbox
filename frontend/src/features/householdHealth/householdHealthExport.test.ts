import { describe, expect, it } from 'vitest';
import type { HouseholdHealthSnapshot } from './types';
import {
  buildHouseholdHealthExportFilename,
  buildHouseholdHealthExportModel,
  renderHouseholdHealthExportCsv,
  renderHouseholdHealthExportText,
} from './householdHealthExport';

const snapshot: HouseholdHealthSnapshot = {
  subjectState: 'ready',
  metrics: [
    {
      id: 'vital:blood-pressure',
      kind: 'vital',
      label: '血压',
      unit: 'mmHg',
      latestStatus: null,
      points: [
        {
          id: 'bp-old',
          date: '2020-06-17',
          value: 120,
          secondaryValue: 78,
          sourceDocumentId: null,
          status: null,
        },
        {
          id: 'bp-cutoff',
          date: '2021-06-18',
          value: 122,
          secondaryValue: 79,
          sourceDocumentId: 4,
          status: null,
        },
        {
          id: 'bp-latest',
          date: '2026-06-18',
          value: 124,
          secondaryValue: 80,
          sourceDocumentId: 9,
          status: '正常',
        },
      ],
    },
    {
      id: 'lab:glucose',
      kind: 'lab',
      label: '=空腹血糖',
      unit: 'mmol/L',
      latestStatus: '正常',
      points: [
        {
          id: 'glucose-latest',
          date: '2026-06-18',
          value: 5,
          secondaryValue: null,
          sourceDocumentId: 9,
          status: '正常',
        },
      ],
    },
  ],
  reports: [
    {
      id: 'source:4',
      sourceDocumentId: 4,
      title: '旧报告',
      originalFilename: 'old-report.pdf',
      date: '2021-06-18',
      facility: '体检中心',
      typeLabel: '体检报告',
      statusLabel: '原件已保存',
      sizeLabel: '1 MB',
      mimeType: 'application/pdf',
    },
    {
      id: 'source:9',
      sourceDocumentId: 9,
      title: '+年度报告',
      originalFilename: 'annual-report.pdf',
      date: '2026-06-18',
      facility: '@市医院',
      typeLabel: '体检报告',
      statusLabel: '原件已保存',
      sizeLabel: '2 MB',
      mimeType: 'application/pdf',
    },
  ],
  errors: [{ section: 'reports', message: '一部分来源未加载' }],
  loadedAt: '2026-06-18T09:00:00Z',
};

describe('householdHealthExport', () => {
  it('builds a deterministic all-loaded model with dual vital values and provenance', () => {
    const model = buildHouseholdHealthExportModel(
      '林晓',
      snapshot,
      { scope: 'all-loaded' },
      '2026-07-27T03:00:00.000Z'
    );

    expect(model.dateRangeLabel).toBe('2020-06-17—2026-06-18');
    expect(model.observations.map(item => item.displayValue)).toEqual([
      '120/78',
      '122/79',
      '5',
      '124/80',
    ]);
    expect(
      model.observations.find(item => item.id === 'bp-latest')?.sourceDocumentId
    ).toBe(9);
    expect(model.reports.map(item => item.sourceDocumentId)).toEqual([4, 9]);
    expect(model.sourceErrors).toEqual(['reports: 一部分来源未加载']);
  });

  it('anchors the five-year range to the newest loaded record and keeps the inclusive cutoff', () => {
    const model = buildHouseholdHealthExportModel(
      '林晓',
      snapshot,
      { scope: 'recent-five-years' },
      '2026-07-27T03:00:00.000Z'
    );

    expect(model.observations.map(item => item.id)).toEqual([
      'bp-cutoff',
      'glucose-latest',
      'bp-latest',
    ]);
    expect(model.reports).toHaveLength(2);
    expect(model.dateRangeLabel).toBe('2021-06-18—2026-06-18');
  });

  it('limits the latest-report scope to that source and selected metrics', () => {
    const model = buildHouseholdHealthExportModel(
      '林晓',
      snapshot,
      {
        scope: 'latest-report',
        metricIds: ['lab:glucose'],
        includeReports: true,
      },
      '2026-07-27T03:00:00.000Z'
    );

    expect(model.observations.map(item => item.id)).toEqual(['glucose-latest']);
    expect(model.reports.map(item => item.sourceDocumentId)).toEqual([9]);
    expect(model.dateRangeLabel).toBe('2026-06-18');
  });

  it('renders formula-safe BOM CSV and a source-backed readable summary', () => {
    const model = buildHouseholdHealthExportModel(
      '林晓',
      snapshot,
      { scope: 'latest-report' },
      '2026-07-27T03:00:00.000Z'
    );
    const csv = renderHouseholdHealthExportCsv(model);
    const text = renderHouseholdHealthExportText(model);

    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain('"\'=空腹血糖"');
    expect(csv).toContain('"\' +年度报告"'.replace(' ', ''));
    expect(csv).toContain('"\'@市医院"');
    expect(csv).toContain('"124/80"');
    expect(text).toContain('主体：林晓');
    expect(text).toContain('文档 #9');
    expect(text).toContain('不构成诊断或治疗建议');
    expect(buildHouseholdHealthExportFilename(model.generatedAt)).toBe(
      'household-health-summary-2026-07-27.csv'
    );
    expect(buildHouseholdHealthExportFilename(model.generatedAt)).not.toContain(
      '林晓'
    );
  });
});
