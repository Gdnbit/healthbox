/* eslint-disable i18next/no-literal-string -- Chinese-first family health home */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { useNavigate, useSearchParams } from 'react-router-dom';
import HealthImportReviewModal from '../components/health/HealthImportReviewModal';
import HealthSourceParseModal from '../components/health/HealthSourceParseModal';
import {
  emptyHouseholdHealthSnapshot,
  loadHouseholdHealthSnapshot,
  type HouseholdHealthDataDependencies,
} from '../features/householdHealth/householdHealthData';
import type {
  HouseholdHealthReport,
  HouseholdHealthExperienceModel,
  HouseholdHealthSnapshot,
  HouseholdHealthSubject,
} from '../features/householdHealth/types';
import {
  acquireHealthAiIdempotency,
  completeHealthAiIdempotency,
  shouldRetainHealthAiIdempotency,
} from '../features/householdHealth/healthAiIdempotency';
import HouseholdReportUploadModal from '../features/householdHealth/HouseholdReportUploadModal';
import type { HouseholdHealthDashboardPreferences } from '../features/householdHealth/householdHealthTrend';
import { useCurrentPatient } from '../hooks/useGlobalData';
import { usePatientPermissions } from '../hooks/usePatientPermissions';
import archiveCircleApi, {
  type ArchiveSubject,
  type StructuredDashboard,
} from '../services/api/archiveCircleApi';
import healthAiApi, {
  type HealthAiAnswerSummary,
  type HealthAiCapability,
  type HealthAiQuestionInput,
  type HealthAiQuestionResponse,
} from '../services/api/healthAiApi';
import healthImportApi, {
  type HealthImportBatch,
  type HealthSourceParseTask,
} from '../services/api/healthImportApi';
import { labTestComponentApi } from '../services/api/labTestComponentApi';
import { vitalsService } from '../services/medical/vitalsService';
import logger from '../services/logger';
import { downloadBlob } from '../utils/downloadUtils';
import {
  householdPageFromSearch,
  type HouseholdPageKey,
} from '../config/productRoutes';
import { useAuth } from '../contexts/AuthContext';
import HouseholdHealthPrototype from './prototype/HouseholdHealthPrototype';

interface PatientLike {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  owner_user_id?: number | null;
  permission_level?: string | null;
}

const dataDependencies: HouseholdHealthDataDependencies = {
  getVitals: (patientId, params) =>
    vitalsService.getPatientVitals(patientId, params),
  getCatalog: (patientId, options, signal) =>
    labTestComponentApi.getComponentCatalog(patientId, options, signal),
  getTrend: (patientId, testName, options, signal) =>
    labTestComponentApi.getTrendsByPatientAndTest(
      patientId,
      testName,
      options,
      signal
    ),
  getSourceDocuments: (patientId, signal) =>
    healthImportApi.listSourceDocuments(patientId, signal),
  getParseTasks: (patientId, signal) =>
    healthImportApi.listParseTasks(patientId, signal),
  getImportBatches: (patientId, signal) =>
    healthImportApi.listBatches(patientId, signal),
};

const patientLabel = (patient: PatientLike | null | undefined): string =>
  [patient?.first_name, patient?.last_name].filter(Boolean).join('').trim() ||
  '未命名成员';

const toSubject = (subject: ArchiveSubject): HouseholdHealthSubject => ({
  id: subject.patient_id,
  label: subject.display_name || '未命名成员',
  relationshipLabel: subject.scope === 'owner' ? '我的档案' : '可查看的档案',
});

const toSharedDashboardSnapshot = (
  dashboard: StructuredDashboard
): HouseholdHealthSnapshot => ({
  subjectState: 'ready',
  reports: [],
  errors: [],
  loadedAt: dashboard.loaded_at,
  metrics: dashboard.metrics.map(metric => ({
    id: metric.id,
    kind: metric.kind,
    label: metric.label,
    unit: metric.unit,
    latestStatus: metric.latest_status,
    points: metric.points.map(point => ({
      id: point.id,
      date: point.date,
      value: point.value,
      secondaryValue: point.secondary_value,
      sourceDocumentId: null,
      status: point.status,
    })),
  })),
});

