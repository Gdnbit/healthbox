import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HealthImportBatch,
  HealthSourceDocument,
} from '../../services/api/healthImportApi';
import HealthImportBatchCreateModal from './HealthImportBatchCreateModal';
import HealthImportReviewModal from './HealthImportReviewModal';

const apiMocks = vi.hoisted(() => ({
  createBatch: vi.fn(),
  previewCsv: vi.fn(),
  reviewBatch: vi.fn(),
  commitBatch: vi.fn(),
  rollbackBatch: vi.fn(),
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: apiMocks,
}));

const sourceDocument: HealthSourceDocument = {
  id: 11,
  patient_id: 7,
  primary_file_id: 21,
  display_name: 'Synthetic source document',
  original_filename: 'synthetic.pdf',
  document_type: 'checkup',
  report_date: '2026-01-15',
  facility: 'Example clinic',
  mime_type: 'application/pdf',
  size_bytes: 4096,
  sha256: 'a'.repeat(64),
  storage_backend: 'local',
  status: 'uploaded',
  created_at: '2026-01-16T00:00:00Z',
  updated_at: '2026-01-16T00:00:00Z',
};

const batchFixture = (
  status: HealthImportBatch['status']
): HealthImportBatch => ({
  id: 31,
  patient_id: 7,
  source_document_id: 11,
  idempotency_key: 'synthetic-idempotency-key',
  parser_name: 'manual-ui',
  parser_version: '1',
  status,
  summary: {
    total: 1,
    pending: status === 'pending_review' ? 1 : 0,
    accepted: status === 'pending_review' ? 0 : 1,
    rejected: 0,
    duplicate: 0,
    quality_issue_count: 0,
  },
  items: [
    {
      id: 41,
      batch_id: 31,
      sequence: 1,
      observed_date: '2026-01-15',
      test_name: 'Synthetic marker zero',
      result_type: 'quantitative',
      numeric_value: 0,
      unit: 'unit/L',
      result_status: 'normal',
      category: 'chemistry',
      source_page: 1,
      raw_text: 'Synthetic marker zero 0 unit/L',
      confidence: 0.91,
      decision: status === 'pending_review' ? 'pending' : 'accepted',
      validation_issues: [],
    },
  ],
  created_at: '2026-01-16T00:00:00Z',
});

