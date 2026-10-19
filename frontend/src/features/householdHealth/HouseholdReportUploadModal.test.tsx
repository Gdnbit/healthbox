import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HouseholdReportUploadModal from './HouseholdReportUploadModal';

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  createBatch: vi.fn(),
  completeBatch: vi.fn(),
  listBatches: vi.fn(),
  getBatch: vi.fn(),
  cancelBatch: vi.fn(),
  listSimilarityRelations: vi.fn(),
  reviewSimilarityRelation: vi.fn(),
  thumbnailSourceDocument: vi.fn(),
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: {
    uploadSourceDocument: mocks.upload,
    createSourceUploadBatch: mocks.createBatch,
    completeSourceUploadBatch: mocks.completeBatch,
    listSourceUploadBatches: mocks.listBatches,
    getSourceUploadBatch: mocks.getBatch,
    cancelSourceUploadBatch: mocks.cancelBatch,
    listSourceSimilarityRelations: mocks.listSimilarityRelations,
    reviewSourceSimilarityRelation: mocks.reviewSimilarityRelation,
    thumbnailSourceDocument: mocks.thumbnailSourceDocument,
  },
}));

vi.mock('./healthUploadValidation', async importOriginal => {
  const actual =
    await importOriginal<typeof import('./healthUploadValidation')>();
  return {
    ...actual,
    fingerprintHealthUploadFile: (file: File) => {
      const byte = file.name.charCodeAt(0).toString(16).padStart(2, '0');
      return Promise.resolve(`sha-256:${byte.repeat(32)}`);
    },
  };
});

const pdf = (name: string) =>
  new File(['synthetic'], name, { type: 'application/pdf' });

const recoveryFilePrefix = '0123456789ABCDEFGHIJKLMNOPQRST';

const longBatchPdf = (index: number) =>
  pdf(
    `${recoveryFilePrefix[index]}-report-${String(index + 1).padStart(2, '0')}.pdf`
  );

const longBatchSha256 = (index: number) =>
  recoveryFilePrefix[index]
    .charCodeAt(0)
    .toString(16)
    .padStart(2, '0')
    .repeat(32);

interface UploadTestOptions {
  onProgress?: (_progress: {
    loaded: number;
    total: number;
    percent: number;
  }) => void;
}

const batchResult = (
  status: 'open' | 'partial' | 'completed' | 'cancelled'
) => ({
  id: 81,
  patient_id: 7,
  created_by_user_id: 1,
  idempotency_key: 'synthetic-batch',
  manifest_sha256: '0'.repeat(64),
  document_type: 'checkup',
  status,
  expected_file_count: 2,
  expected_total_bytes: 18,
  created_at: '2026-07-27T00:00:00Z',
  completed_at: status === 'completed' ? '2026-07-27T00:01:00Z' : undefined,
  updated_at: '2026-07-27T00:01:00Z',
  items: [],
});

const chooseFiles = async (files: File[]) => {
  const input = screen.getByLabelText('选择报告文件');
  await waitFor(() => expect(input).toBeEnabled());
  await act(async () => {
    fireEvent.change(input, { target: { files } });
    await new Promise(resolve => window.setTimeout(resolve, 0));
  });
};

