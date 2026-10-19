import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthSourcesPanel from './HealthSourcesPanel';

const apiMocks = vi.hoisted(() => ({
  listSourceDocuments: vi.fn(),
  listBatches: vi.fn(),
  listParseTasks: vi.fn(),
  getParserReadiness: vi.fn(),
  startParseTask: vi.fn(),
  getParseTask: vi.fn(),
  retryParseTask: vi.fn(),
  cancelParseTask: vi.fn(),
  getBatch: vi.fn(),
  uploadSourceDocument: vi.fn(),
  getSourceDocumentDependencies: vi.fn(),
  withdrawSourceDocument: vi.fn(),
  restoreSourceDocument: vi.fn(),
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: apiMocks,
}));

describe('HealthSourcesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listSourceDocuments.mockResolvedValue([
      {
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
        sha256:
          'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        storage_backend: 'local',
        status: 'uploaded',
        created_at: '2026-01-16T00:00:00Z',
        updated_at: '2026-01-16T00:00:00Z',
      },
    ]);
    apiMocks.listBatches.mockResolvedValue([
      {
        id: 31,
        patient_id: 7,
        source_document_id: 11,
        idempotency_key: 'pending-synthetic',
        parser_name: 'generic-csv',
        parser_version: '1',
        status: 'pending_review',
        summary: {
          total: 2,
          pending: 2,
          accepted: 0,
          rejected: 0,
          duplicate: 0,
          quality_issue_count: 2,
        },
        items: [],
        created_at: '2026-01-16T00:00:00Z',
      },
      {
        id: 32,
        patient_id: 7,
        source_document_id: 11,
        idempotency_key: 'reviewed-synthetic',
        parser_name: 'manual-ui',
        parser_version: '1',
        status: 'reviewed',
        summary: {
          total: 1,
          pending: 0,
          accepted: 1,
          rejected: 0,
          duplicate: 0,
          quality_issue_count: 1,
        },
        items: [],
        created_at: '2026-01-17T00:00:00Z',
      },
      {
        id: 33,
        patient_id: 7,
        source_document_id: 11,
        idempotency_key: 'committed-synthetic',
        parser_name: 'manual-ui',
        parser_version: '1',
        status: 'committed',
        summary: {
          total: 1,
          pending: 0,
          accepted: 1,
          rejected: 0,
          duplicate: 0,
          quality_issue_count: 0,
        },
        items: [],
        created_at: '2026-01-18T00:00:00Z',
      },
    ]);
    apiMocks.listParseTasks.mockResolvedValue([]);
    apiMocks.getParserReadiness.mockResolvedValue({
      parser_name: 'local-core-lab',
      parser_version: '1.0.0',
      status: 'partial',
      capabilities: {
        digital_pdf: { status: 'ready', reason_codes: [] },
        image_ocr: {
          status: 'partial',
          reason_codes: ['chi_sim_language_missing'],
        },
        scanned_pdf_ocr: {
          status: 'unavailable',
          reason_codes: ['pdf2image_missing'],
        },
        heic_image_ocr: {
          status: 'unavailable',
          reason_codes: ['heic_decoder_missing'],
        },
      },
      supported_ocr_languages: ['eng'],
      reason_codes: [
        'chi_sim_language_missing',
        'pdf2image_missing',
        'heic_decoder_missing',
      ],
      worker: {
        status: 'running',
        poll_seconds: 5,
        max_tasks_per_cycle: 4,
        last_cycle_at: null,
        last_cycle_processed: 0,
        last_recovered_count: 1,
      },
      checked_at: '2026-07-27T08:00:00Z',
    });
    apiMocks.startParseTask.mockResolvedValue({
      id: 51,
      patient_id: 7,
      source_document_id: 11,
      created_by_user_id: 5,
      import_batch_id: 31,
      idempotency_key: 'synthetic-parse-task',
      parser_name: 'local-core-lab',
      parser_version: '1.0.0',
      status: 'succeeded',
      attempt_count: 1,
      summary: {
        candidate_count: 2,
        low_confidence_count: 0,
        unparsed_count: 0,
        formal_write_count: 0,
        page_count: 1,
        extraction_method: 'native',
      },
      created_at: '2026-01-16T00:00:00Z',
      updated_at: '2026-01-16T00:00:01Z',
    });
    apiMocks.getSourceDocumentDependencies.mockResolvedValue({
      source_document_id: 11,
      import_batches_total: 3,
      import_batches_open: 2,
      import_batches_committed: 1,
      formal_lab_components: 1,
      health_background_entries: 0,
      health_coverage_statements: 0,
      duplicate_documents: 0,
      has_derived_data: true,
    });
    apiMocks.withdrawSourceDocument.mockResolvedValue({
      document: {
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
        sha256:
          'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        storage_backend: 'local',
        status: 'archived',
        withdrawn_at: '2026-07-27T08:00:00Z',
        withdrawn_by_user_id: 5,
        withdrawal_reason: 'Wrong assignment',
        created_at: '2026-01-16T00:00:00Z',
        updated_at: '2026-07-27T08:00:00Z',
      },
      dependencies: {
        source_document_id: 11,
        import_batches_total: 3,
        import_batches_open: 2,
        import_batches_committed: 1,
        formal_lab_components: 1,
        health_background_entries: 0,
        health_coverage_statements: 0,
        duplicate_documents: 0,
        has_derived_data: true,
      },
    });
  });

  it('shows source metadata without implying that values were imported', async () => {
    render(
      <MantineProvider>
        <HealthSourcesPanel patientId={7} />
      </MantineProvider>
    );

    expect(
      await screen.findByText('Synthetic source document')
    ).toBeInTheDocument();
    expect(screen.getByText('abcdef123456…')).toBeInTheDocument();
    expect(
      screen.getByText('sourceWorkspace.safetyNotice')
    ).toBeInTheDocument();
    expect(screen.getByText('#31')).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.listSourceDocuments).toHaveBeenCalledWith(
        7,
        expect.any(AbortSignal),
        true
      )
    );
  });

  it('shows one member-scoped entry launchpad without duplicating existing forms', async () => {
    render(
      <MantineProvider>
        <HealthSourcesPanel patientId={7} />
      </MantineProvider>
    );

    expect(
      await screen.findByText('sourceWorkspace.entryWorkspace.title')
    ).toBeInTheDocument();
    expect(screen.getByTestId('entry-summary-documents')).toHaveTextContent(
      '1'
    );
    expect(screen.getByTestId('entry-summary-pending')).toHaveTextContent('1');
    expect(screen.getByTestId('entry-summary-reviewed')).toHaveTextContent('1');
    expect(screen.getByTestId('entry-summary-committed')).toHaveTextContent(
      '1'
    );
    expect(screen.getByTestId('entry-summary-quality')).toHaveTextContent('3');

    expect(
      screen.getByRole('link', {
        name: 'sourceWorkspace.entryWorkspace.actions.lab',
      })
    ).toHaveAttribute('href', '/lab-results');
    expect(
      screen.getByRole('link', {
        name: 'sourceWorkspace.entryWorkspace.actions.vitals',
      })
    ).toHaveAttribute('href', '/vitals');
    expect(
      screen.getByRole('link', {
        name: 'sourceWorkspace.entryWorkspace.actions.background',
      })
    ).toHaveAttribute('href', '/health-insights?view=background');

    for (const stage of ['original', 'candidate', 'review', 'commit']) {
      expect(
        screen.getByText(
          `sourceWorkspace.entryWorkspace.workflow.${stage}.title`
        )
      ).toBeInTheDocument();
    }
  });

  it('focuses the exact source document requested by an internal ID', async () => {
    render(
      <MantineProvider>
        <HealthSourcesPanel patientId={7} focusedSourceDocumentId={11} />
      </MantineProvider>
    );

    const sourceRow = (
      await screen.findByText('Synthetic source document')
    ).closest('tr');
    expect(sourceRow).toHaveAttribute('id', 'health-source-document-11');
    expect(sourceRow).toHaveAttribute('data-focused', 'true');
    expect(
      screen.getByText('visualizationContext.source.focused')
    ).toBeInTheDocument();
  });

  it('starts local parsing from the original and keeps results in review', async () => {
    render(
      <MantineProvider>
        <HealthSourcesPanel patientId={7} />
      </MantineProvider>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'sourceParse.start' })
    );

    await waitFor(() =>
      expect(apiMocks.startParseTask).toHaveBeenCalledWith(11)
    );
    expect(
      await screen.findByText('sourceParse.successNotice')
    ).toBeInTheDocument();
    expect(
      screen.getByText('sourceParse.summary.formal_write_count')
    ).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(
      await screen.findByText(
        'sourceParse.readiness.capabilities.scanned_pdf_ocr'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('sourceParse.readiness.partialHint')
    ).toBeInTheDocument();
    expect(apiMocks.getParserReadiness).toHaveBeenCalledWith(
      7,
      expect.any(AbortSignal)
    );
  });

  it('offers explicit recovery when a running parse task is stale', async () => {
    const staleTask = {
      id: 52,
      patient_id: 7,
      source_document_id: 11,
      created_by_user_id: 5,
      import_batch_id: null,
      idempotency_key: 'stale-synthetic-parse-task',
      parser_name: 'local-core-lab',
      parser_version: '1.0.0',
      status: 'running',
      attempt_count: 1,
      summary: {},
      started_at: '2020-01-01T00:00:00Z',
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    };
    apiMocks.listParseTasks.mockResolvedValue([staleTask]);
    apiMocks.retryParseTask.mockResolvedValue({
      ...staleTask,
      status: 'queued',
      started_at: null,
      attempt_count: 1,
    });

    render(
      <MantineProvider>
        <HealthSourcesPanel patientId={7} />
      </MantineProvider>
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'sourceParse.viewTask' })
    );
    expect(
      await screen.findByText('sourceParse.staleNotice')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'sourceParse.resume' }));
    await waitFor(() =>
      expect(apiMocks.retryParseTask).toHaveBeenCalledWith(52)
    );
  });

  it('shows dependency impact before recoverably withdrawing an original', async () => {
    render(
      <MantineProvider>
        <HealthSourcesPanel patientId={7} />
      </MantineProvider>
    );

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'sourceWorkspace.lifecycle.withdraw',
      })
    );

    expect(
      await screen.findByText('sourceWorkspace.lifecycle.dependenciesTitle')
    ).toBeInTheDocument();
    expect(
      screen.getByText('sourceWorkspace.lifecycle.preserveDependencies')
    ).toBeInTheDocument();
    expect(apiMocks.getSourceDocumentDependencies).toHaveBeenCalledWith(11);

    fireEvent.change(
      screen.getByLabelText('sourceWorkspace.lifecycle.reasonLabel'),
      { target: { value: 'Wrong assignment' } }
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'sourceWorkspace.lifecycle.confirmWithdraw',
      })
    );

    await waitFor(() =>
      expect(apiMocks.withdrawSourceDocument).toHaveBeenCalledWith(
        11,
        'Wrong assignment'
      )
    );
    expect(
      await screen.findByRole('button', {
        name: 'sourceWorkspace.lifecycle.restore',
      })
    ).toBeInTheDocument();
  });
});
