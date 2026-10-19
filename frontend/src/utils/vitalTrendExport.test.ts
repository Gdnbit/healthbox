import { describe, expect, it } from 'vitest';
import vitalCase from '../../../evals/vital-export/cases/vital-export.json';
import golden from '../../../evals/vital-export/golden/export-contract.json';
import type { VitalTrendResponse } from '../components/medical/vitals/types';
import {
  buildVitalTrendExportFilename,
  buildVitalTrendExportModel,
  renderVitalTrendCsv,
  renderVitalTrendSvg,
  type VitalTrendExportLabels,
} from './vitalTrendExport';
import { buildHealthBaselineComparison } from './healthBaselineComparison';

const labels: VitalTrendExportLabels = {
  member: '家庭成员',
  generatedAt: '生成时间',
  vitalType: '生命体征',
  timeRange: '时间范围',
  mode: '可视化模式',
  modeLabels: {
    empty: '暂无数据',
    snapshot: '最新快照',
    comparison: '离散比较',
    trend: '长期趋势',
  },
  observations: '已存观测记录',
  date: '日期',
  primaryValue: '主值',
  secondaryValue: '次值',
  displayValue: '显示值',
  unit: '单位',
  context: '测量场景',
  recordId: '生命体征记录 ID',
  primarySeries: '收缩压',
  secondarySeries: '舒张压',
  noContext: '未标记',
  disclaimer: '本导出仅整理已存生命体征记录，不构成诊断。',
  visualLimit: '记录超过 500 条，仅允许导出 CSV。',
  baselineRecord: '基线记录',
  targetRecord: '目标记录',
  absoluteChange: '绝对差值',
};

const trend = vitalCase.trend as VitalTrendResponse;

describe('vital trend portable export', () => {
  it('builds the golden dual-series model without mutating input', () => {
    const input = structuredClone(trend);
    const model = buildVitalTrendExportModel(input, {
      patientLabel: vitalCase.patientLabel,
      timeRangeLabel: vitalCase.timeRangeLabel,
      generatedAt: new Date(vitalCase.generatedAt),
    });

    expect(model.fileStem).toBe(golden.fileStem);
    expect(model.mode).toBe(golden.mode);
    expect(model.dualSeries).toBe(golden.dualSeries);
    expect(model.visualExportAllowed).toBe(golden.visualExportAllowed);
    expect(model.observations.map(item => item.id)).toEqual(
      golden.observationOrder
    );
    expect(model.observations.map(item => item.primaryValue)).toEqual(
      golden.primaryValues
    );
    expect(model.observations.map(item => item.secondaryValue)).toEqual(
      golden.secondaryValues
    );
    expect(model.unit).toBe(golden.unit);
    expect(buildVitalTrendExportFilename(model, 'svg')).toBe(
      `${golden.fileStem}.svg`
    );
    expect(input).toEqual(trend);
  });

  it('renders a BOM CSV with every record ID and formula defense', () => {
    const hostile = structuredClone(trend);
    hostile.vital_type_label = '=SUM(A1:A2)';
    hostile.data_points[0].glucose_context = '+cmd';
    const model = buildVitalTrendExportModel(hostile, {
      patientLabel: '@Synthetic',
      timeRangeLabel: '-all dates',
      generatedAt: new Date(vitalCase.generatedAt),
    });
    const csv = renderVitalTrendCsv(model, labels);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    for (const id of golden.observationOrder) {
      expect(csv).toContain(`"${id}"`);
    }
    expect(csv).toContain('"\'=SUM(A1:A2)"');
    expect(csv).toContain('"\'@Synthetic"');
    expect(csv).toContain('"\'-all dates"');
    expect(csv).toContain('"\'+cmd"');
    expect(csv).toContain('"118","76","118/76"');
  });

  it('renders an accessible standalone SVG with two series and full IDs', () => {
    const model = buildVitalTrendExportModel(trend, {
      patientLabel: vitalCase.patientLabel,
      timeRangeLabel: vitalCase.timeRangeLabel,
      generatedAt: new Date(vitalCase.generatedAt),
    });
    const svg = renderVitalTrendSvg(model, labels);

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('<title id="vital-export-title">');
    expect(svg).toContain('<desc id="vital-export-desc">');
    expect(svg).toContain('data-series="primary"');
    expect(svg).toContain('data-series="secondary"');
    for (const id of golden.observationOrder) {
      expect(svg).toContain(`>${id}</text>`);
    }
    expect(svg).toContain(labels.disclaimer);
    expect(svg).not.toMatch(/<script|foreignObject|xlink:href/i);
  });

  it('keeps complete CSV but blocks visual export above 500 records', () => {
    const largeTrend: VitalTrendResponse = {
      ...structuredClone(trend),
      data_points: Array.from({ length: 501 }, (_, index) => ({
        id: index + 1,
        value: 60 + (index % 20),
        recorded_date: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
      })),
    };
    const model = buildVitalTrendExportModel(largeTrend, {
      patientLabel: vitalCase.patientLabel,
      timeRangeLabel: vitalCase.timeRangeLabel,
      generatedAt: new Date(vitalCase.generatedAt),
    });

    expect(model.visualExportAllowed).toBe(false);
    expect(model.observations).toHaveLength(501);
    expect(renderVitalTrendCsv(model, labels)).toContain('"501"');
    expect(() => renderVitalTrendSvg(model, labels)).toThrow(
      labels.visualLimit
    );
  });

  it('exports the exact blood-pressure baseline and both absolute deltas', () => {
    const comparison = buildHealthBaselineComparison([
      {
        id: 901,
        date: '2026-01-05T08:00:00Z',
        primaryValue: 118,
        secondaryValue: 76,
        displayValue: '118/76',
        unit: 'mmHg',
        kind: 'quantitative',
      },
      {
        id: 902,
        date: '2026-02-05T08:00:00Z',
        primaryValue: 121,
        secondaryValue: 79,
        displayValue: '121/79',
        unit: 'mmHg',
        kind: 'quantitative',
      },
    ]);
    const model = buildVitalTrendExportModel(trend, {
      patientLabel: vitalCase.patientLabel,
      timeRangeLabel: '2026-01-01 至 2026-12-31',
      generatedAt: new Date(vitalCase.generatedAt),
      comparison,
    });

    expect(model.baselineSummary).toEqual({
      baselineId: 901,
      targetId: 902,
      baselineValue: '118/76',
      targetValue: '121/79',
      change: '3/3',
    });
    for (const output of [
      renderVitalTrendCsv(model, labels),
      renderVitalTrendSvg(model, labels),
    ]) {
      expect(output).toContain('2026-01-01 至 2026-12-31');
      expect(output).toContain('901');
      expect(output).toContain('902');
      expect(output).toContain('3/3');
    }
  });
});