describe('HouseholdReportUploadModal', () => {
  beforeEach(() => {
    mocks.upload.mockReset().mockResolvedValue({ id: 1 });
    mocks.listBatches.mockReset().mockResolvedValue([]);
    mocks.getBatch.mockReset();
    mocks.cancelBatch.mockReset();
    mocks.listSimilarityRelations.mockReset().mockResolvedValue([]);
    mocks.reviewSimilarityRelation.mockReset();
    mocks.thumbnailSourceDocument
      .mockReset()
      .mockResolvedValue(new Blob(['synthetic'], { type: 'image/jpeg' }));
    mocks.createBatch.mockReset().mockImplementation(
      (
        patientId: number,
        input: {
          idempotency_key: string;
          document_type: string;
          report_date?: string;
          facility?: string;
          documents: Array<{
            client_item_id: string;
            sequence: number;
            original_filename: string;
            mime_type: string;
            size_bytes: number;
          }>;
        }
      ) =>
        Promise.resolve({
          id: 81,
          patient_id: patientId,
          created_by_user_id: 1,
          idempotency_key: input.idempotency_key,
          manifest_sha256: '0'.repeat(64),
          document_type: input.document_type,
          report_date: input.report_date,
          facility: input.facility,
          status: 'open',
          expected_file_count: input.documents.length,
          expected_total_bytes: input.documents.reduce(
            (total, document) => total + document.size_bytes,
            0
          ),
          created_at: '2026-07-27T00:00:00Z',
          updated_at: '2026-07-27T00:00:00Z',
          items: input.documents.map((document, index) => ({
            id: 100 + index,
            batch_id: 81,
            ...document,
            status: 'pending',
            attempt_count: 0,
            created_at: '2026-07-27T00:00:00Z',
            updated_at: '2026-07-27T00:00:00Z',
          })),
        })
    );
    mocks.completeBatch
      .mockReset()
      .mockImplementation((batchId: number) =>
        Promise.resolve({ ...batchResult('completed'), id: batchId })
      );
  });

  it('adds multiple supported files and saves every original separately', async () => {
    const onSaved = vi.fn();
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    await chooseFiles([pdf('one.pdf'), pdf('two.pdf')]);

    expect(await screen.findByText('one.pdf')).toBeInTheDocument();
    expect(screen.getByText('two.pdf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存 2 个原件' }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    expect(mocks.createBatch).toHaveBeenCalledTimes(1);
    expect(mocks.createBatch).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        idempotency_key: expect.stringMatching(/^health-upload-/),
        document_type: 'checkup',
        documents: [
          expect.objectContaining({
            sequence: 1,
            original_filename: 'one.pdf',
            mime_type: 'application/pdf',
            client_sha256: '6f'.repeat(32),
          }),
          expect.objectContaining({
            sequence: 2,
            original_filename: 'two.pdf',
            mime_type: 'application/pdf',
            client_sha256: '74'.repeat(32),
          }),
        ],
      })
    );
    expect(mocks.upload).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({
        displayName: 'one.pdf',
        documentType: 'checkup',
        sourceUploadBatchId: 81,
        sourceUploadItemId: 100,
      }),
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    await waitFor(() => expect(mocks.completeBatch).toHaveBeenCalledWith(81));
    expect(
      within(screen.getByLabelText('待保存文件')).getAllByText('原件已保存')
    ).toHaveLength(2);
    expect(await screen.findByText('本批次已完整登记')).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it('uses the durable server batch when upload functions are injected for delegated context', async () => {
    const startParseTask = vi.fn().mockResolvedValue({ id: 601 });
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        serverBatchMode
        operatorContext={{
          mode: 'delegated',
          label: '管理员代上传（不会冒充成员）',
        }}
        uploadDocument={mocks.upload}
        createUploadBatch={mocks.createBatch}
        completeUploadBatch={mocks.completeBatch}
        listUploadBatches={mocks.listBatches}
        getUploadBatch={mocks.getBatch}
        cancelUploadBatch={mocks.cancelBatch}
        startParseTask={startParseTask}
      />
    );

    expect(
      screen.queryByRole('checkbox', {
        name: '保存后自动开始本地解析',
      })
    ).not.toBeInTheDocument();
    await chooseFiles([pdf('delegated.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    await waitFor(() => expect(mocks.createBatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(1));
    expect(mocks.upload).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        sourceUploadBatchId: 81,
        sourceUploadItemId: 100,
      }),
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    await waitFor(() => expect(mocks.completeBatch).toHaveBeenCalledWith(81));
    expect(
      screen.getByText('管理员代上传（不会冒充成员）')
    ).toBeInTheDocument();
    expect(startParseTask).not.toHaveBeenCalled();
  });

  it('shows byte-level progress for the active file and completes at 100%', async () => {
    let resolveUpload: (_value: { id: number }) => void = () => undefined;
    mocks.upload.mockImplementationOnce(
      (_patientId: number, _input: unknown, options?: UploadTestOptions) =>
        new Promise(resolve => {
          resolveUpload = resolve;
          options?.onProgress?.({ loaded: 5, total: 10, percent: 50 });
        })
    );
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        uploadDocument={mocks.upload}
      />
    );

    await chooseFiles([pdf('progress.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    const progress = await screen.findByRole('progressbar', {
      name: 'progress.pdf 上传进度',
    });
    expect(progress).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('正在保存 50%')).toBeInTheDocument();

    await act(async () => {
      resolveUpload({ id: 1 });
      await Promise.resolve();
    });
    expect(await screen.findByText('原件已保存')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('queues eligible saved originals for local parsing without writing formal metrics', async () => {
    const startParseTask = vi.fn().mockResolvedValue({
      id: 601,
      source_document_id: 501,
      status: 'queued',
    });
    mocks.upload.mockResolvedValueOnce({ id: 501 });
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        uploadDocument={mocks.upload}
        startParseTask={startParseTask}
      />
    );

    expect(
      screen.getByRole('checkbox', {
        name: '保存后自动开始本地解析',
      })
    ).toBeChecked();
    expect(
      screen.getByText('解析结果只进入待复核区，不会自动写入健康指标或趋势。')
    ).toBeInTheDocument();

    await chooseFiles([pdf('auto-parse.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    await waitFor(() => expect(startParseTask).toHaveBeenCalledWith(501));
    expect(
      await screen.findByText('原件已保存 · 解析已排队')
    ).toBeInTheDocument();
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('stores unsupported document types without starting local parsing', async () => {
    const startParseTask = vi.fn().mockResolvedValue({ id: 603 });
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        uploadDocument={mocks.upload}
        startParseTask={startParseTask}
      />
    );

    fireEvent.change(screen.getByLabelText('资料类型'), {
      target: { value: 'other' },
    });
    expect(
      screen.queryByRole('checkbox', {
        name: '保存后自动开始本地解析',
      })
    ).not.toBeInTheDocument();
    expect(screen.getByText('此类资料先只保存原件')).toBeInTheDocument();

    await chooseFiles([pdf('other-document.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    expect(await screen.findByText('原件已保存')).toBeInTheDocument();
    expect(startParseTask).not.toHaveBeenCalled();
  });

  it('keeps the original saved when automatic parsing cannot start and retries parsing only', async () => {
    const startParseTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('worker unavailable'))
      .mockResolvedValueOnce({
        id: 602,
        source_document_id: 502,
        status: 'queued',
      });
    mocks.upload.mockResolvedValueOnce({ id: 502 });
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        uploadDocument={mocks.upload}
        startParseTask={startParseTask}
      />
    );

    await chooseFiles([pdf('parse-retry.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    expect(
      await screen.findByText('原件已保存 · 解析启动失败')
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '重试解析 parse-retry.pdf' })
    );

    expect(
      await screen.findByText('原件已保存 · 解析已排队')
    ).toBeInTheDocument();
    expect(startParseTask).toHaveBeenCalledTimes(2);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });

  it('shows unsupported files as skipped without calling the API', async () => {
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await chooseFiles([new File(['x'], 'notes.txt', { type: 'text/plain' })]);

    expect(await screen.findByText('仅支持常见图片和 PDF')).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('keeps a failed item available for retry', async () => {
    let retryProgress: UploadTestOptions['onProgress'];
    let resolveRetry: (_value: { id: number }) => void = () => undefined;
    mocks.upload
      .mockImplementationOnce(
        (_patientId: number, _input: unknown, options?: UploadTestOptions) => {
          options?.onProgress?.({ loaded: 6, total: 10, percent: 60 });
          return Promise.reject(new Error('network unavailable'));
        }
      )
      .mockImplementationOnce(
        (_patientId: number, _input: unknown, options?: UploadTestOptions) =>
          new Promise(resolve => {
            retryProgress = options?.onProgress;
            resolveRetry = resolve;
          })
      );
    mocks.completeBatch.mockResolvedValueOnce(batchResult('partial'));
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await chooseFiles([pdf('retry.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument();
    expect(
      await screen.findByText(
        '仍有文件未保存，请重试失败项。已成功保存的原件不会丢失。'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试 retry.pdf' }));
    const retryProgressBar = await screen.findByRole('progressbar', {
      name: 'retry.pdf 上传进度',
    });
    expect(retryProgressBar).toHaveAttribute('aria-valuenow', '0');
    await act(async () => {
      retryProgress?.({ loaded: 2, total: 10, percent: 20 });
    });
    expect(retryProgressBar).toHaveAttribute('aria-valuenow', '20');
    await act(async () => {
      resolveRetry({ id: 2 });
      await Promise.resolve();
    });
    expect(await screen.findByText('原件已保存')).toBeInTheDocument();
    expect(await screen.findByText('本批次已完整登记')).toBeInTheDocument();
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.createBatch).toHaveBeenCalledTimes(1);
    expect(mocks.completeBatch).toHaveBeenCalledTimes(2);
  });

  it('does not transfer files when the server cannot register the batch', async () => {
    mocks.createBatch.mockRejectedValueOnce(new Error('network unavailable'));
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    await chooseFiles([pdf('blocked.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    expect(
      await screen.findByText(
        '暂时无法建立安全上传批次，尚未传输任何文件。请稍后重试。'
      )
    ).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '保存 1 个原件' })
      ).toBeEnabled()
    );
  });

  it('finds an unfinished batch and only retries its exact pending file', async () => {
    const recovered = {
      id: 91,
      patient_id: 7,
      created_by_user_id: 1,
      idempotency_key: 'recovered-batch',
      manifest_sha256: '1'.repeat(64),
      document_type: 'checkup',
      report_date: '2026-06-18',
      facility: '示例体检中心',
      status: 'open',
      expected_file_count: 2,
      expected_total_bytes: 18,
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:00:00Z',
      items: [
        {
          id: 201,
          batch_id: 91,
          client_item_id: 'saved-item',
          sequence: 1,
          original_filename: 'saved.pdf',
          mime_type: 'application/pdf',
          size_bytes: 9,
          client_sha256: '73'.repeat(32),
          status: 'uploaded',
          source_document_id: 501,
          attempt_count: 1,
          created_at: '2026-07-27T00:00:00Z',
          updated_at: '2026-07-27T00:00:00Z',
        },
        {
          id: 202,
          batch_id: 91,
          client_item_id: 'retry-item',
          sequence: 2,
          original_filename: 'retry.pdf',
          mime_type: 'application/pdf',
          size_bytes: 9,
          client_sha256: '72'.repeat(32),
          status: 'failed',
          attempt_count: 1,
          last_error_code: 'storage_failed',
          created_at: '2026-07-27T00:00:00Z',
          updated_at: '2026-07-27T00:00:00Z',
        },
      ],
    };
    mocks.listBatches.mockResolvedValueOnce([recovered]);
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(
      await screen.findByText(
        /发现上次未完成的上传：已保留 1 个，还有 1 个待处理/
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('资料类型')).toHaveValue('checkup');
    expect(screen.getByLabelText('报告日期（可选）')).toHaveValue('2026-06-18');
    expect(screen.getByLabelText('机构（可选）')).toHaveValue('示例体检中心');
    expect(screen.getByLabelText('机构（可选）')).toBeDisabled();
    await chooseFiles([pdf('retry.pdf')]);
    fireEvent.click(
      await screen.findByRole('button', { name: '保存 1 个原件' })
    );

    await waitFor(() =>
      expect(mocks.upload).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          displayName: 'retry.pdf',
          sourceUploadBatchId: 91,
          sourceUploadItemId: 202,
        }),
        expect.objectContaining({ onProgress: expect.any(Function) })
      )
    );
    expect(mocks.createBatch).not.toHaveBeenCalled();
    expect(mocks.completeBatch).toHaveBeenCalledWith(91);
    expect(await screen.findByText('本批次已完整登记')).toBeInTheDocument();
  });

  it('recovers a thirty-file interrupted batch by skipping preserved originals and uploading only unfinished items', async () => {
    const files = Array.from({ length: 30 }, (_, index) => longBatchPdf(index));
    const recoveredItems = files.map((file, index) => ({
      id: 300 + index,
      batch_id: 94,
      client_item_id: `long-item-${index + 1}`,
      sequence: index + 1,
      original_filename: file.name,
      mime_type: 'application/pdf',
      size_bytes: file.size,
      client_sha256: longBatchSha256(index),
      status: index < 12 ? ('uploaded' as const) : ('failed' as const),
      source_document_id: index < 12 ? 700 + index : undefined,
      attempt_count: index < 12 ? 1 : 2,
      last_error_code: index < 12 ? undefined : 'network_interrupted',
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:02:00Z',
    }));
    const recovered = {
      id: 94,
      patient_id: 7,
      created_by_user_id: 1,
      idempotency_key: 'recovered-long-batch',
      manifest_sha256: '4'.repeat(64),
      document_type: 'checkup',
      report_date: '2026-06-18',
      facility: '示例体检中心',
      status: 'partial' as const,
      expected_file_count: 30,
      expected_total_bytes: files.reduce((total, file) => total + file.size, 0),
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:02:00Z',
      items: recoveredItems,
    };
    mocks.listBatches.mockResolvedValueOnce([recovered]);
    mocks.completeBatch.mockResolvedValueOnce({
      ...recovered,
      status: 'completed',
      completed_at: '2026-07-27T00:03:00Z',
      items: recoveredItems.map((item, index) => ({
        ...item,
        status: 'uploaded',
        source_document_id: item.source_document_id ?? 800 + index,
        last_error_code: undefined,
      })),
    });

    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(await screen.findByText('继续上次上传')).toBeInTheDocument();
    expect(screen.getByText('已安全保存 12 / 30')).toBeInTheDocument();
    expect(screen.getByText('还有 18 个待处理')).toBeInTheDocument();
    expect(screen.getByText('查看待处理文件（18）')).toBeInTheDocument();

    await chooseFiles(files);

    expect(
      await screen.findByText('已识别 12 个上次保存的原件，本次不会重复上传。')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('该原件已在上次批次中保存，无需重传')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存 18 个原件' }));

    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(18));
    expect(
      mocks.upload.mock.calls.map(call => call[1].sourceUploadItemId)
    ).toEqual(Array.from({ length: 18 }, (_, index) => 312 + index));
    expect(mocks.completeBatch).toHaveBeenCalledWith(94);
    expect(
      await screen.findByText(
        '30 个原件已完整登记：上次保留 12 个，本次完成 18 个。'
      )
    ).toBeInTheDocument();
  });

  it('rejects a reselected file that is not in the unfinished manifest', async () => {
    mocks.listBatches.mockResolvedValueOnce([
      {
        id: 92,
        patient_id: 7,
        created_by_user_id: 1,
        idempotency_key: 'recovered-mismatch',
        manifest_sha256: '2'.repeat(64),
        document_type: 'checkup',
        status: 'partial',
        expected_file_count: 1,
        expected_total_bytes: 9,
        created_at: '2026-07-27T00:00:00Z',
        updated_at: '2026-07-27T00:00:00Z',
        items: [
          {
            id: 203,
            batch_id: 92,
            client_item_id: 'expected-item',
            sequence: 1,
            original_filename: 'expected.pdf',
            mime_type: 'application/pdf',
            size_bytes: 9,
            client_sha256: '65'.repeat(32),
            status: 'failed',
            attempt_count: 1,
            created_at: '2026-07-27T00:00:00Z',
            updated_at: '2026-07-27T00:00:00Z',
          },
        ],
      },
    ]);
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(await screen.findByText(/发现上次未完成的上传/)).toBeInTheDocument();
    await chooseFiles([pdf('other.pdf')]);

    expect(
      await screen.findByText('不属于上次未完成清单，已跳过')
    ).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: '请重新选择 1 个' })
    ).toBeDisabled();
  });

  it('lets the owner end an unfinished batch without deleting saved originals', async () => {
    const recovered = {
      id: 93,
      patient_id: 7,
      created_by_user_id: 1,
      idempotency_key: 'recovered-cancel',
      manifest_sha256: '3'.repeat(64),
      document_type: 'checkup',
      status: 'open',
      expected_file_count: 2,
      expected_total_bytes: 18,
      created_at: '2026-07-27T00:00:00Z',
      updated_at: '2026-07-27T00:00:00Z',
      items: [
        {
          id: 204,
          batch_id: 93,
          client_item_id: 'preserved-item',
          sequence: 1,
          original_filename: 'preserved.pdf',
          mime_type: 'application/pdf',
          size_bytes: 9,
          client_sha256: '70'.repeat(32),
          status: 'uploaded',
          source_document_id: 502,
          attempt_count: 1,
          created_at: '2026-07-27T00:00:00Z',
          updated_at: '2026-07-27T00:00:00Z',
        },
        {
          id: 205,
          batch_id: 93,
          client_item_id: 'pending-item',
          sequence: 2,
          original_filename: 'pending.pdf',
          mime_type: 'application/pdf',
          size_bytes: 9,
          client_sha256: '70'.repeat(32),
          status: 'pending',
          attempt_count: 0,
          created_at: '2026-07-27T00:00:00Z',
          updated_at: '2026-07-27T00:00:00Z',
        },
      ],
    };
    mocks.listBatches
      .mockResolvedValueOnce([recovered])
      .mockResolvedValueOnce([]);
    mocks.cancelBatch.mockResolvedValueOnce({
      ...recovered,
      status: 'cancelled',
      items: [
        recovered.items[0],
        { ...recovered.items[1], status: 'cancelled' },
      ],
    });
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '结束本批次' }));
    expect(
      screen.getByText('结束后，未保存项会关闭；已保存原件不会删除。')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));

    expect(
      await screen.findByText('旧批次已结束，已保存的 1 个原件继续保留。')
    ).toBeInTheDocument();
    expect(mocks.cancelBatch).toHaveBeenCalledWith(93);
    expect(screen.getByLabelText('选择报告文件')).toBeEnabled();
  });

  it('persists pending similarity review with side-by-side thumbnails and owner decisions', async () => {
    const relation = {
      id: 301,
      patient_id: 7,
      source_document_id: 501,
      source_display_name: '报告第 1 张',
      related_source_document_id: 502,
      related_display_name: '报告第 2 张',
      relation_type: 'partial_overlap',
      confidence: 0.86,
      algorithm_version: 'source-image-similarity@1.0.0',
      evidence: {
        matched_region_ratio: 0.58,
        source_unique_ratio: 0.42,
        related_unique_ratio: 0.42,
        orientation: 'vertical',
        explanation_code: 'shared_vertical_bands',
      },
      review_status: 'pending',
      created_at: '2026-07-28T00:00:00Z',
      updated_at: '2026-07-28T00:00:00Z',
    };
    mocks.listSimilarityRelations.mockResolvedValueOnce([relation]);
    mocks.reviewSimilarityRelation.mockResolvedValueOnce({
      ...relation,
      review_status: 'confirmed',
    });
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:source-a')
      .mockReturnValueOnce('blob:source-b');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { unmount } = render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        uploadDocument={mocks.upload}
        listSimilarityRelations={mocks.listSimilarityRelations}
        reviewSimilarityRelation={mocks.reviewSimilarityRelation}
        thumbnailSourceDocument={mocks.thumbnailSourceDocument}
      />
    );

    expect(
      await screen.findByText('发现 1 组图片需要确认')
    ).toBeInTheDocument();
    expect(
      screen.getByText('可能存在局部重叠，但两张都可能含有独有区域')
    ).toBeInTheDocument();
    expect(screen.getByText(/两份原件都会完整保留/)).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: '报告第 1 张缩略图' })
    ).toHaveAttribute('src', 'blob:source-a');
    expect(
      await screen.findByRole('img', { name: '报告第 2 张缩略图' })
    ).toHaveAttribute('src', 'blob:source-b');
    expect(mocks.thumbnailSourceDocument).toHaveBeenCalledWith(
      501,
      expect.any(AbortSignal)
    );
    expect(mocks.thumbnailSourceDocument).toHaveBeenCalledWith(
      502,
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole('button', { name: '确认这两张存在重叠' }));
    await waitFor(() =>
      expect(mocks.reviewSimilarityRelation).toHaveBeenCalledWith(
        301,
        'confirmed'
      )
    );
    expect(
      await screen.findByText('已记录确认；两份原件均未改变。')
    ).toBeInTheDocument();
    expect(screen.queryByText('发现 1 组图片需要确认')).not.toBeInTheDocument();

    unmount();
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-a');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-b');
  });

  it('does not let delegated upload review the archive owner similarity queue', async () => {
    render(
      <HouseholdReportUploadModal
        patientId={7}
        subjectLabel="测试成员"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        serverBatchMode
        operatorContext={{
          mode: 'delegated',
          label: '管理员代上传（不会冒充成员）',
        }}
        uploadDocument={mocks.upload}
        createUploadBatch={mocks.createBatch}
        completeUploadBatch={mocks.completeBatch}
        listUploadBatches={mocks.listBatches}
        getUploadBatch={mocks.getBatch}
        cancelUploadBatch={mocks.cancelBatch}
      />
    );

    expect(
      await screen.findByText('相似图片关系需要由档案本人确认')
    ).toBeInTheDocument();
    expect(mocks.listSimilarityRelations).not.toHaveBeenCalled();
    expect(mocks.reviewSimilarityRelation).not.toHaveBeenCalled();
  });
});
