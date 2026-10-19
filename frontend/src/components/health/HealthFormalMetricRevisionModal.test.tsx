import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  HealthFormalMetricRevisionHistory,
  HealthFormalMetricRevisionRequest,
} from '../../services/api/healthImportApi';
import HealthFormalMetricRevisionModal from './HealthFormalMetricRevisionModal';

const initialHistory: HealthFormalMetricRevisionHistory = {
  contract_version: 'household-formal-metric-revision@1.0.0',
  component_id: 31,
  patient_id: 7,
  lab_result_id: 21,
  test_name: '虚构指标甲',
  canonical_test_name: 'Synthetic Metric A',
  test_code: 'SYN-A',
  observed_date: '2026-01-15',
  source_document_id: 11,
  source_page: 2,
  source_locator: 'table-1-row-2',
  import_batch_id: 41,
  current_revision_id: 91,
  revisions: [
    {
      id: 91,
      component_id: 31,
      patient_id: 7,
      version: 1,
      action: 'created',
      supersedes_revision_id: null,
      reason: null,
      result_type: 'quantitative',
      numeric_value: 12.5,
      qualitative_value: null,
      textual_value: null,
      unit: 'unit/L',
      ref_range_min: 10,
      ref_range_max: 15,
      ref_range_text: null,
      result_status: 'normal',
      created_by_user_id: 5,
      created_at: '2026-01-16T00:00:00Z',
    },
  ],
};

describe('HealthFormalMetricRevisionModal', () => {
  it('creates a new version without hiding the old value', async () => {
    const revisedHistory: HealthFormalMetricRevisionHistory = {
      ...initialHistory,
      current_revision_id: 92,
      revisions: [
        {
          ...initialHistory.revisions[0],
          id: 92,
          version: 2,
          action: 'revised',
          supersedes_revision_id: 91,
          reason: '修正自动识别时的小数点错误',
          numeric_value: 13.2,
          created_at: '2026-01-16T01:00:00Z',
        },
        initialHistory.revisions[0],
      ],
    };
    const loadHistory = vi.fn().mockResolvedValue(initialHistory);
    const createRevision = vi.fn().mockResolvedValue(revisedHistory);
    const onRevised = vi.fn();

    render(
      <MantineProvider>
        <HealthFormalMetricRevisionModal
          opened
          componentId={31}
          onClose={vi.fn()}
          onRevised={onRevised}
          loadHistory={loadHistory}
          createRevision={createRevision}
        />
      </MantineProvider>
    );

    expect(await screen.findByText('修订正式记录')).toBeInTheDocument();
    expect(screen.getByText('当前为第 1 版')).toBeInTheDocument();
    expect(screen.getByText('原值会永久保留')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: '保存为新版本' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('修订后的数值'), {
      target: { value: '13.2' },
    });
    fireEvent.change(screen.getByLabelText('修改原因'), {
      target: { value: '修正自动识别时的小数点错误' },
    });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createRevision).toHaveBeenCalledOnce());
    const request = createRevision.mock
      .calls[0][1] as HealthFormalMetricRevisionRequest;
    expect(request).toMatchObject({
      expected_current_revision_id: 91,
      reason: '修正自动识别时的小数点错误',
      result: {
        result_type: 'quantitative',
        numeric_value: 13.2,
        unit: 'unit/L',
        ref_range_min: 10,
        ref_range_max: 15,
        result_status: 'normal',
      },
    });
    expect(request.idempotency_key).toHaveLength(36);
    expect(await screen.findByText('第 2 版已保存')).toBeInTheDocument();
    expect(screen.getByText('12.5 unit/L')).toBeInTheDocument();
    expect(onRevised).toHaveBeenCalledWith(revisedHistory);
  });

  it('does not expose the form when history cannot be loaded', async () => {
    render(
      <MantineProvider>
        <HealthFormalMetricRevisionModal
          opened
          componentId={31}
          onClose={vi.fn()}
          onRevised={vi.fn()}
          loadHistory={vi.fn().mockRejectedValue(new Error('offline'))}
          createRevision={vi.fn()}
        />
      </MantineProvider>
    );

    expect(
      await screen.findByText('暂时无法读取这条记录的修订历史')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '保存为新版本' })
    ).not.toBeInTheDocument();
  });
});
