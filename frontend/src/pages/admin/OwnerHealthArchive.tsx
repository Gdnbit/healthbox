/* eslint-disable i18next/no-literal-string -- Chinese-first sole-admin archive */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  emptyHouseholdHealthSnapshot,
  loadHouseholdHealthSnapshot,
  type HouseholdHealthDataDependencies,
} from '../../features/householdHealth/householdHealthData';
import type {
  HouseholdHealthExperienceModel,
  HouseholdHealthHandoffRequest,
  HouseholdHealthSnapshot,
  HouseholdHealthSubject,
} from '../../features/householdHealth/types';
import { adminApiService } from '../../services/api/adminApi';
import healthImportApi from '../../services/api/healthImportApi';
import { labTestComponentApi } from '../../services/api/labTestComponentApi';
import logger from '../../services/logger';
import { vitalsService } from '../../services/medical/vitalsService';
import { downloadBlob } from '../../utils/downloadUtils';
import HouseholdHealthPrototype from '../prototype/HouseholdHealthPrototype';

const OWNER_ACCESS = 'global_read' as const;
const OWNER_ACCESS_REASON = '查看家庭健康档案';
const handoffReason = (kind: HouseholdHealthHandoffRequest['kind']): string =>
  ({
    clipboard: '复制家庭健康面板摘要',
    csv: '导出家庭健康面板摘要',
    print: '打印家庭健康面板摘要',
  })[kind];

interface OwnerDirectorySubject {
  id: number;
  first_name: string;
  last_name: string;
}

const toSubject = (subject: OwnerDirectorySubject): HouseholdHealthSubject => ({
  id: subject.id,
  label:
    [subject.first_name, subject.last_name].filter(Boolean).join('').trim() ||
    '未命名成员',
  relationshipLabel: '管理员只读',
});

const ownerReadDependencies: HouseholdHealthDataDependencies = {
  getVitals: (patientId, params) =>
    vitalsService.getVitals({
      ...params,
      patient_id: patientId,
      owner_access: OWNER_ACCESS,
      owner_access_reason: OWNER_ACCESS_REASON,
    }),
  getCatalog: (patientId, options, signal) =>
    labTestComponentApi.getComponentCatalog(
      patientId,
      {
        ...options,
        ownerAccess: OWNER_ACCESS,
        ownerAccessReason: OWNER_ACCESS_REASON,
      },
      signal
    ),
  getTrend: (patientId, testName, options, signal) =>
    labTestComponentApi.getTrendsByPatientAndTest(
      patientId,
      testName,
      {
        ...options,
        ownerAccess: OWNER_ACCESS,
        ownerAccessReason: OWNER_ACCESS_REASON,
      },
      signal
    ),
  getSourceDocuments: (patientId, signal) =>
    healthImportApi.listSourceDocuments(patientId, signal, false, {
      capability: OWNER_ACCESS,
      reason: OWNER_ACCESS_REASON,
    }),
};

