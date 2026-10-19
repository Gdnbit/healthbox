import { describe, expect, it } from 'vitest';
import type { HouseholdHealthSnapshot } from '../types';
import {
  buildHouseholdAiHandoff,
  renderHouseholdAiHandoffText,
} from '../householdHealthAiHandoff';

const snapshot: HouseholdHealthSnapshot = {
  subjectState: 'ready',
  metrics: [
    {
      id: 'vital:weight',
      kind: 'vital',
      label: '体重',
      unit: 'kg',
      latestStatus: null,
      points: [
        {
          id: 'vital:weight:1',
          date: '2022-06-17',
          value: 68,
          secondaryValue: null,
          sourceDocumentId: 91,
          status: null,
        },
        {
          id: 'vital:weight:2',
          date: '2024-06-18',
          value: 70,
          secondaryValue: null,
          sourceDocumentId: 92,
          status: null,
        },
        {
          id: 'vital:weight:3',
          date: '2026-06-18',
          value: 69,
          secondaryValue: null,
          sourceDocumentId: 93,
          status: null,
        },
      ],
    },
  ],
  reports: [
    {
      id: 'report-93',
      sourceDocumentId: 93,
      title: '林晓年度体检报告',
      originalFilename: 'lin-xiao-private-report.pdf',
      date: '2026-06-18',
      facility: '示例医院',
      typeLabel: '体检报告',
      statusLabel: '原件已保存',
      sizeLabel: '1 MB',
      mimeType: 'application/pdf',
    },
  ],
  errors: [
    {
      section: 'labs',
      message: 'request failed at E:\\private\\health\\report.pdf',
    },
  ],
  loadedAt: '2026-06-18T10:00:00Z',
};

describe('householdHealthAiHandoff', () => {
  it('builds a bounded cited package anchored to the latest observation', () => {
    const model = buildHouseholdAiHandoff(snapshot, {
      questionId: 'recent_changes',
      question: '最近有哪些变化？',
      range: '3y',
      generatedAt: '2026-07-28T03:30:00Z',
    });

    expect(model.status).toBe('ready');
    expect(model.templateVersion).toBe('household-ai-handoff@1.0.0');
    expect(model.dataCutoff).toBe('2026-06-18');
    expect(model.observations.map(item => item.recordId)).toEqual([
      'vital:weight:2',
      'vital:weight:3',
    ]);
    expect(model.observations.map(item => item.citationId)).toEqual([
      'R1',
      'R2',
    ]);
    expect(model.totalObservationCount).toBe(2);
    expect(model.omittedObservationCount).toBe(0);

    const text = renderHouseholdAiHandoffText(model);
    expect(text).toContain('主体：当前本人档案');
    expect(text).toContain('[R1]');
    expect(text).toContain('数据截止：2026-06-18');
    expect(text).toContain('检验分区暂时未完整加载');
    expect(text).toContain('本地生成，尚未自动发送给任何模型');
    expect(text).not.toContain('林晓');
    expect(text).not.toContain('lin-xiao-private-report.pdf');
    expect(text).not.toContain('示例医院');
    expect(text).not.toContain('文档 #93');
    expect(text).not.toContain('E:\\private\\health');
  });

  it('blocks screening scheduling when no published deterministic state exists', () => {
    const model = buildHouseholdAiHandoff(snapshot, {
      questionId: 'screening_schedule',
      question: '哪些检查可能需要安排？',
      range: 'all',
      generatedAt: '2026-07-28T03:30:00Z',
    });

    expect(model.status).toBe('blocked');
    expect(model.blockedReason).toBe('screening_state_unavailable');
    expect(model.observations).toEqual([]);
    expect(renderHouseholdAiHandoffText(model)).toContain(
      '尚未发布可用的确定性筛查状态'
    );
  });

  it('does not claim a usable package when no structured observations exist', () => {
    const model = buildHouseholdAiHandoff(
      { ...snapshot, metrics: [], reports: [] },
      {
        questionId: 'custom',
        question: '请帮我整理资料',
        range: 'all',
        generatedAt: '2026-07-28T03:30:00Z',
      }
    );

    expect(model.status).toBe('blocked');
    expect(model.blockedReason).toBe('no_structured_observations');
  });

  it('bounds the service request to 200 records and reports omissions', () => {
    const denseSnapshot: HouseholdHealthSnapshot = {
      ...snapshot,
      metrics: [
        {
          ...snapshot.metrics[0],
          points: Array.from({ length: 205 }, (_, index) => ({
            id: `vital:weight:${index + 1}`,
            date: new Date(Date.UTC(2025, 0, index + 1)).toISOString(),
            value: 60 + index / 10,
            secondaryValue: null,
            sourceDocumentId: null,
            status: null,
          })),
        },
      ],
    };

    const model = buildHouseholdAiHandoff(denseSnapshot, {
      questionId: 'recent_changes',
      question: '最近有哪些变化？',
      range: 'all',
      generatedAt: '2026-07-28T03:30:00Z',
    });

    expect(model.status).toBe('ready');
    expect(model.observations).toHaveLength(200);
    expect(model.totalObservationCount).toBe(205);
    expect(model.omittedObservationCount).toBe(5);
    expect(model.observations.at(-1)?.recordId).toBe('vital:weight:205');
    expect(renderHouseholdAiHandoffText(model)).toContain(
      '已加载 205 条，本次省略 5 条'
    );
  });
});
