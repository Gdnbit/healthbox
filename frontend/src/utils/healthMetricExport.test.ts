import { describe, expect, it } from 'vitest';
import caseFixture from '../../../evals/visualization-export/cases/metric-export.json';
import golden from '../../../evals/visualization-export/golden/export-contract.json';
import type { TrendResponse } from '../services/api/labTestComponentApi';
import {
  buildHealthMetricExportModel,
  buildHealthMetricFilename,
  renderHealthMetricCsv,
  renderHealthMetricSvg,
  type HealthMetricExportLabels,
} from './healthMetricExport';
import { buildHealthBaselineComparison } from './healthBaselineComparison';

const labels: HealthMetricExportLabels = {
  metric: '指标',
  member: '家庭成员',
  generatedAt: '生成时间',
  mode: '可视化模式',
  category: '分类',
  dateRange: '日期范围',
  baselineRecord: '基线记录',
  targetRecord: '目标记录',
  absoluteChange: '绝对差值',
  modeLabels: {
    empty: '无数据',
    snapshot: '最新快照',
    comparison: '离散比较',
    trend: '长期趋势',
    qualitative: '结果序列',
  },
  observations: '观测记录',
  date: '日期',
  value: '值',
  unit: '单位',
  status: '状态',
  referenceRange: '参考范围',
  sourceRecord: '来源记录',
  sourceId: '来源记录 ID',
  noData: '没有可导出的观测记录',
  unitMismatch: '存在多个单位，未绘制合并序列',
  disclaimer: '仅整理记录，不构成诊断',
};

const fixtureResponse = caseFixture.trend_response as unknown as TrendResponse;

describe('health metric export model', () => {
  it('matches the golden ordering, mode, provenance and private filename contract', () => {
    const model = buildHealthMetricExportModel(fixtureResponse, {
      patientLabel: caseFixture.patient_label,
      generatedAt: new Date(caseFixture.generated_at),
    });

    expect(model.mode).toBe(golden.mode);
    expect(model.observations.map(item => item.date)).toEqual(
      golden.ordered_dates
    );
    expect(model.observations).toHaveLength(golden.observation_count);
    expect(model.observations[0]).toMatchObject({
      displayValue: '5.2',
      unit: 'mmol/L',
      status: 'normal',
      referenceRange: '3.9–6.1',
      sourceName: 'Synthetic Baseline Panel',
      sourceId: 11,
    });
    expect(model.fileStem).toBe(golden.file_stem);
    expect(model.fileStem).not.toContain(caseFixture.patient_label);
    expect(buildHealthMetricFilename(model, 'svg')).toBe(
      `${golden.file_stem}.svg`
    );
  });

  it('inherits qualitative and unit-isolation rules without fabricating a line', () => {
    const qualitative = buildHealthMetricExportModel(
      {
        ...fixtureResponse,
        result_type: 'qualitative',
        statistics: {
          ...fixtureResponse.statistics,
          result_type: 'qualitative',
        },
        data_points: fixtureResponse.data_points.slice(0, 2).map(point => ({
          ...point,
          value: null,
          result_type: 'qualitative',
          qualitative_value: 'detected',
        })),
      },
      { patientLabel: 'Synthetic', generatedAt: new Date(0) }
    );
    expect(qualitative.mode).toBe('qualitative');
    expect(renderHealthMetricSvg(qualitative, labels)).toContain(
      'data-series-kind="qualitative"'
    );

    const mixedUnits = buildHealthMetricExportModel(
      {
        ...fixtureResponse,
        data_points: fixtureResponse.data_points.map((point, index) => ({
          ...point,
          unit: index === 0 ? 'mg/dL' : 'mmol/L',
        })),
      },
      { patientLabel: 'Synthetic', generatedAt: new Date(0) }
    );
    expect(mixedUnits.unitMismatch).toBe(true);
    const mixedSvg = renderHealthMetricSvg(mixedUnits, labels);
    expect(mixedSvg).toContain('data-series-kind="unit-mismatch"');
    expect(mixedSvg).not.toContain('data-series-kind="line"');
  });
});

describe('health metric portable renderers', () => {
  it('renders a BOM CSV with every source and neutralizes spreadsheet formulas', () => {
    const maliciousResponse = {
      ...fixtureResponse,
      test_name: caseFixture.malicious_text,
      data_points: fixtureResponse.data_points.map((point, index) => ({
        ...point,
        textual_value: index === 0 ? caseFixture.malicious_text : null,
        lab_result: {
          ...point.lab_result,
          test_name:
            index === 0
              ? caseFixture.malicious_text
              : point.lab_result.test_name,
        },
      })),
    } as TrendResponse;
    const model = buildHealthMetricExportModel(maliciousResponse, {
      patientLabel: caseFixture.patient_label,
      generatedAt: new Date(caseFixture.generated_at),
    });
    const csv = renderHealthMetricCsv(model, labels);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    for (const header of golden.csv.required_headers) {
      expect(csv).toContain(`"${header}"`);
    }
    for (const source of [
      'Synthetic Baseline Panel',
      'Synthetic Follow-up Panel',
    ]) {
      expect(csv).toContain(source);
    }
    expect(csv).toContain("'=HYPERLINK");
    expect(csv.split('\r\n')).toHaveLength(11 + golden.csv.row_count);
  });

  it('renders accessible standalone SVG with a complete source table and escaped text', () => {
    const maliciousResponse = {
      ...fixtureResponse,
      test_name: caseFixture.malicious_text,
      data_points: fixtureResponse.data_points.map((point, index) => ({
        ...point,
        lab_result: {
          ...point.lab_result,
          test_name:
            index === 0
              ? caseFixture.malicious_text
              : point.lab_result.test_name,
        },
      })),
    } as TrendResponse;
    const model = buildHealthMetricExportModel(maliciousResponse, {
      patientLabel: caseFixture.patient_label,
      generatedAt: new Date(caseFixture.generated_at),
    });
    const svg = renderHealthMetricSvg(model, labels);

    expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('<title id="metric-export-title">');
    expect(svg).toContain('<desc id="metric-export-desc">');
    expect(svg).toContain('data-series-kind="bars"');
    expect(svg).toContain('data-export-section="source-table"');
    expect(svg).toContain(labels.disclaimer);
    for (const source of fixtureResponse.data_points
      .slice(1)
      .map(point => point.lab_result.test_name)) {
      expect(svg).toContain(source);
    }
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('javascript:');
  });

  it('keeps the applied date range and exact baseline IDs in CSV and SVG', () => {
    const comparison = buildHealthBaselineComparison([
      {
        id: 701,
        date: '2025-01-01',
        primaryValue: 5.2,
        displayValue: '5.2',
        unit: 'mmol/L',
        kind: 'quantitative',
      },
      {
        id: 702,
        date: '2025-06-01',
        primaryValue: 5.8,
        displayValue: '5.8',
        unit: 'mmol/L',
        kind: 'quantitative',
      },
    ]);
    const model = buildHealthMetricExportModel(fixtureResponse, {
      patientLabel: caseFixture.patient_label,
      generatedAt: new Date(caseFixture.generated_at),
      dateRangeLabel: '2025-01-01 至 2025-12-31',
      comparison,
    });

    expect(model.baselineSummary).toMatchObject({
      baselineId: 701,
      targetId: 702,
      change: '0.6',
    });
    for (const output of [
      renderHealthMetricCsv(model, labels),
      renderHealthMetricSvg(model, labels),
    ]) {
      expect(output).toContain('2025-01-01 至 2025-12-31');
      expect(output).toContain('701');
      expect(output).toContain('702');
    }
  });
});