describe('health import workflow modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a review batch while preserving a numeric zero', async () => {
    const created = batchFixture('pending_review');
    apiMocks.createBatch.mockResolvedValue(created);
    const onCreated = vi.fn();

    render(
      <MantineProvider>
        <HealthImportBatchCreateModal
          patientId={7}
          sourceDocument={sourceDocument}
          opened
          onClose={vi.fn()}
          onCreated={onCreated}
        />
      </MantineProvider>
    );

    fireEvent.change(await screen.findByTestId(/source-entry-test-name-/), {
      target: { value: 'Synthetic marker zero' },
    });
    fireEvent.change(screen.getByTestId(/source-entry-numeric-value-/), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sourceEntry.create' }));

    await waitFor(() => expect(apiMocks.createBatch).toHaveBeenCalledOnce());
    const [, request] = apiMocks.createBatch.mock.calls[0];
    expect(request.candidates[0]).toMatchObject({
      test_name: 'Synthetic marker zero',
      numeric_value: 0,
      observed_date: '2026-01-15',
    });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(apiMocks.commitBatch).not.toHaveBeenCalled();
  });

  it('previews a synthetic CSV before creating a generic review batch', async () => {
    const created = batchFixture('pending_review');
    apiMocks.previewCsv.mockResolvedValue({
      total_rows: 1,
      valid_rows: 1,
      invalid_rows: 0,
      skipped_blank_rows: 0,
      encoding: 'utf-8-sig',
      delimiter: ',',
      rows: [
        {
          row_number: 2,
          candidate: {
            observed_date: '2026-01-15',
            test_name: 'Synthetic CSV marker',
            canonical_test_name: 'Synthetic CSV Marker',
            test_code: 'SYN-CSV',
            result_type: 'quantitative',
            numeric_value: 7.5,
            qualitative_value: null,
            textual_value: null,
            unit: 'unit/L',
            ref_range_min: 5,
            ref_range_max: 10,
            ref_range_text: null,
            result_status: 'normal',
            category: 'chemistry',
            source_page: 2,
            source_locator: 'table-1-row-2',
          },
          validation_issues: [],
        },
      ],
      errors: [],
    });
    apiMocks.createBatch.mockResolvedValue(created);

    render(
      <MantineProvider>
        <HealthImportBatchCreateModal
          patientId={7}
          sourceDocument={sourceDocument}
          opened
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByText('sourceEntry.modes.csv'));
    const file = new File(
      ['test_name,result_type,value\nSynthetic CSV marker,quantitative,7.5\n'],
      'synthetic.csv',
      { type: 'text/csv' }
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'sourceEntry.csv.preview' })
    );

    await waitFor(() =>
      expect(apiMocks.previewCsv).toHaveBeenCalledWith(7, file)
    );
    expect(
      await screen.findByDisplayValue('Synthetic CSV marker')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'sourceEntry.csv.downloadTemplate' })
    ).toHaveAttribute('href', '/templates/health-lab-import-template.csv');

    fireEvent.click(screen.getByRole('button', { name: 'sourceEntry.create' }));
    await waitFor(() => expect(apiMocks.createBatch).toHaveBeenCalledOnce());
    expect(apiMocks.createBatch.mock.calls[0][1]).toMatchObject({
      parser_name: 'generic-csv',
      parser_version: '1',
      candidates: [
        expect.objectContaining({
          test_name: 'Synthetic CSV marker',
          numeric_value: 7.5,
        }),
      ],
    });
  });

  it('blocks batch creation when any non-empty CSV row is invalid', async () => {
    apiMocks.previewCsv.mockResolvedValue({
      total_rows: 1,
      valid_rows: 0,
      invalid_rows: 1,
      skipped_blank_rows: 0,
      encoding: 'utf-8-sig',
      delimiter: ',',
      rows: [],
      errors: [
        {
          row_number: 2,
          field: 'observed_date',
          code: 'invalid_date',
          message: 'Use a supported calendar date format.',
        },
      ],
    });

    render(
      <MantineProvider>
        <HealthImportBatchCreateModal
          patientId={7}
          sourceDocument={sourceDocument}
          opened
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByText('sourceEntry.modes.csv'));
    const file = new File(['invalid'], 'invalid.csv', { type: 'text/csv' });
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [file] },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'sourceEntry.csv.preview' })
    );

    expect(
      await screen.findByText('sourceEntry.csv.blocked')
    ).toBeInTheDocument();
    expect(screen.getByText('sourceEntry.csv.errorAtRow')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'sourceEntry.create' })
    ).toBeDisabled();
    expect(apiMocks.createBatch).not.toHaveBeenCalled();
  });

  it('does not offer commit before review is complete', () => {
    render(
      <MantineProvider>
        <HealthImportReviewModal
          batch={batchFixture('pending_review')}
          opened
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </MantineProvider>
    );

    expect(screen.getByText('sourceReview.notice')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'sourceReview.commit' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'sourceReview.save' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Synthetic marker zero 0 unit/L')
    ).toBeInTheDocument();
    expect(screen.getByText('sourceReview.confidence')).toBeInTheDocument();
  });

  it('requires a separate confirmation before rollback', async () => {
    const committed = batchFixture('committed');
    const rolledBack = { ...committed, status: 'rolled_back' as const };
    apiMocks.rollbackBatch.mockResolvedValue({ batch: rolledBack });
    const onChanged = vi.fn();

    render(
      <MantineProvider>
        <HealthImportReviewModal
          batch={committed}
          opened
          onClose={vi.fn()}
          onChanged={onChanged}
        />
      </MantineProvider>
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'sourceReview.rollback' })
    );
    expect(apiMocks.rollbackBatch).not.toHaveBeenCalled();
    expect(
      await screen.findByText('sourceReview.rollbackConfirmMessage')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'sourceReview.confirmRollback' })
    );
    await waitFor(() =>
      expect(apiMocks.rollbackBatch).toHaveBeenCalledWith(31)
    );
    expect(onChanged).toHaveBeenCalledWith(rolledBack);
  });

  it('requires one explicit batch-level acknowledgement for a suspected subject mismatch', async () => {
    const reviewed = {
      ...batchFixture('reviewed'),
      subject_mismatch_warning: {
        code: 'subject_mismatch_suspected' as const,
        observed_name: 'Synthetic Different Person',
        confidence: 0.95,
        assessment_version: 'subject-identity-assessment@1.0.0',
        evidence: {
          label: 'patient_name',
          extraction_method: 'native',
          match_method: 'exact_normalized',
        },
        confirmation_required: true,
        confirmed_at: null,
      },
    };
    const committed = {
      ...reviewed,
      status: 'committed' as const,
      subject_mismatch_warning: {
        ...reviewed.subject_mismatch_warning,
        confirmation_required: false,
        confirmed_at: '2026-07-28T06:30:00Z',
      },
    };
    apiMocks.commitBatch.mockResolvedValue({
      batch: committed,
      created_lab_result_ids: [51],
      created_component_ids: [61],
    });

    render(
      <MantineProvider>
        <HealthImportReviewModal
          batch={reviewed}
          opened
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </MantineProvider>
    );

    expect(
      screen.getByText('sourceReview.subjectMismatchWarningTitle')
    ).toBeInTheDocument();
    expect(screen.getByText('Synthetic Different Person')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'sourceReview.commit' })
    );
    const confirmButton = await screen.findByRole('button', {
      name: 'sourceReview.confirmCommitToCurrentSubject',
    });
    expect(confirmButton).toBeDisabled();
    expect(apiMocks.commitBatch).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'sourceReview.subjectMismatchAcknowledge',
      })
    );
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(apiMocks.commitBatch).toHaveBeenCalledWith(31, {
        subject_mismatch_confirmation: {
          acknowledged: true,
          target_patient_id: 7,
          observed_name: 'Synthetic Different Person',
          assessment_version: 'subject-identity-assessment@1.0.0',
        },
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', {
          name: 'sourceReview.subjectMismatchConfirmTitle',
        })
      ).not.toBeInTheDocument()
    );
    expect(
      screen.queryByRole('dialog', {
        name: 'sourceReview.rollbackConfirmTitle',
      })
    ).not.toBeInTheDocument();
  });
});
