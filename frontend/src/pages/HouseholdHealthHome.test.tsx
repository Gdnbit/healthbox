import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getVitals: vi.fn(),
  getCatalog: vi.fn(),
  getTrend: vi.fn(),
  getSourceDocuments: vi.fn(),
  listParseTasks: vi.fn(),
  listBatches: vi.fn(),
  startParseTask: vi.fn(),
  getParseTask: vi.fn(),
  getBatch: vi.fn(),
  previewSourceDocument: vi.fn(),
  uploadSourceDocument: vi.fn(),
  listSourceUploadBatches: vi.fn(),
  listArchiveSubjects: vi.fn(),
  getArchiveDashboard: vi.fn(),
  getDashboardPreferences: vi.fn(),
  updateDashboardPreferences: vi.fn(),
  getAiCapabilities: vi.fn(),
  askAiQuestion: vi.fn(),
  listAiAnswers: vi.fn(),
  getAiAnswer: vi.fn(),
  deleteAiAnswer: vi.fn(),
  setCurrentPatient: vi.fn(),
  isOwner: false,
  ownerUserId: 99,
}));

vi.mock('../hooks/useGlobalData', () => ({
  useCurrentPatient: () => ({
    patient: {
      id: 7,
      first_name: '王',
      last_name: '芳',
      owner_user_id: mocks.ownerUserId,
      permission_level: 'view',
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
  usePatientList: () => ({
    patientList: [
      {
        id: 7,
        first_name: '王',
        last_name: '芳',
        owner_user_id: mocks.ownerUserId,
        permission_level: 'view',
      },
    ],
    loading: false,
  }),
  useCacheManager: () => ({
    setCurrentPatient: mocks.setCurrentPatient,
  }),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

vi.mock('../hooks/usePatientPermissions', () => ({
  usePatientPermissions: () => ({ isOwner: mocks.isOwner }),
}));

vi.mock('../services/medical/vitalsService', () => ({
  vitalsService: { getPatientVitals: mocks.getVitals },
}));

vi.mock('../services/api/labTestComponentApi', () => ({
  labTestComponentApi: {
    getComponentCatalog: mocks.getCatalog,
    getTrendsByPatientAndTest: mocks.getTrend,
  },
}));

vi.mock('../services/api/healthImportApi', () => ({
  default: {
    listSourceDocuments: mocks.getSourceDocuments,
    listParseTasks: mocks.listParseTasks,
    listBatches: mocks.listBatches,
    startParseTask: mocks.startParseTask,
    getParseTask: mocks.getParseTask,
    getBatch: mocks.getBatch,
    previewSourceDocument: mocks.previewSourceDocument,
    uploadSourceDocument: mocks.uploadSourceDocument,
    listSourceUploadBatches: mocks.listSourceUploadBatches,
  },
}));

vi.mock('../services/api/archiveCircleApi', () => ({
  default: {
    listSubjects: mocks.listArchiveSubjects,
    getDashboard: mocks.getArchiveDashboard,
    getDashboardPreferences: mocks.getDashboardPreferences,
    updateDashboardPreferences: mocks.updateDashboardPreferences,
  },
}));

vi.mock('../services/api/healthAiApi', () => ({
  default: {
    getCapabilities: mocks.getAiCapabilities,
    askQuestion: mocks.askAiQuestion,
    listAnswers: mocks.listAiAnswers,
    getAnswer: mocks.getAiAnswer,
    deleteAnswer: mocks.deleteAiAnswer,
  },
}));

vi.mock('./prototype/HouseholdHealthPrototype', () => ({
  default: ({
    experience,
    loading,
    onUpload,
    onParseReport,
    onPreviewReport,
    aiCapability,
    onAskAi,
    aiHistory,
    aiHistoryLoading,
    aiHistoryLoadingMore,
    aiHistoryTotal,
    aiHistoryError,
    onLoadMoreAiHistory,
    onRetryAiHistory,
    onOpenAiHistory,
    onDeleteAiHistory,
    onSubjectChange,
    dashboardPreferences,
    onDashboardPreferencesChange,
  }: {
    experience: {
      subject: { label: string } | null;
      subjects: Array<{ id: number; label: string }>;
      snapshot: {
        reports: Array<{
          title?: string;
          statusLabel?: string;
          processingActionLabel?: string | null;
        }>;
        metrics: Array<{ label: string }>;
      };
      capabilities: {
        canUpload: boolean;
        canExport: boolean;
        canUseAi: boolean;
        canViewSources: boolean;
        canPreviewSources?: boolean;
        canCopyForAi?: boolean;
        canShare?: boolean;
      };
    };
    loading: boolean;
    onUpload: () => void;
    onParseReport?: (_sourceDocumentId: number) => void;
    onPreviewReport?: (_sourceDocumentId: number) => Promise<Blob>;
    aiCapability?: { available: boolean } | null;
    onAskAi?: (_request: {
      question_id: 'recent_changes';
      question: string;
      range: '5y';
      record_ids: string[];
    }) => Promise<unknown>;
    aiHistory?: Array<{ answer_id: number; question: string }>;
    aiHistoryLoading?: boolean;
    aiHistoryLoadingMore?: boolean;
    aiHistoryTotal?: number;
    aiHistoryError?: string;
    onLoadMoreAiHistory?: () => Promise<void>;
    onRetryAiHistory?: () => Promise<void>;
    onOpenAiHistory?: (_answerId: number) => Promise<unknown>;
    onDeleteAiHistory?: (_answerId: number) => Promise<void>;
    onSubjectChange?: (_subjectId: number) => void;
    dashboardPreferences?: {
      pinnedMetricIds: string[];
      rangesByMetricId: Record<string, string>;
    } | null;
    onDashboardPreferencesChange?: (_preferences: {
      pinnedMetricIds: string[];
      rangesByMetricId: Record<string, string>;
    }) => void;
  }) => (
    <div>
      <span>{experience.subject?.label || '无档案'}</span>
      <span>{loading ? '加载中' : '加载完成'}</span>
      <span>{`报告 ${experience.snapshot.reports.length}`}</span>
      <span>{`报告名 ${experience.snapshot.reports[0]?.title || '无'}`}</span>
      <span>{`指标 ${experience.snapshot.metrics[0]?.label || '无'}`}</span>
      <span>{`状态 ${experience.snapshot.reports[0]?.statusLabel || '无'}`}</span>
      <span>{`上传 ${experience.capabilities.canUpload}`}</span>
      <span>{`导出 ${experience.capabilities.canExport}`}</span>
      <span>{`AI ${experience.capabilities.canUseAi}`}</span>
      <span>{`复制 ${Boolean(experience.capabilities.canCopyForAi)}`}</span>
      <span>{`分享 ${Boolean(experience.capabilities.canShare)}`}</span>
      <span>{`原件 ${experience.capabilities.canViewSources}`}</span>
      <span>{`预览 ${Boolean(experience.capabilities.canPreviewSources)}`}</span>
      <span>{`模型 ${Boolean(aiCapability?.available)}`}</span>
      <span>{`历史${aiHistoryLoading ? '加载中' : ` ${aiHistory?.length ?? 0}`}`}</span>
      <span>{`历史总数 ${aiHistoryTotal ?? 0}`}</span>
      <span>{`历史错误 ${aiHistoryError || '无'}`}</span>
      <span>{`历史追加${aiHistoryLoadingMore ? '加载中' : '空闲'}`}</span>
      <span>{`常看 ${dashboardPreferences?.pinnedMetricIds.join(',') || '默认'}`}</span>
      {experience.subjects.map(subject => (
        <button
          key={subject.id}
          type="button"
          aria-label={`切换档案：${subject.label}`}
          onClick={() => onSubjectChange?.(subject.id)}
        >
          切换{subject.label}
        </button>
      ))}
      {experience.capabilities.canUpload ? (
        <button type="button" onClick={onUpload}>
          打开上传
        </button>
      ) : null}
      {experience.capabilities.canPreviewSources ? (
        <button type="button" onClick={() => void onPreviewReport?.(41)}>
          预览原件
        </button>
      ) : null}
      {onParseReport && experience.snapshot.reports[0] ? (
        <button type="button" onClick={() => onParseReport(41)}>
          {experience.snapshot.reports[0].processingActionLabel || '处理报告'}
        </button>
      ) : null}
      {onDashboardPreferencesChange ? (
        <button
          type="button"
          onClick={() =>
            onDashboardPreferencesChange({
              pinnedMetricIds: ['vital:weight'],
              rangesByMetricId: { 'vital:weight': '5y' },
            })
          }
        >
          保存显示偏好
        </button>
      ) : null}
      {onAskAi ? (
        <button
          type="button"
          onClick={() =>
            void onAskAi({
              question_id: 'recent_changes',
              question: '最近有哪些变化？',
              range: '5y',
              record_ids: ['lab:9'],
            }).catch(() => undefined)
          }
        >
          提交 AI
        </button>
      ) : null}
      {onOpenAiHistory && aiHistory?.[0] ? (
        <button
          type="button"
          onClick={() => void onOpenAiHistory(aiHistory[0].answer_id)}
        >
          打开历史回答
        </button>
      ) : null}
      {onDeleteAiHistory && aiHistory?.[0] ? (
        <button
          type="button"
          onClick={() => void onDeleteAiHistory(aiHistory[0].answer_id)}
        >
          删除历史回答
        </button>
      ) : null}
      {onLoadMoreAiHistory &&
      (aiHistory?.length ?? 0) < (aiHistoryTotal ?? 0) ? (
        <button
          type="button"
          onClick={() => void onLoadMoreAiHistory()}
          disabled={aiHistoryLoadingMore}
        >
          加载更多历史
        </button>
      ) : null}
      {aiHistoryError && onRetryAiHistory ? (
        <button type="button" onClick={() => void onRetryAiHistory()}>
          重试历史
        </button>
      ) : null}
    </div>
  ),
}));

const renderPage = async () => {
  const { default: HouseholdHealthHome } =
    await import('./HouseholdHealthHome');
  return render(
    <MantineProvider>
      <MemoryRouter>
        <HouseholdHealthHome />
      </MemoryRouter>
    </MantineProvider>
  );
};

const buildAiHistorySummary = (answerId: number, patientId = 7) => ({
  answer_id: answerId,
  request_id: `saved-answer-${answerId}`,
  patient_id: patientId,
  question_id: 'recent_changes',
  question: '最近有哪些变化？',
  range: '5y',
  generated_at: `2026-07-${String(Math.max(1, answerId % 28)).padStart(2, '0')}T05:00:00Z`,
  data_cutoff: '2026-06-18',
  provider: 'local_openai_compatible',
  model: '家庭服务器安全整理器',
  test_mode: false,
  record_count: 1,
});

const deferred = <T,>() => {
  let resolve!: (_value: T | PromiseLike<T>) => void;
  let reject!: (_reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('HouseholdHealthHome', () => {
  beforeEach(() => {
    const persistedValues = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation(
      key => persistedValues.get(key) ?? null
    );
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      persistedValues.set(key, value);
    });
    vi.mocked(localStorage.removeItem).mockImplementation(key => {
      persistedValues.delete(key);
    });
    vi.mocked(localStorage.clear).mockImplementation(() => {
      persistedValues.clear();
    });
    mocks.isOwner = false;
    mocks.ownerUserId = 99;
    mocks.getVitals.mockReset().mockResolvedValue([]);
    mocks.getCatalog.mockReset().mockResolvedValue({ items: [], total: 0 });
    mocks.getTrend.mockReset();
    mocks.getSourceDocuments.mockReset().mockResolvedValue([
      {
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
      },
    ]);
    mocks.listParseTasks.mockReset().mockResolvedValue([]);
    mocks.listBatches.mockReset().mockResolvedValue([]);
    mocks.startParseTask.mockReset();
    mocks.getParseTask.mockReset();
    mocks.getBatch.mockReset();
    mocks.previewSourceDocument
      .mockReset()
      .mockResolvedValue(
        new Blob(['synthetic report'], { type: 'application/pdf' })
      );
    mocks.uploadSourceDocument.mockReset().mockResolvedValue({ id: 42 });
    mocks.listSourceUploadBatches.mockReset().mockResolvedValue([]);
    mocks.listArchiveSubjects.mockReset().mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'structured_dashboard',
          available: true,
          relationship_changed_at: '2026-07-27T10:00:00Z',
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.getArchiveDashboard.mockReset().mockResolvedValue({
      subject: {
        patient_id: 7,
        display_name: '王芳',
        scope: 'structured_dashboard',
        available: true,
        relationship_changed_at: '2026-07-27T10:00:00Z',
      },
      metrics: [],
      loaded_at: '2026-07-27T10:01:00Z',
    });
    mocks.getDashboardPreferences.mockReset().mockResolvedValue({
      patient_id: 7,
      pinned_metric_ids: ['vital:blood_pressure'],
      ranges_by_metric_id: { 'vital:blood_pressure': '2y' },
      updated_at: '2026-07-28T03:00:00Z',
    });
    mocks.updateDashboardPreferences.mockReset().mockResolvedValue({
      patient_id: 7,
      pinned_metric_ids: ['vital:weight'],
      ranges_by_metric_id: { 'vital:weight': '5y' },
      updated_at: '2026-07-28T03:05:00Z',
    });
    mocks.getAiCapabilities.mockReset().mockResolvedValue({
      available: true,
      provider: 'local_openai_compatible',
      model: 'fixture-local-model',
      processing_location: '家庭服务器处理',
      reason_code: null,
      test_mode: false,
      processing_mode: 'local',
      local_handoff_available: true,
      supported_question_ids: ['recent_changes'],
      screening_question_available: false,
    });
    mocks.askAiQuestion.mockReset().mockResolvedValue({
      status: 'answered',
      answer_id: 13,
      request_id: 'new-answer',
      patient_id: 7,
      question_id: 'recent_changes',
      question: '最近有哪些变化？',
      generated_at: '2026-07-28T05:00:00Z',
      scope: {
        range: '5y',
        record_count: 1,
        metric_count: 1,
        data_cutoff: '2026-06-18',
        includes_originals: false,
        includes_narrative_background: false,
        includes_guidance: false,
        includes_screening_state: false,
      },
      processing: {
        provider: 'local_openai_compatible',
        model: 'fixture-local-model',
        processing_location: '家庭服务器处理',
        test_mode: false,
        processing_mode: 'local',
        template_version: 'household-ai-answer@1.0.0',
      },
      answer_items: [],
      general_explanations: [],
      citations: [],
      limitations: [],
      next_steps: [],
      disclaimer: '仅用于资料整理。',
    });
    mocks.listAiAnswers.mockReset().mockResolvedValue({
      items: [
        {
          answer_id: 12,
          request_id: 'saved-answer',
          patient_id: 7,
          question_id: 'recent_changes',
          question: '上一次有哪些变化？',
          range: '5y',
          generated_at: '2026-07-27T05:00:00Z',
          data_cutoff: '2026-06-18',
          provider: 'local_openai_compatible',
          model: 'fixture-local-model',
          test_mode: false,
          record_count: 1,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    });
    mocks.getAiAnswer.mockReset().mockResolvedValue({
      answer_id: 12,
      status: 'answered',
    });
    mocks.deleteAiAnswer.mockReset().mockResolvedValue({
      answer_id: 12,
      status: 'deleted',
    });
  });

  it('loads the selected subject and disables owner-only actions for a shared archive', async () => {
    await renderPage();

    expect(await screen.findByText('王芳')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('报告 0')).toBeInTheDocument());
    expect(screen.getByText('上传 false')).toBeInTheDocument();
    expect(screen.getByText('导出 false')).toBeInTheDocument();
    expect(screen.getByText('AI false')).toBeInTheDocument();
    expect(screen.getByText('原件 false')).toBeInTheDocument();
    expect(screen.getByText('预览 false')).toBeInTheDocument();
    expect(mocks.getArchiveDashboard).toHaveBeenCalledWith(
      7,
      expect.any(AbortSignal)
    );
    expect(mocks.getVitals).not.toHaveBeenCalled();
    expect(mocks.getSourceDocuments).not.toHaveBeenCalled();
    expect(mocks.getAiCapabilities).not.toHaveBeenCalled();
    expect(mocks.listAiAnswers).not.toHaveBeenCalled();
  });

  it('fails closed with an empty loading snapshot while switching from a shared subject back to a delayed owner snapshot', async () => {
    const delayedOwnerVitals =
      deferred<Array<{ id: number; recorded_date: string; weight: number }>>();
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '我的档案',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
        {
          patient_id: 8,
          display_name: '共享成员',
          scope: 'structured_dashboard',
          available: true,
          relationship_changed_at: '2026-07-28T10:00:00Z',
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.getVitals
      .mockReset()
      .mockResolvedValueOnce([
        { id: 71, recorded_date: '2026-06-18T00:00:00Z', weight: 154 },
      ])
      .mockReturnValueOnce(delayedOwnerVitals.promise);
    mocks.getArchiveDashboard.mockResolvedValue({
      subject: {
        patient_id: 8,
        display_name: '共享成员',
        scope: 'structured_dashboard',
        available: true,
        relationship_changed_at: '2026-07-28T10:00:00Z',
      },
      metrics: [
        {
          id: 'lab:shared',
          kind: 'lab',
          label: '共享成员指标',
          unit: 'mmol/L',
          latest_status: 'normal',
          points: [
            {
              id: 'lab:801',
              date: '2026-06-18',
              value: 4.8,
              secondary_value: null,
              status: 'normal',
              reference_min: 3.9,
              reference_max: 6.1,
              reference_text: null,
            },
          ],
        },
      ],
      loaded_at: '2026-07-28T10:01:00Z',
    });

    await renderPage();

    await waitFor(() => {
      expect(screen.getByText('指标 体重')).toBeInTheDocument();
      expect(screen.getByText('导出 true')).toBeInTheDocument();
      expect(screen.getByText('复制 true')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '切换档案：共享成员' }));
    await waitFor(() => {
      expect(screen.getByText('共享成员')).toBeInTheDocument();
      expect(screen.getByText('指标 共享成员指标')).toBeInTheDocument();
      expect(screen.getByText('加载完成')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '切换档案：我的档案' }));

    expect(screen.getByText('我的档案')).toBeInTheDocument();
    expect(screen.getByText('加载中')).toBeInTheDocument();
    expect(screen.getByText('报告 0')).toBeInTheDocument();
    expect(screen.getByText('报告名 无')).toBeInTheDocument();
    expect(screen.getByText('指标 无')).toBeInTheDocument();
    expect(screen.getByText('导出 false')).toBeInTheDocument();
    expect(screen.getByText('AI false')).toBeInTheDocument();
    expect(screen.getByText('原件 false')).toBeInTheDocument();
    expect(screen.getByText('预览 false')).toBeInTheDocument();
    expect(screen.getByText('复制 false')).toBeInTheDocument();
    expect(screen.getByText('分享 false')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '提交 AI' })
    ).not.toBeInTheDocument();

    await act(async () => {
      delayedOwnerVitals.resolve([
        { id: 72, recorded_date: '2026-07-18T00:00:00Z', weight: 160 },
      ]);
      await delayedOwnerVitals.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('加载完成')).toBeInTheDocument();
      expect(screen.getByText('指标 体重')).toBeInTheDocument();
      expect(screen.getByText('报告名 年度体检报告')).toBeInTheDocument();
      expect(screen.getByText('导出 true')).toBeInTheDocument();
      expect(screen.getByText('AI true')).toBeInTheDocument();
      expect(screen.getByText('复制 true')).toBeInTheDocument();
      expect(screen.getByText('分享 true')).toBeInTheDocument();
    });
  });

  it('does not let an aborted owner response overwrite the newly loaded shared subject', async () => {
    const staleOwnerVitals =
      deferred<Array<{ id: number; recorded_date: string; weight: number }>>();
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '我的档案',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
        {
          patient_id: 8,
          display_name: '共享成员',
          scope: 'structured_dashboard',
          available: true,
          relationship_changed_at: '2026-07-28T10:00:00Z',
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.getVitals.mockReset().mockReturnValueOnce(staleOwnerVitals.promise);
    mocks.getArchiveDashboard.mockResolvedValue({
      subject: {
        patient_id: 8,
        display_name: '共享成员',
        scope: 'structured_dashboard',
        available: true,
        relationship_changed_at: '2026-07-28T10:00:00Z',
      },
      metrics: [
        {
          id: 'lab:shared-current',
          kind: 'lab',
          label: '共享成员当前指标',
          unit: 'mmol/L',
          latest_status: 'normal',
          points: [
            {
              id: 'lab:802',
              date: '2026-07-18',
              value: 5,
              secondary_value: null,
              status: 'normal',
              reference_min: 3.9,
              reference_max: 6.1,
              reference_text: null,
            },
          ],
        },
      ],
      loaded_at: '2026-07-28T10:01:00Z',
    });

    await renderPage();
    await waitFor(() => expect(mocks.getVitals).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '切换档案：共享成员' }));
    await waitFor(() => {
      expect(screen.getByText('共享成员')).toBeInTheDocument();
      expect(screen.getByText('指标 共享成员当前指标')).toBeInTheDocument();
      expect(screen.getByText('加载完成')).toBeInTheDocument();
    });

    await act(async () => {
      staleOwnerVitals.resolve([
        { id: 73, recorded_date: '2026-07-20T00:00:00Z', weight: 166 },
      ]);
      await staleOwnerVitals.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('共享成员')).toBeInTheDocument();
      expect(screen.getByText('指标 共享成员当前指标')).toBeInTheDocument();
      expect(screen.getByText('加载完成')).toBeInTheDocument();
    });
    expect(screen.queryByText('指标 体重')).not.toBeInTheDocument();
    expect(screen.getByText('导出 false')).toBeInTheDocument();
    expect(screen.getByText('复制 false')).toBeInTheDocument();
  });

  it('opens the multi-file original-preservation dialog only for the owner', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    await renderPage();

    await waitFor(() =>
      expect(mocks.getSourceDocuments).toHaveBeenCalledWith(
        7,
        expect.any(AbortSignal)
      )
    );
    expect(screen.getByText('AI true')).toBeInTheDocument();
    expect(screen.getByText('预览 true')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.getAiCapabilities).toHaveBeenCalledWith(
        7,
        expect.any(AbortSignal)
      );
      expect(screen.getByText('模型 true')).toBeInTheDocument();
      expect(screen.getByText('历史 1')).toBeInTheDocument();
    });
    expect(mocks.listAiAnswers).toHaveBeenCalledWith(7, {
      limit: 20,
      offset: 0,
      signal: expect.any(AbortSignal),
    });
    fireEvent.click(screen.getByRole('button', { name: '打开历史回答' }));
    await waitFor(() => {
      expect(mocks.getAiAnswer).toHaveBeenCalledWith(
        7,
        12,
        expect.any(AbortSignal)
      );
    });
    fireEvent.click(screen.getByRole('button', { name: '删除历史回答' }));
    await waitFor(() => {
      expect(mocks.deleteAiAnswer).toHaveBeenCalledWith(7, 12);
      expect(screen.getByText('历史 0')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '提交 AI' }));
    await waitFor(() => {
      expect(mocks.askAiQuestion).toHaveBeenCalledWith(
        7,
        {
          question_id: 'recent_changes',
          question: '最近有哪些变化？',
          range: '5y',
          record_ids: ['lab:9'],
        },
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        )
      );
    });
    await waitFor(() => expect(screen.getByText('历史 1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '预览原件' }));
    await waitFor(() => {
      expect(mocks.previewSourceDocument).toHaveBeenCalledWith(41);
    });
    fireEvent.click(screen.getByRole('button', { name: '打开上传' }));
    const dialog = screen.getByRole('dialog', { name: '上传新报告' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('保存到')).toBeInTheDocument();
    expect(within(dialog).getByText('王芳')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', {
        name: '保存后自动开始本地解析',
      })
    ).toBeChecked();
  });

  it('reuses a UUID after an unknown network outcome, clears it after success, and does not duplicate replayed history', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.askAiQuestion.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await renderPage();
    const submit = await screen.findByRole('button', { name: '提交 AI' });

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(1));
    const firstKey = mocks.askAiQuestion.mock.calls[0][2];
    expect(firstKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(2));
    expect(mocks.askAiQuestion.mock.calls[1][2]).toBe(firstKey);
    await waitFor(() => {
      expect(screen.getByText('历史 2')).toBeInTheDocument();
      expect(screen.getByText('历史总数 2')).toBeInTheDocument();
    });

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(3));
    expect(mocks.askAiQuestion.mock.calls[2][2]).not.toBe(firstKey);
    await waitFor(() => {
      expect(screen.getByText('历史 2')).toBeInTheDocument();
      expect(screen.getByText('历史总数 2')).toBeInTheDocument();
    });
  });

  it('reuses the UUID only for the explicit in-progress conflict and clears it for a rate-limit response', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.askAiQuestion
      .mockRejectedValueOnce(
        Object.assign(new Error('request in progress'), {
          status: 409,
          code: 'health_ai_request_in_progress',
        })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('rate limited'), {
          status: 429,
          code: 'health_ai_rate_limit_exceeded',
        })
      );

    await renderPage();
    const submit = await screen.findByRole('button', { name: '提交 AI' });

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(1));
    const inProgressKey = mocks.askAiQuestion.mock.calls[0][2];

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(2));
    expect(mocks.askAiQuestion.mock.calls[1][2]).toBe(inProgressKey);

    fireEvent.click(submit);
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(3));
    expect(mocks.askAiQuestion.mock.calls[2][2]).not.toBe(inProgressKey);
  });

  it('keeps a retained AI request UUID when leaving and returning to the subject', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '我的档案',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
        {
          patient_id: 8,
          display_name: '共享成员',
          scope: 'structured_dashboard',
          available: true,
          relationship_changed_at: '2026-07-28T10:00:00Z',
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.askAiQuestion.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '提交 AI' }));
    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(1));
    const retainedKey = mocks.askAiQuestion.mock.calls[0][2];

    fireEvent.click(screen.getByRole('button', { name: '切换档案：共享成员' }));
    await screen.findByText('共享成员');
    fireEvent.click(screen.getByRole('button', { name: '切换档案：我的档案' }));
    fireEvent.click(await screen.findByRole('button', { name: '提交 AI' }));

    await waitFor(() => expect(mocks.askAiQuestion).toHaveBeenCalledTimes(2));
    expect(mocks.askAiQuestion.mock.calls[1][2]).toBe(retainedKey);
  });

  it('shows an initial history error and retries the first page without claiming an empty history', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.listAiAnswers
      .mockRejectedValueOnce(new Error('history unavailable'))
      .mockResolvedValueOnce({
        items: [buildAiHistorySummary(12)],
        total: 1,
        limit: 20,
        offset: 0,
      });

    await renderPage();

    expect(
      await screen.findByText('历史错误 暂时无法读取整理结果，请稍后重试。')
    ).toBeInTheDocument();
    expect(screen.getByText('历史 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试历史' }));

    await waitFor(() => {
      expect(screen.getByText('历史 1')).toBeInTheDocument();
      expect(screen.getByText('历史总数 1')).toBeInTheDocument();
      expect(screen.getByText('历史错误 无')).toBeInTheDocument();
    });
    expect(mocks.listAiAnswers).toHaveBeenNthCalledWith(2, 7, {
      limit: 20,
      offset: 0,
    });
  });

  it('retains the first page and retries a failed load-more request until all history is loaded', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      buildAiHistorySummary(40 - index)
    );
    mocks.listAiAnswers
      .mockResolvedValueOnce({
        items: firstPage,
        total: 21,
        limit: 20,
        offset: 0,
      })
      .mockRejectedValueOnce(new Error('next page unavailable'))
      .mockResolvedValueOnce({
        items: [buildAiHistorySummary(20)],
        total: 21,
        limit: 20,
        offset: 20,
      });

    await renderPage();

    expect(await screen.findByText('历史 20')).toBeInTheDocument();
    expect(screen.getByText('历史总数 21')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));

    expect(
      await screen.findByText(
        '历史错误 暂时无法继续读取整理结果，已加载内容不受影响。'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('历史 20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试历史' }));

    await waitFor(() => {
      expect(screen.getByText('历史 21')).toBeInTheDocument();
      expect(screen.getByText('历史总数 21')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: '加载更多历史' })
      ).not.toBeInTheDocument();
    });
    expect(mocks.listAiAnswers).toHaveBeenNthCalledWith(2, 7, {
      limit: 20,
      offset: 20,
    });
    expect(mocks.listAiAnswers).toHaveBeenNthCalledWith(3, 7, {
      limit: 20,
      offset: 20,
    });
  });

  it('isolates an owner history error when switching to a shared subject and never requests shared history', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '我的档案',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
        {
          patient_id: 8,
          display_name: '共享成员',
          scope: 'structured_dashboard',
          available: true,
          relationship_changed_at: '2026-07-28T10:00:00Z',
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.getArchiveDashboard.mockImplementation(patientId =>
      Promise.resolve({
        subject: {
          patient_id: patientId,
          display_name: '共享成员',
          scope: 'structured_dashboard',
          available: true,
          relationship_changed_at: '2026-07-28T10:00:00Z',
        },
        metrics: [],
        loaded_at: '2026-07-28T10:01:00Z',
      })
    );
    mocks.listAiAnswers.mockRejectedValue(
      new Error('owner history unavailable')
    );

    await renderPage();

    expect(
      await screen.findByText('历史错误 暂时无法读取整理结果，请稍后重试。')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '切换档案：共享成员' }));

    await waitFor(() => {
      expect(screen.getByText('共享成员')).toBeInTheDocument();
      expect(screen.getByText('历史错误 无')).toBeInTheDocument();
      expect(screen.getByText('AI false')).toBeInTheDocument();
    });
    expect(mocks.listAiAnswers).toHaveBeenCalledTimes(1);
    expect(mocks.listAiAnswers).not.toHaveBeenCalledWith(8, expect.anything());
  });

  it('restores and saves dashboard preferences for the selected subject', async () => {
    await renderPage();

    expect(
      await screen.findByText('常看 vital:blood_pressure')
    ).toBeInTheDocument();
    expect(mocks.getDashboardPreferences).toHaveBeenCalledWith(
      7,
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole('button', { name: '保存显示偏好' }));

    await waitFor(() => {
      expect(mocks.updateDashboardPreferences).toHaveBeenCalledWith(7, {
        pinned_metric_ids: ['vital:weight'],
        ranges_by_metric_id: { 'vital:weight': '5y' },
      });
    });
    expect(screen.getByText('常看 vital:weight')).toBeInTheDocument();
  });

  it('opens the existing review batch from the report workflow action', async () => {
    mocks.isOwner = true;
    mocks.ownerUserId = 1;
    mocks.listArchiveSubjects.mockResolvedValue({
      subjects: [
        {
          patient_id: 7,
          display_name: '王芳',
          scope: 'owner',
          available: true,
          relationship_changed_at: null,
        },
      ],
      scope_notice: '共享档案仅包含结构化指标与趋势',
    });
    mocks.listParseTasks.mockResolvedValue([
      {
        id: 51,
        patient_id: 7,
        source_document_id: 41,
        created_by_user_id: 1,
        import_batch_id: 61,
        idempotency_key: 'parse-51',
        parser_name: 'local-core-lab',
        parser_version: '1.0.0',
        status: 'succeeded',
        attempt_count: 1,
        summary: {},
        created_at: '2026-06-18T10:00:00Z',
        updated_at: '2026-06-18T10:03:00Z',
      },
    ]);
    const reviewedBatch = {
      id: 61,
      patient_id: 7,
      source_document_id: 41,
      idempotency_key: 'batch-61',
      parser_name: 'local-core-lab',
      parser_version: '1.0.0',
      status: 'reviewed',
      summary: {
        total: 0,
        pending: 0,
        accepted: 0,
        rejected: 0,
        duplicate: 0,
        quality_issue_count: 0,
      },
      items: [],
      created_at: '2026-06-18T10:02:00Z',
      reviewed_at: '2026-06-18T10:04:00Z',
    };
    mocks.listBatches.mockResolvedValue([reviewedBatch]);
    mocks.getBatch.mockResolvedValue(reviewedBatch);

    await renderPage();

    expect(await screen.findByText('状态 待确认入库')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));

    await waitFor(() => expect(mocks.getBatch).toHaveBeenCalledWith(61));
  });
});