const OwnerHealthArchive = () => {
  const navigate = useNavigate();
  const { patientId: patientIdParam } = useParams<{ patientId: string }>();
  const patientId = Number(patientIdParam);
  const [subjects, setSubjects] = useState<HouseholdHealthSubject[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState('');
  const [snapshot, setSnapshot] = useState<HouseholdHealthSnapshot>(() =>
    emptyHouseholdHealthSnapshot('ready')
  );
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setDirectoryLoading(true);
    setDirectoryError('');

    void adminApiService
      .getOwnerSubjects()
      .then(response => {
        if (!active) return;
        const payload = response?.data || response;
        setSubjects(
          (payload?.subjects || []).map((subject: OwnerDirectorySubject) =>
            toSubject(subject)
          )
        );
      })
      .catch(error => {
        if (!active) return;
        logger.error('owner_health_archive_directory_error', {
          message: 'Failed to load owner subject directory',
          error: error instanceof Error ? error.message : String(error),
        });
        setDirectoryError(
          '无法载入管理员可查看的成员目录。请确认当前只有一个启用中的管理员账号。'
        );
      })
      .finally(() => {
        if (active) setDirectoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const subject = useMemo(
    () => subjects.find(item => item.id === patientId) || null,
    [patientId, subjects]
  );

  useEffect(() => {
    if (directoryLoading || directoryError || !subject) return;

    const controller = new AbortController();
    setRecordsLoading(true);
    setSnapshot(emptyHouseholdHealthSnapshot('ready'));
    void loadHouseholdHealthSnapshot(
      subject.id,
      ownerReadDependencies,
      controller.signal
    )
      .then(nextSnapshot => {
        if (!controller.signal.aborted) setSnapshot(nextSnapshot);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('owner_health_archive_load_error', {
          message: 'Failed to load owner health archive',
          patientId: subject.id,
          error: error instanceof Error ? error.message : String(error),
        });
        setSnapshot({
          ...emptyHouseholdHealthSnapshot('ready'),
          errors: [
            {
              section: 'vitals',
              message: '只读档案暂时无法载入，请稍后重试。',
            },
          ],
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecordsLoading(false);
      });

    return () => controller.abort();
  }, [directoryError, directoryLoading, reloadToken, subject]);

  if (directoryLoading) {
    return (
      <div className="health-prototype">
        <div className="hhp-empty-state">正在载入只读成员目录…</div>
      </div>
    );
  }

  if (directoryError || !Number.isInteger(patientId) || !subject) {
    return (
      <div className="health-prototype">
        <div className="hhp-shell" style={{ display: 'grid', minHeight: 360 }}>
          <div className="hhp-empty-state" style={{ alignSelf: 'center' }}>
            <strong>{directoryError || '未找到可只读查看的成员档案。'}</strong>
            <button type="button" onClick={() => navigate('/admin/users')}>
              返回用户管理
            </button>
          </div>
        </div>
      </div>
    );
  }

  const experience: HouseholdHealthExperienceModel = {
    subject,
    subjects,
    snapshot,
    capabilities: {
      canUpload: false,
      canExport: true,
      canUseAi: false,
      canViewSources: true,
      canDownloadSources: true,
      canPreviewSources: true,
      canCopyForAi: false,
      canShare: true,
    },
    accessNotice:
      '管理员只读查看：本次跨成员档案访问已记录。原件预览、下载、复制、CSV 和打印会分别记录；不能上传、修改、批量导出完整服务器档案或交给 AI。',
    mode: 'live',
  };

  return (
    <HouseholdHealthPrototype
      experience={experience}
      loading={recordsLoading}
      onSubjectChange={nextPatientId =>
        navigate(`/admin/owner-archive/${nextPatientId}`)
      }
      onDownloadReport={sourceDocumentId => {
        const report = snapshot.reports.find(
          item => item.sourceDocumentId === sourceDocumentId
        );
        void healthImportApi
          .downloadSourceDocument(sourceDocumentId, {
            capability: OWNER_ACCESS,
            reason: '下载家庭报告原件',
          })
          .then(blob =>
            downloadBlob(
              blob,
              report?.originalFilename || `health-source-${sourceDocumentId}`
            )
          )
          .catch(error => {
            logger.error('owner_health_source_download_error', {
              message: 'Failed to download owner health source document',
              patientId: subject.id,
              sourceDocumentId,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }}
      onPreviewReport={sourceDocumentId =>
        healthImportApi.previewSourceDocument(sourceDocumentId, {
          capability: OWNER_ACCESS,
          reason: '预览家庭报告原件',
        })
      }
      onPrepareHandoff={async handoff => {
        await adminApiService.authorizeOwnerDashboardHandoff(subject.id, {
          capability: OWNER_ACCESS,
          reason: handoffReason(handoff.kind),
          handoffKind: handoff.kind,
          scope: handoff.scope,
          includeReports: handoff.includeReports,
          metricCount: handoff.metricCount,
          reportCount: handoff.reportCount,
        });
      }}
      onRetry={() => setReloadToken(value => value + 1)}
    />
  );
};

export default OwnerHealthArchive;
