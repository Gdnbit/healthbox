import type {
  HealthImportBatch,
  HealthSourceDocument,
  HealthSourceParseTask,
} from '../../services/api/healthImportApi';
import type {
  HouseholdReportProcessingAction,
  HouseholdReportProcessingState,
} from './types';

export interface HouseholdReportProcessing {
  state: HouseholdReportProcessingState;
  label: string;
  hint: string;
  action: HouseholdReportProcessingAction;
  actionLabel: string | null;
  parseTaskId: number | null;
  importBatchId: number | null;
}

const timestamp = (value?: string | null): number => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const taskTime = (task: HealthSourceParseTask): number =>
  Math.max(
    timestamp(task.updated_at),
    timestamp(task.completed_at),
    timestamp(task.cancelled_at),
    timestamp(task.started_at),
    timestamp(task.created_at)
  );

const batchTime = (batch: HealthImportBatch): number =>
  Math.max(
    timestamp(batch.rolled_back_at),
    timestamp(batch.committed_at),
    timestamp(batch.reviewed_at),
    timestamp(batch.created_at)
  );

const latestBy = <T extends { id: number }>(
  values: T[],
  getTime: (_value: T) => number
): T | null =>
  values.reduce<T | null>((latest, value) => {
    if (!latest) return value;
    const difference = getTime(value) - getTime(latest);
    return difference > 0 || (difference === 0 && value.id > latest.id)
      ? value
      : latest;
  }, null);

const fromTask = (task: HealthSourceParseTask): HouseholdReportProcessing => {
  const base = {
    parseTaskId: task.id,
    importBatchId: task.import_batch_id ?? null,
  };

  if (task.status === 'queued') {
    return {
      ...base,
      state: 'processing',
      label: '解析中',
      hint: '任务正在等待本地解析器处理',
      action: 'view_task',
      actionLabel: '查看进度',
    };
  }
  if (task.status === 'running') {
    return {
      ...base,
      state: 'processing',
      label: '解析中',
      hint: '本地解析器正在提取报告内容',
      action: 'view_task',
      actionLabel: '查看进度',
    };
  }
  if (task.status === 'failed') {
    return {
      ...base,
      state: 'attention',
      label: '解析失败',
      hint: '原件仍已完整保留，可查看原因后重试',
      action: 'view_task',
      actionLabel: '处理异常',
    };
  }
  if (task.status === 'cancelled') {
    return {
      ...base,
      state: 'attention',
      label: '解析已暂停',
      hint: '原件仍已完整保留，可继续或改为手工录入',
      action: 'view_task',
      actionLabel: '继续处理',
    };
  }

  return {
    ...base,
    state: 'attention',
    label: '结果待处理',
    hint: '解析已完成，但复核批次尚未载入',
    action: 'view_task',
    actionLabel: '查看结果',
  };
};

const fromBatch = (
  batch: HealthImportBatch,
  parseTaskId: number | null
): HouseholdReportProcessing => {
  const base = {
    parseTaskId,
    importBatchId: batch.id,
  };

  if (batch.status === 'pending_review') {
    return {
      ...base,
      state: 'review_required',
      label: '待复核',
      hint: '请核对解析出的指标，确认后才能写入档案',
      action: 'review_batch',
      actionLabel: '继续复核',
    };
  }
  if (batch.status === 'reviewed') {
    return {
      ...base,
      state: 'ready_to_commit',
      label: '待确认入库',
      hint: '复核已完成，确认后写入正式指标',
      action: 'review_batch',
      actionLabel: '确认入库',
    };
  }
  if (batch.status === 'committed') {
    return {
      ...base,
      state: 'committed',
      label: '已入库',
      hint: '已写入正式指标，可在趋势面板中查看',
      action: 'view_metrics',
      actionLabel: '查看指标',
    };
  }

  return {
    ...base,
    state: 'rolled_back',
    label: '已回滚',
    hint: '本批正式数据已回滚，报告原件仍保留',
    action: 'view_history',
    actionLabel: '查看记录',
  };
};

export const resolveHouseholdReportProcessing = (
  document: HealthSourceDocument,
  parseTasks: HealthSourceParseTask[],
  importBatches: HealthImportBatch[]
): HouseholdReportProcessing => {
  if (
    document.status === 'archived' ||
    document.status === 'withdrawn' ||
    document.withdrawn_at
  ) {
    return {
      state: 'withdrawn',
      label: '已撤回',
      hint: '原件已从当前档案撤回，历史记录仍保留',
      action: 'none',
      actionLabel: null,
      parseTaskId: null,
      importBatchId: null,
    };
  }

  const sourceTasks = parseTasks.filter(
    task => task.source_document_id === document.id
  );
  const sourceBatches = importBatches.filter(
    batch => batch.source_document_id === document.id
  );
  const latestTask = latestBy(sourceTasks, taskTime);
  const latestBatch = latestBy(sourceBatches, batchTime);

  if (latestTask?.import_batch_id) {
    const linkedBatch =
      sourceBatches.find(batch => batch.id === latestTask.import_batch_id) ??
      null;
    if (
      linkedBatch &&
      (!latestBatch ||
        latestBatch.id === linkedBatch.id ||
        batchTime(linkedBatch) >= batchTime(latestBatch))
    ) {
      return fromBatch(linkedBatch, latestTask.id);
    }
  }

  if (
    latestTask &&
    (!latestBatch || taskTime(latestTask) > batchTime(latestBatch))
  ) {
    return fromTask(latestTask);
  }
  if (latestBatch) {
    return fromBatch(latestBatch, latestTask?.id ?? null);
  }
  if (latestTask) {
    return fromTask(latestTask);
  }

  return {
    state: 'saved',
    label: '原件已保存',
    hint: '源文件已安全留存，尚未开始解析',
    action: 'start_parse',
    actionLabel: '本地解析',
    parseTaskId: null,
    importBatchId: null,
  };
};
