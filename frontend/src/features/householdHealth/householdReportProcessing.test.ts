import { describe, expect, it } from 'vitest';
import type {
  HealthImportBatch,
  HealthSourceDocument,
  HealthSourceParseTask,
} from '../../services/api/healthImportApi';
import { resolveHouseholdReportProcessing } from './householdReportProcessing';

const document = (
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

const parseTask = (
  overrides: Partial<HealthSourceParseTask> = {}
): HealthSourceParseTask => ({
  id: 51,
  patient_id: 7,
  source_document_id: 41,
  created_by_user_id: 3,
  import_batch_id: null,
  idempotency_key: 'parse-51',
  parser_name: 'local-core-lab',
  parser_version: '1.0.0',
  status: 'running',
  attempt_count: 1,
  summary: {},
  created_at: '2026-06-18T10:00:00Z',
  updated_at: '2026-06-18T10:01:00Z',
  ...overrides,
});

const batch = (
  overrides: Partial<HealthImportBatch> = {}
): HealthImportBatch => ({
  id: 61,
  patient_id: 7,
  source_document_id: 41,
  idempotency_key: 'batch-61',
  parser_name: 'local-core-lab',
  parser_version: '1.0.0',
  status: 'pending_review',
  summary: {
    total: 2,
    pending: 2,
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    quality_issue_count: 0,
  },
  items: [],
  created_at: '2026-06-18T10:02:00Z',
  ...overrides,
});

describe('resolveHouseholdReportProcessing', () => {
  it('starts with a retained original that can enter local parsing', () => {
    expect(resolveHouseholdReportProcessing(document(), [], [])).toEqual({
      state: 'saved',
      label: '原件已保存',
      hint: '源文件已安全留存，尚未开始解析',
      action: 'start_parse',
      actionLabel: '本地解析',
      parseTaskId: null,
      importBatchId: null,
    });
  });

  it('maps queued and running tasks to one clear processing stage', () => {
    const result = resolveHouseholdReportProcessing(
      document(),
      [
        parseTask({
          id: 50,
          status: 'queued',
          updated_at: '2026-06-18T09:59:00Z',
        }),
        parseTask(),
      ],
      []
    );

    expect(result).toMatchObject({
      state: 'processing',
      label: '解析中',
      action: 'view_task',
      actionLabel: '查看进度',
      parseTaskId: 51,
    });
  });

  it.each([
    ['pending_review', 'review_required', '待复核', '继续复核'],
    ['reviewed', 'ready_to_commit', '待确认入库', '确认入库'],
    ['committed', 'committed', '已入库', '查看指标'],
    ['rolled_back', 'rolled_back', '已回滚', '查看记录'],
  ] as const)(
    'maps the %s batch stage to a user-facing workflow state',
    (status, state, label, actionLabel) => {
      const result = resolveHouseholdReportProcessing(
        document(),
        [
          parseTask({
            status: 'succeeded',
            import_batch_id: 61,
            updated_at: '2026-06-18T10:03:00Z',
          }),
        ],
        [
          batch({
            status,
            reviewed_at:
              status === 'reviewed' || status === 'committed'
                ? '2026-06-18T10:04:00Z'
                : null,
            committed_at:
              status === 'committed' ? '2026-06-18T10:05:00Z' : null,
            rolled_back_at:
              status === 'rolled_back' ? '2026-06-18T10:06:00Z' : null,
          }),
        ]
      );

      expect(result).toMatchObject({
        state,
        label,
        actionLabel,
        importBatchId: 61,
        parseTaskId: 51,
      });
    }
  );

  it('shows a newer retry instead of an older committed batch', () => {
    const result = resolveHouseholdReportProcessing(
      document(),
      [
        parseTask({
          id: 52,
          status: 'running',
          updated_at: '2026-06-19T08:00:00Z',
        }),
      ],
      [
        batch({
          status: 'committed',
          committed_at: '2026-06-18T10:05:00Z',
        }),
      ]
    );

    expect(result).toMatchObject({
      state: 'processing',
      parseTaskId: 52,
      importBatchId: null,
    });
  });

  it.each([
    ['failed', '解析失败', '处理异常'],
    ['cancelled', '解析已暂停', '继续处理'],
  ] as const)('keeps %s tasks actionable', (status, label, actionLabel) => {
    expect(
      resolveHouseholdReportProcessing(document(), [parseTask({ status })], [])
    ).toMatchObject({
      state: 'attention',
      label,
      action: 'view_task',
      actionLabel,
    });
  });

  it('makes an archived source terminal even when derived records exist', () => {
    expect(
      resolveHouseholdReportProcessing(
        document({
          status: 'archived',
          withdrawn_at: '2026-06-20T08:00:00Z',
        }),
        [parseTask()],
        [batch({ status: 'committed' })]
      )
    ).toMatchObject({
      state: 'withdrawn',
      label: '已撤回',
      action: 'none',
      actionLabel: null,
    });
  });
});