interface HealthAiHistoryViewState {
  items: HealthAiAnswerSummary[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  failedOffset: number | null;
}

const EMPTY_AI_HISTORY_STATE: HealthAiHistoryViewState = {
  items: [],
  total: 0,
  loading: false,
  loadingMore: false,
  error: '',
  failedOffset: null,
};

const mergeAiHistory = (
  current: HealthAiAnswerSummary[],
  next: HealthAiAnswerSummary[]
): HealthAiAnswerSummary[] => {
  const seen = new Set(current.map(item => item.answer_id));
  return [
    ...current,
    ...next.filter(item => {
      if (seen.has(item.answer_id)) return false;
      seen.add(item.answer_id);
      return true;
    }),
  ];
};

const HouseholdHealthHome = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activePage = householdPageFromSearch(searchParams);
  const changePage = (page: HouseholdPageKey) => {
    setSearchParams(
      current => {
        const next = new URLSearchParams(current);
        if (page === 'home') next.delete('page');
        else next.set('page', page);
        return next;
      },
      { replace: false }
    );
  };
  const { patient, loading: patientLoading } = useCurrentPatient() as {
    patient?: PatientLike | null;
    loading: boolean;
    error?: string | null;
  };
  const { user } = useAuth();
  const { isOwner: currentPatientIsOwner } = usePatientPermissions();
  const currentPatientLabel = patientLabel(patient);
  const [archiveSubjects, setArchiveSubjects] = useState<ArchiveSubject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    patient?.id || null
  );
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [loadedSnapshot, setLoadedSnapshot] = useState<{
    patientId: number | null;
    value: HouseholdHealthSnapshot;
  }>(() => ({
    patientId: null,
    value: emptyHouseholdHealthSnapshot(patient?.id ? 'ready' : 'missing'),
  }));
  const [recordsLoading, setRecordsLoading] = useState(false);
  const snapshotRequestGeneration = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadChanged, setUploadChanged] = useState(false);
  const [selectedParseTask, setSelectedParseTask] =
    useState<HealthSourceParseTask | null>(null);
  const [selectedReviewBatch, setSelectedReviewBatch] =
    useState<HealthImportBatch | null>(null);
  const [processingChanged, setProcessingChanged] = useState(false);
  const [dashboardPreferencesBySubject, setDashboardPreferencesBySubject] =
    useState<Record<number, HouseholdHealthDashboardPreferences | null>>({});
  const [aiCapabilityBySubject, setAiCapabilityBySubject] = useState<
    Record<number, HealthAiCapability>
  >({});
  const [aiHistoryStateBySubject, setAiHistoryStateBySubject] = useState<
    Record<number, HealthAiHistoryViewState>
  >({});
  const dashboardPreferenceRevisions = useRef<Record<number, number>>({});
  const dashboardPreferenceSaveQueues = useRef<Map<number, Promise<void>>>(
    new Map()
  );
  const loadAiHistoryPage = useCallback(
    async (
      patientId: number,
      offset: number,
      signal?: AbortSignal
    ): Promise<void> => {
      setAiHistoryStateBySubject(current => {
        const previous = current[patientId] ?? EMPTY_AI_HISTORY_STATE;
        return {
          ...current,
          [patientId]: {
            ...previous,
            loading: offset === 0,
            loadingMore: offset > 0,
            error: '',
            failedOffset: null,
          },
        };
      });

      try {
        const history = await healthAiApi.listAnswers(patientId, {
          limit: 20,
          offset,
          ...(signal ? { signal } : {}),
        });
        if (signal?.aborted) return;
        setAiHistoryStateBySubject(current => {
          const previous = current[patientId] ?? EMPTY_AI_HISTORY_STATE;
          return {
            ...current,
            [patientId]: {
              items:
                offset === 0
                  ? history.items
                  : mergeAiHistory(previous.items, history.items),
              total: history.total,
              loading: false,
              loadingMore: false,
              error: '',
              failedOffset: null,
            },
          };
        });
      } catch (error) {
        if (signal?.aborted) return;
        logger.error('household_health_ai_history_load_error', {
          component: 'HouseholdHealthHome',
          patientId,
          offset,
          error: error instanceof Error ? error.message : String(error),
        });
        setAiHistoryStateBySubject(current => {
          const previous = current[patientId] ?? EMPTY_AI_HISTORY_STATE;
          return {
            ...current,
            [patientId]: {
              ...previous,
              loading: false,
              loadingMore: false,
              error:
                offset === 0
                  ? '暂时无法读取整理结果，请稍后重试。'
                  : '暂时无法继续读取整理结果，已加载内容不受影响。',
              failedOffset: offset,
            },
          };
        });
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    setDirectoryLoading(true);
    setDirectoryError('');
    void archiveCircleApi
      .listSubjects(controller.signal)
      .then(response => {
        if (controller.signal.aborted) return;
        const available = response.subjects.filter(
          subject => subject.available
        );
        setArchiveSubjects(available);
        setSelectedSubjectId(current => {
          if (
            current &&
            available.some(subject => subject.patient_id === current)
          ) {
            return current;
          }
          if (
            patient?.id &&
            available.some(subject => subject.patient_id === patient.id)
          ) {
            return patient.id;
          }
          return (
            available.find(subject => subject.scope === 'owner')?.patient_id ||
            available[0]?.patient_id ||
            null
          );
        });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('household_health_subject_directory_error', {
          component: 'HouseholdHealthHome',
          error: error instanceof Error ? error.message : String(error),
        });
        setDirectoryError('可查看的档案目录暂时无法载入。');
        if (patient?.id && currentPatientIsOwner) {
          setArchiveSubjects([
            {
              patient_id: patient.id,
              display_name: currentPatientLabel,
              scope: 'owner',
              available: true,
              relationship_changed_at: null,
            },
          ]);
          setSelectedSubjectId(patient.id);
        } else {
          setArchiveSubjects([]);
          setSelectedSubjectId(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDirectoryLoading(false);
      });

    return () => controller.abort();
  }, [currentPatientIsOwner, currentPatientLabel, patient?.id]);

  const selectedSubject = useMemo(
    () =>
      archiveSubjects.find(
        subject => subject.patient_id === selectedSubjectId
      ) || null,
    [archiveSubjects, selectedSubjectId]
  );
  const selectedIsOwner = selectedSubject?.scope === 'owner';
  const snapshotMatchesSelectedSubject =
    selectedSubject !== null &&
    loadedSnapshot.patientId === selectedSubject.patient_id;
  const selectedSnapshotLoading =
    selectedSubject !== null &&
    (recordsLoading || !snapshotMatchesSelectedSubject);
  const selectedSnapshotReady =
    snapshotMatchesSelectedSubject && !recordsLoading;
  const snapshot = selectedSnapshotReady
    ? loadedSnapshot.value
    : emptyHouseholdHealthSnapshot(selectedSubject ? 'ready' : 'missing');

  useEffect(() => {
    if (directoryLoading) return;
    if (!selectedSubject) {
      snapshotRequestGeneration.current += 1;
      setLoadedSnapshot({
        patientId: null,
        value: emptyHouseholdHealthSnapshot('missing'),
      });
      setRecordsLoading(false);
      return;
    }

    const requestGeneration = snapshotRequestGeneration.current + 1;
    snapshotRequestGeneration.current = requestGeneration;
    const patientId = selectedSubject.patient_id;
    const controller = new AbortController();
    setRecordsLoading(true);
    const request = selectedIsOwner
      ? loadHouseholdHealthSnapshot(
          patientId,
          dataDependencies,
          controller.signal
        )
      : archiveCircleApi
          .getDashboard(patientId, controller.signal)
          .then(toSharedDashboardSnapshot);

    void request
      .then(nextSnapshot => {
        if (
          !controller.signal.aborted &&
          snapshotRequestGeneration.current === requestGeneration
        ) {
          setLoadedSnapshot({
            patientId,
            value: nextSnapshot,
          });
        }
      })
      .catch(error => {
        if (
          controller.signal.aborted ||
          snapshotRequestGeneration.current !== requestGeneration
        ) {
          return;
        }
        logger.error('household_health_home_load_error', {
          component: 'HouseholdHealthHome',
          patientId,
          error: error instanceof Error ? error.message : String(error),
        });
        setLoadedSnapshot({
          patientId,
          value: {
            ...emptyHouseholdHealthSnapshot('ready'),
            errors: [
              {
                section: 'labs',
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          },
        });
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          snapshotRequestGeneration.current === requestGeneration
        ) {
          setRecordsLoading(false);
        }
      });

    return () => controller.abort();
  }, [directoryLoading, reloadToken, selectedIsOwner, selectedSubject]);

  useEffect(() => {
    if (directoryLoading || !selectedSubject) return;

    const patientId = selectedSubject.patient_id;
    const revisionAtStart =
      dashboardPreferenceRevisions.current[patientId] ?? 0;
    const controller = new AbortController();
    void archiveCircleApi
      .getDashboardPreferences(patientId, controller.signal)
      .then(response => {
        if (
          controller.signal.aborted ||
          (dashboardPreferenceRevisions.current[patientId] ?? 0) !==
            revisionAtStart
        ) {
          return;
        }
        setDashboardPreferencesBySubject(current => ({
          ...current,
          [patientId]: {
            pinnedMetricIds: response.pinned_metric_ids,
            rangesByMetricId: response.ranges_by_metric_id,
          },
        }));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('household_health_dashboard_preferences_load_error', {
          component: 'HouseholdHealthHome',
          patientId,
          error: error instanceof Error ? error.message : String(error),
        });
        setDashboardPreferencesBySubject(current =>
          patientId in current ? current : { ...current, [patientId]: null }
        );
      });

    return () => controller.abort();
  }, [directoryLoading, selectedSubject]);

  useEffect(() => {
    if (directoryLoading || !selectedSubject || !selectedIsOwner) return;

    const patientId = selectedSubject.patient_id;
    const controller = new AbortController();
    void healthAiApi
      .getCapabilities(patientId, controller.signal)
      .then(capability => {
        if (controller.signal.aborted) return;
        setAiCapabilityBySubject(current => ({
          ...current,
          [patientId]: capability,
        }));
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('household_health_ai_capability_load_error', {
          component: 'HouseholdHealthHome',
          patientId,
          error: error instanceof Error ? error.message : String(error),
        });
        setAiCapabilityBySubject(current => ({
          ...current,
          [patientId]: {
            available: false,
            provider: 'local_openai_compatible',
            model: null,
            processing_location: '家庭服务器处理',
            reason_code: 'capability_unavailable',
            test_mode: false,
            processing_mode: 'off',
            local_handoff_available: true,
            supported_question_ids: ['recent_changes'],
            screening_question_available: false,
          },
        }));
      });
    void loadAiHistoryPage(patientId, 0, controller.signal);

    return () => controller.abort();
  }, [directoryLoading, loadAiHistoryPage, selectedIsOwner, selectedSubject]);

  const subjects = useMemo(
    () =>
      archiveSubjects.map(toSubject).sort((a, b) => {
        if (a.id === selectedSubjectId) return -1;
        if (b.id === selectedSubjectId) return 1;
        return a.label.localeCompare(b.label, 'zh-CN');
      }),
    [archiveSubjects, selectedSubjectId]
  );

  const experience: HouseholdHealthExperienceModel = {
    subject: selectedSubject ? toSubject(selectedSubject) : null,
    subjects,
    snapshot,
    capabilities: {
      canUpload: selectedIsOwner,
      canExport: selectedIsOwner && selectedSnapshotReady,
      canUseAi: selectedIsOwner && selectedSnapshotReady,
      canViewSources: selectedIsOwner && selectedSnapshotReady,
      canReviseMetrics: selectedIsOwner && selectedSnapshotReady,
      canDownloadSources: selectedIsOwner && selectedSnapshotReady,
      canPreviewSources: selectedIsOwner && selectedSnapshotReady,
      canCopyForAi: selectedIsOwner && selectedSnapshotReady,
      canShare: selectedIsOwner && selectedSnapshotReady,
    },
    accessNotice:
      directoryError ||
      (selectedIsOwner
        ? undefined
        : '共享档案只展示结构化指标与趋势，不包含报告原件、文字描述、导出、修改、资料包复制或家庭服务器整理。'),
    mode: 'live',
  };
  const dashboardPreferences = selectedSubject
    ? (dashboardPreferencesBySubject[selectedSubject.patient_id] ?? null)
    : null;
  const aiCapability =
    selectedIsOwner && selectedSubject
      ? (aiCapabilityBySubject[selectedSubject.patient_id] ?? null)
      : null;
  const aiHistoryState =
    selectedIsOwner && selectedSubject
      ? (aiHistoryStateBySubject[selectedSubject.patient_id] ?? {
          ...EMPTY_AI_HISTORY_STATE,
          loading: true,
        })
      : EMPTY_AI_HISTORY_STATE;
  const aiHistory = aiHistoryState.items;
  const aiHistoryLoading = aiHistoryState.loading;

  const loadMoreAiHistory = (): Promise<void> => {
    if (!selectedIsOwner || !selectedSubject) {
      return Promise.reject(new Error('AI history scope is not available'));
    }
    const patientId = selectedSubject.patient_id;
    const current =
      aiHistoryStateBySubject[patientId] ?? EMPTY_AI_HISTORY_STATE;
    if (
      current.loading ||
      current.loadingMore ||
      current.items.length >= current.total
    ) {
      return Promise.resolve();
    }
    return loadAiHistoryPage(patientId, current.items.length);
  };

  const retryAiHistory = (): Promise<void> => {
    if (!selectedIsOwner || !selectedSubject) {
      return Promise.reject(new Error('AI history scope is not available'));
    }
    const patientId = selectedSubject.patient_id;
    const current =
      aiHistoryStateBySubject[patientId] ?? EMPTY_AI_HISTORY_STATE;
    return loadAiHistoryPage(patientId, current.failedOffset ?? 0);
  };

  const askAi = async (
    request: HealthAiQuestionInput
  ): Promise<HealthAiQuestionResponse> => {
    if (!selectedIsOwner || !selectedSubject || !selectedSnapshotReady) {
      throw new Error('AI question scope is not available');
    }
    const patientId = selectedSubject.patient_id;
    const idempotency = await acquireHealthAiIdempotency(
      user?.id ?? 0,
      patientId,
      request
    );

    let response: HealthAiQuestionResponse;
    try {
      response = await healthAiApi.askQuestion(
        patientId,
        request,
        idempotency.key
      );
      await completeHealthAiIdempotency(idempotency);
    } catch (error) {
      if (!shouldRetainHealthAiIdempotency(error)) {
        await completeHealthAiIdempotency(idempotency);
      }
      throw error;
    }

    const summary: HealthAiAnswerSummary = {
      answer_id: response.answer_id,
      request_id: response.request_id,
      patient_id: response.patient_id,
      question_id: response.question_id,
      question: response.question,
      range: response.scope.range,
      generated_at: response.generated_at,
      data_cutoff: response.scope.data_cutoff,
      provider: response.processing.provider,
      model: response.processing.model,
      test_mode: response.processing.test_mode,
      record_count: response.scope.record_count,
    };
    setAiHistoryStateBySubject(current => {
      const previous = current[patientId] ?? EMPTY_AI_HISTORY_STATE;
      const alreadyPresent = previous.items.some(
        item =>
          item.answer_id === summary.answer_id ||
          item.request_id === summary.request_id
      );
      return {
        ...current,
        [patientId]: {
          ...previous,
          items: [
            summary,
            ...previous.items.filter(
              item =>
                item.answer_id !== summary.answer_id &&
                item.request_id !== summary.request_id
            ),
          ],
          total: alreadyPresent ? previous.total : previous.total + 1,
          error: '',
          failedOffset: null,
        },
      };
    });
    return response;
  };

  const openAiHistory = (answerId: number) => {
    if (!selectedIsOwner || !selectedSubject) {
      return Promise.reject(new Error('AI history scope is not available'));
    }
    const controller = new AbortController();
    return healthAiApi.getAnswer(
      selectedSubject.patient_id,
      answerId,
      controller.signal
    );
  };

  const deleteAiHistory = async (answerId: number) => {
    if (!selectedIsOwner || !selectedSubject) {
      throw new Error('AI history scope is not available');
    }
    const patientId = selectedSubject.patient_id;
    await healthAiApi.deleteAnswer(patientId, answerId);
    setAiHistoryStateBySubject(current => {
      const previous = current[patientId] ?? EMPTY_AI_HISTORY_STATE;
      const items = previous.items.filter(item => item.answer_id !== answerId);
      return {
        ...current,
        [patientId]: {
          ...previous,
          items,
          total:
            items.length === previous.items.length
              ? previous.total
              : Math.max(0, previous.total - 1),
        },
      };
    });
  };

  const updateDashboardPreferences = (
    nextPreferences: HouseholdHealthDashboardPreferences
  ) => {
    if (!selectedSubject) return;
    const patientId = selectedSubject.patient_id;
    dashboardPreferenceRevisions.current[patientId] =
      (dashboardPreferenceRevisions.current[patientId] ?? 0) + 1;
    setDashboardPreferencesBySubject(current => ({
      ...current,
      [patientId]: nextPreferences,
    }));

    const previous =
      dashboardPreferenceSaveQueues.current.get(patientId) ?? Promise.resolve();
    const request = previous
      .catch(() => undefined)
      .then(async () => {
        await archiveCircleApi.updateDashboardPreferences(patientId, {
          pinned_metric_ids: nextPreferences.pinnedMetricIds,
          ranges_by_metric_id: nextPreferences.rangesByMetricId,
        });
      });
    dashboardPreferenceSaveQueues.current.set(patientId, request);
    void request
      .catch(error => {
        logger.error('household_health_dashboard_preferences_save_error', {
          component: 'HouseholdHealthHome',
          patientId,
          error: error instanceof Error ? error.message : String(error),
        });
        notifications.show({
          color: 'yellow',
          title: '显示偏好暂未同步',
          message: '本次页面内选择仍然有效，稍后可再次调整以重试同步。',
        });
      })
      .finally(() => {
        if (dashboardPreferenceSaveQueues.current.get(patientId) === request) {
          dashboardPreferenceSaveQueues.current.delete(patientId);
        }
      });
  };

  const openDetail = (view: 'metrics' | 'sources' | 'exams' | 'quality') => {
    navigate(`/health-insights?view=${view}`);
  };

  const refreshAfterProcessing = () => {
    if (!processingChanged) return;
    setProcessingChanged(false);
    setReloadToken(value => value + 1);
  };

  const closeParseTask = () => {
    setSelectedParseTask(null);
    refreshAfterProcessing();
  };

  const closeReviewBatch = () => {
    setSelectedReviewBatch(null);
    refreshAfterProcessing();
  };

  const openReviewBatch = async (batchId: number) => {
    const batch = await healthImportApi.getBatch(batchId);
    setSelectedParseTask(null);
    setSelectedReviewBatch(batch);
  };

  const openReportProcessing = async (report: HouseholdHealthReport) => {
    try {
      if (report.processingAction === 'view_metrics') {
        openDetail('metrics');
        return;
      }
      if (
        (report.processingAction === 'review_batch' ||
          report.processingAction === 'view_history') &&
        report.importBatchId
      ) {
        await openReviewBatch(report.importBatchId);
        return;
      }
      if (report.parseTaskId) {
        setSelectedParseTask(
          await healthImportApi.getParseTask(report.parseTaskId)
        );
        return;
      }
      const task = await healthImportApi.startParseTask(
        report.sourceDocumentId
      );
      setProcessingChanged(true);
      setSelectedParseTask(task);
    } catch (error) {
      logger.error('household_health_report_processing_open_error', {
        component: 'HouseholdHealthHome',
        patientId: selectedSubject?.patient_id,
        sourceDocumentId: report.sourceDocumentId,
        processingAction: report.processingAction,
        error: error instanceof Error ? error.message : String(error),
      });
      notifications.show({
        color: 'red',
        title: '暂时无法继续处理',
        message: '报告原件仍已保留，请稍后重试或打开完整档案处理。',
      });
    }
  };

  const closeUpload = () => {
    setUploadOpen(false);
    if (uploadChanged) {
      setUploadChanged(false);
      setReloadToken(value => value + 1);
    }
  };

  return (
    <>
      <HouseholdHealthPrototype
        page={activePage}
        onPageChange={changePage}
        experience={experience}
        loading={patientLoading || directoryLoading || selectedSnapshotLoading}
        dashboardPreferences={dashboardPreferences}
        aiCapability={aiCapability}
        onDashboardPreferencesChange={updateDashboardPreferences}
        onMetricRevisionSaved={() => setReloadToken(value => value + 1)}
        onSubjectChange={setSelectedSubjectId}
        onUpload={() => {
          if (selectedIsOwner && selectedSubject) setUploadOpen(true);
        }}
        onExport={
          selectedIsOwner && selectedSnapshotReady
            ? () => navigate('/health-archive-export')
            : undefined
        }
        onOpenPrivacyAccess={() => navigate('/privacy-access')}
        onOpenAccountSettings={() => navigate('/settings')}
        onDownloadReport={sourceDocumentId => {
          if (!selectedIsOwner || !selectedSnapshotReady) return;
          const report = snapshot.reports.find(
            item => item.sourceDocumentId === sourceDocumentId
          );
          void healthImportApi
            .downloadSourceDocument(sourceDocumentId)
            .then(blob =>
              downloadBlob(
                blob,
                report?.originalFilename || `health-source-${sourceDocumentId}`
              )
            )
            .catch(error => {
              logger.error('household_health_source_download_error', {
                component: 'HouseholdHealthHome',
                patientId: selectedSubject?.patient_id,
                sourceDocumentId,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }}
        onPreviewReport={
          selectedIsOwner && selectedSnapshotReady
            ? sourceDocumentId =>
                healthImportApi.previewSourceDocument(sourceDocumentId)
            : undefined
        }
        onParseReport={
          selectedIsOwner && selectedSnapshotReady
            ? sourceDocumentId => {
                const report = snapshot.reports.find(
                  item => item.sourceDocumentId === sourceDocumentId
                );
                if (report) void openReportProcessing(report);
              }
            : undefined
        }
        onOpenDetails={
          selectedIsOwner && selectedSnapshotReady ? openDetail : undefined
        }
        onAskAi={selectedIsOwner && selectedSnapshotReady ? askAi : undefined}
        aiHistory={aiHistory}
        aiHistoryLoading={aiHistoryLoading}
        aiHistoryLoadingMore={aiHistoryState.loadingMore}
        aiHistoryTotal={aiHistoryState.total}
        aiHistoryError={aiHistoryState.error}
        onLoadMoreAiHistory={selectedIsOwner ? loadMoreAiHistory : undefined}
        onRetryAiHistory={selectedIsOwner ? retryAiHistory : undefined}
        onOpenAiHistory={selectedIsOwner ? openAiHistory : undefined}
        onDeleteAiHistory={selectedIsOwner ? deleteAiHistory : undefined}
        onRetry={() => setReloadToken(value => value + 1)}
      />
      {uploadOpen && selectedIsOwner && selectedSubject ? (
        <HouseholdReportUploadModal
          patientId={selectedSubject.patient_id}
          subjectLabel={selectedSubject.display_name}
          onClose={closeUpload}
          onSaved={() => setUploadChanged(true)}
          startParseTask={sourceDocumentId =>
            healthImportApi.startParseTask(sourceDocumentId)
          }
        />
      ) : null}
      {selectedIsOwner ? (
        <>
          <HealthSourceParseModal
            task={selectedParseTask}
            opened={selectedParseTask !== null}
            onClose={closeParseTask}
            onChanged={task => {
              setProcessingChanged(true);
              setSelectedParseTask(task);
            }}
            onOpenBatch={openReviewBatch}
            onManualEntry={() => {
              setSelectedParseTask(null);
              refreshAfterProcessing();
              openDetail('sources');
            }}
          />
          <HealthImportReviewModal
            batch={selectedReviewBatch}
            opened={selectedReviewBatch !== null}
            onClose={closeReviewBatch}
            onChanged={batch => {
              setProcessingChanged(true);
              setSelectedReviewBatch(batch);
            }}
          />
        </>
      ) : null}
    </>
  );
};

export default HouseholdHealthHome;
