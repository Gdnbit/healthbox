/* eslint-disable i18next/no-literal-string -- Chinese-first household health experience */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  IconAdjustments,
  IconAlertTriangle,
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconBook2,
  IconCalendar,
  IconChartLine,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconClipboardText,
  IconCopy,
  IconDatabase,
  IconDownload,
  IconEye,
  IconFileText,
  IconFileSearch,
  IconFileTypePdf,
  IconHome,
  IconHistory,
  IconInfoCircle,
  IconLock,
  IconMessageQuestion,
  IconPrinter,
  IconSearch,
  IconSettings,
  IconShare3,
  IconShieldCheck,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  HouseholdHealthExperienceModel,
  HouseholdHealthHandoffKind,
  HouseholdHealthHandoffRequest,
  HouseholdHealthMetric,
  HouseholdHealthPoint,
  HouseholdHealthReport,
} from '../../features/householdHealth/types';
import {
  buildHouseholdTrendView,
  formatHouseholdTrendAxisDate,
  getDefaultPinnedHouseholdMetricIds,
  HOUSEHOLD_HEALTH_TREND_RANGE_OPTIONS,
  normalizePinnedHouseholdMetricIds,
  toHouseholdTrendTimestamp,
  type HouseholdHealthDashboardPreferences,
  type HouseholdHealthTrendDensity,
  type HouseholdHealthTrendRange,
  type HouseholdHealthTrendView,
} from '../../features/householdHealth/householdHealthTrend';
import {
  buildHouseholdHealthExportFilename,
  buildHouseholdHealthExportModel,
  renderHouseholdHealthExportCsv,
  renderHouseholdHealthExportText,
  type HouseholdHealthExportScope,
} from '../../features/householdHealth/householdHealthExport';
import {
  buildHouseholdAiHandoff,
  renderHouseholdAiHandoffText,
  type HouseholdAiHandoffModel,
  type HouseholdAiQuestionId,
  type HouseholdAiRange,
} from '../../features/householdHealth/householdHealthAiHandoff';
import {
  buildHouseholdReportFilterOptions,
  filterHouseholdHealthReports,
} from '../../features/householdHealth/householdReportFilters';
import HouseholdReportUploadModal from '../../features/householdHealth/HouseholdReportUploadModal';
import HouseholdSourcePreviewModal, {
  canPreviewHouseholdSource,
} from '../../features/householdHealth/HouseholdSourcePreviewModal';
import HealthImportReviewModal from '../../components/health/HealthImportReviewModal';
import HealthFormalMetricRevisionModal from '../../components/health/HealthFormalMetricRevisionModal';
import type {
  HealthAiAnswerItem,
  HealthAiAnswerSummary,
  HealthAiCapability,
  HealthAiCitation,
  HealthAiQuestionInput,
  HealthAiQuestionResponse,
} from '../../services/api/healthAiApi';
import HealthSourceParseModal from '../../components/health/HealthSourceParseModal';
import ScreeningKnowledgePage from './ScreeningKnowledgePage';
import type {
  HealthImportBatch,
  HealthFormalMetricRevisionHistory,
  HealthFormalMetricRevisionRequest,
  HealthParserReadiness,
  HealthSourceParseTask,
  HealthSourceSimilarityRelation,
  HealthSourceUploadBatch,
} from '../../services/api/healthImportApi';
import { downloadBlob } from '../../utils/downloadUtils';
import type { HouseholdPageKey } from '../../config/productRoutes';
import './HouseholdHealthPrototype.css';

export type PageKey = HouseholdPageKey;
type ArchiveTab = 'reports' | 'metrics' | 'comparison' | 'quality';

const PAGE_LABELS: Record<PageKey, string> = {
  home: '首页',
  archive: '健康档案',
  assistant: 'AI 助手',
  export: '导出',
  more: '更多',
  guidance: '身体与筛查资料',
};

const DEMO_SIMILARITY_RELATION: HealthSourceSimilarityRelation = {
  id: 2026072801,
  patient_id: 1,
  source_document_id: 2026072802,
  source_display_name: '年度体检报告 · 第 2 张',
  related_source_document_id: 2026072803,
  related_display_name: '年度体检报告 · 第 3 张',
  relation_type: 'partial_overlap',
  confidence: 0.88,
  algorithm_version: 'source-image-similarity@1.0.0',
  evidence: {
    matched_region_ratio: 0.61,
    source_unique_ratio: 0.39,
    related_unique_ratio: 0.39,
    orientation: 'vertical',
    explanation_code: 'shared_vertical_bands',
    band_offset: 2,
  },
  review_status: 'pending',
  created_at: '2026-07-28T00:00:00Z',
  updated_at: '2026-07-28T00:00:00Z',
};

const sha256DemoText = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0')
  ).join('');
};

const createDemoRecoveryBatch = async (
  status: HealthSourceUploadBatch['status'] = 'partial'
): Promise<HealthSourceUploadBatch> => {
  const completed = status === 'completed';
  const cancelled = status === 'cancelled';
  return {
    id: 2026072804,
    patient_id: 1,
    created_by_user_id: 1,
    idempotency_key: 'synthetic-upload-recovery',
    manifest_sha256: 'a'.repeat(64),
    document_type: 'checkup',
    report_date: '2026-07-20',
    facility: '合成体检中心',
    status,
    expected_file_count: 30,
    expected_total_bytes: 210,
    created_at: '2026-07-28T00:00:00Z',
    completed_at: completed ? '2026-07-28T00:04:00Z' : null,
    cancelled_at: cancelled ? '2026-07-28T00:04:00Z' : null,
    updated_at:
      completed || cancelled ? '2026-07-28T00:04:00Z' : '2026-07-28T00:02:00Z',
    items: await Promise.all(
      Array.from({ length: 30 }, async (_, index) => {
        const sequence = index + 1;
        const preserved = index < 12;
        return {
          id: 2026072900 + index,
          batch_id: 2026072804,
          client_item_id: `synthetic-recovery-${sequence}`,
          sequence,
          original_filename: `report-page-${String(sequence).padStart(2, '0')}.pdf`,
          mime_type: 'application/pdf',
          size_bytes: 7,
          client_sha256: await sha256DemoText(
            `demo-${String(sequence).padStart(2, '0')}`
          ),
          status: completed
            ? ('uploaded' as const)
            : cancelled && !preserved
              ? ('cancelled' as const)
              : preserved
                ? ('uploaded' as const)
                : ('failed' as const),
          source_document_id:
            completed || preserved ? 2026073000 + index : null,
          attempt_count: preserved ? 1 : 2,
          last_error_code:
            completed || preserved || cancelled ? null : 'network_interrupted',
          near_duplicate_candidates: [],
          partial_overlap_candidates: [],
          created_at: '2026-07-28T00:00:00Z',
          updated_at:
            completed || cancelled
              ? '2026-07-28T00:04:00Z'
              : '2026-07-28T00:02:00Z',
        };
      })
    ),
  };
};

const createDemoSimilarityThumbnail = (sourceDocumentId: number): Blob => {
  const isFirst =
    sourceDocumentId === DEMO_SIMILARITY_RELATION.source_document_id;
  const title = isFirst ? '体检报告 · 第 2 张' : '体检报告 · 第 3 张';
  const rows = isFirst
    ? ['血常规摘要', '肝功能指标', '血脂指标', '共同区域']
    : ['共同区域', '血脂指标', '肾功能指标', '检查结论'];
  const rowMarkup = rows
    .map(
      (row, index) =>
        `<rect x="34" y="${90 + index * 48}" width="252" height="29" rx="8" fill="${
          row === '共同区域' ? '#d7efe6' : '#edf2f1'
        }"/><text x="48" y="${110 + index * 48}" font-size="13" fill="#38514b">${row}</text>`
    )
    .join('');
  return new Blob(
    [
      `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="360" viewBox="0 0 320 360">
        <rect width="320" height="360" rx="18" fill="#f7faf9"/>
        <rect x="20" y="18" width="280" height="324" rx="14" fill="#ffffff" stroke="#d9e5e1"/>
        <text x="34" y="56" font-size="17" font-weight="700" fill="#173f35">${title}</text>
        <text x="34" y="76" font-size="11" fill="#6a7e78">仅用于原型验收的合成图片</text>
        ${rowMarkup}
        <path d="M34 302 H286" stroke="#d9e5e1"/>
        <text x="34" y="326" font-size="11" fill="#748781">两份原件均完整保留</text>
      </svg>`,
    ],
    { type: 'image/svg+xml' }
  );
};

const NAV_ITEMS = [
  { key: 'home' as const, label: '首页', mobileLabel: '首页', icon: IconHome },
  {
    key: 'archive' as const,
    label: '健康档案',
    mobileLabel: '档案',
    icon: IconArchive,
  },
  {
    key: 'assistant' as const,
    label: 'AI 助手',
    mobileLabel: 'AI 助手',
    icon: IconSparkles,
  },
  {
    key: 'export' as const,
    label: '导出',
    mobileLabel: '导出',
    icon: IconDownload,
  },
  { key: 'more' as const, label: '更多', mobileLabel: '我的', icon: IconUser },
];

const isNavigationItemActive = (
  activePage: PageKey,
  itemKey: (typeof NAV_ITEMS)[number]['key']
) =>
  activePage === itemKey || (activePage === 'guidance' && itemKey === 'more');

const DEMO_METRICS: HouseholdHealthMetric[] = [
  {
    id: 'demo:blood-pressure',
    kind: 'vital',
    label: '血压',
    unit: 'mmHg',
    latestStatus: null,
    points: [
      {
        id: 'bp-1',
        date: '2021-06-12',
        value: 122,
        secondaryValue: 80,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'bp-2',
        date: '2022-08-20',
        value: 126,
        secondaryValue: 82,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'bp-3',
        date: '2023-02-11',
        value: 131,
        secondaryValue: 84,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'bp-4',
        date: '2023-09-18',
        value: 127,
        secondaryValue: 82,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'bp-5',
        date: '2025-04-30',
        value: 129,
        secondaryValue: 82,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'bp-6',
        date: '2026-06-18',
        value: 124,
        secondaryValue: 80,
        sourceDocumentId: null,
        status: null,
      },
    ],
  },
  {
    id: 'demo:weight',
    kind: 'vital',
    label: '体重',
    unit: 'kg',
    latestStatus: null,
    points: [
      {
        id: 'weight-1',
        date: '2021-06-12',
        value: 69.4,
        secondaryValue: null,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'weight-2',
        date: '2022-11-02',
        value: 70.1,
        secondaryValue: null,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'weight-3',
        date: '2024-03-06',
        value: 68.8,
        secondaryValue: null,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'weight-4',
        date: '2025-01-15',
        value: 68.2,
        secondaryValue: null,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'weight-5',
        date: '2025-09-10',
        value: 67.6,
        secondaryValue: null,
        sourceDocumentId: null,
        status: null,
      },
      {
        id: 'weight-6',
        date: '2026-06-18',
        value: 68.1,
        secondaryValue: null,
        sourceDocumentId: null,
        status: null,
      },
    ],
  },
  {
    id: 'demo:glucose',
    kind: 'lab',
    label: '空腹血糖',
    unit: 'mmol/L',
    latestStatus: 'normal',
    points: [
      {
        id: 'glucose-1',
        componentId: 301,
        date: '2021',
        value: 4.9,
        secondaryValue: null,
        sourceDocumentId: null,
        status: 'normal',
      },
      {
        id: 'glucose-2',
        componentId: 302,
        date: '2022',
        value: 5.1,
        secondaryValue: null,
        sourceDocumentId: null,
        status: 'normal',
      },
      {
        id: 'glucose-3',
        componentId: 303,
        date: '2023',
        value: 5,
        secondaryValue: null,
        sourceDocumentId: null,
        status: 'normal',
      },
      {
        id: 'glucose-4',
        componentId: 304,
        date: '2024',
        value: 5.2,
        secondaryValue: null,
        sourceDocumentId: null,
        status: 'normal',
      },
      {
        id: 'glucose-5',
        componentId: 305,
        date: '2025',
        value: 5.1,
        secondaryValue: null,
        sourceDocumentId: null,
        status: 'normal',
      },
      {
        id: 'glucose-6',
        componentId: 306,
        date: '2026',
        value: 5,
        secondaryValue: null,
        sourceDocumentId: null,
        status: 'normal',
      },
    ],
  },
];

const createDemoFormalMetricHistory = (
  componentId: number
): HealthFormalMetricRevisionHistory => {
  const match = DEMO_METRICS.flatMap(metric =>
    metric.points.map(point => ({ metric, point }))
  ).find(item => item.point.componentId === componentId);
  if (!match) throw new Error('找不到这条虚构验收记录');
  const revisionId = componentId * 100 + 1;
  return {
    contract_version: 'household-formal-metric-revision@1.0.0',
    component_id: componentId,
    patient_id: 1,
    lab_result_id: componentId,
    test_name: match.metric.label,
    canonical_test_name: match.metric.label,
    test_code: null,
    observed_date: match.point.date,
    source_document_id: match.point.sourceDocumentId,
    source_page: null,
    source_locator: null,
    import_batch_id: 91,
    current_revision_id: revisionId,
    revisions: [
      {
        id: revisionId,
        component_id: componentId,
        patient_id: 1,
        version: 1,
        action: 'created',
        supersedes_revision_id: null,
        reason: null,
        result_type: 'quantitative',
        numeric_value: match.point.value,
        qualitative_value: null,
        textual_value: null,
        unit: match.metric.unit,
        ref_range_min: null,
        ref_range_max: null,
        ref_range_text: null,
        result_status: match.point.status,
        created_by_user_id: 1,
        created_at: '2026-06-18T09:00:00Z',
      },
    ],
  };
};

const LIVE_AI_QUESTIONS: Array<{
  id: HouseholdAiQuestionId;
  label: string;
  prompt: string;
  icon: typeof IconChartLine;
  disabled?: boolean;
}> = [
  {
    id: 'recent_changes',
    label: '最近有哪些变化？',
    prompt: '最近有哪些变化？',
    icon: IconChartLine,
  },
  {
    id: 'screening_schedule',
    label: '哪些检查可能需要安排？',
    prompt: '哪些检查可能需要安排？',
    icon: IconCalendar,
    disabled: true,
  },
  {
    id: 'doctor_questions',
    label: '帮我整理就医前问题',
    prompt: '请根据这些记录，帮我整理一份与医生沟通的问题清单。',
    icon: IconMessageQuestion,
  },
  {
    id: 'term_or_custom',
    label: '解释指标或术语',
    prompt: '请用通俗语言解释这个指标或术语：',
    icon: IconFileText,
  },
];

const getApiErrorCode = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
};

const ARCHIVE_TABS = [
  { key: 'reports' as const, label: '报告原件' },
  { key: 'metrics' as const, label: '指标与趋势' },
  { key: 'comparison' as const, label: '体检对比' },
  { key: 'quality' as const, label: '数据质量' },
];

const DEMO_REPORTS = [
  {
    id: 'demo-report-1',
    sourceDocumentId: 1,
    title: '年度体检报告',
    originalFilename: 'annual-checkup-2026.pdf',
    date: '2026-06-18',
    facility: '城市健康体检中心',
    typeLabel: '体检报告',
    statusLabel: '已入库',
    processingState: 'committed' as const,
    processingHint: '已写入正式指标，可在趋势面板中查看',
    processingAction: 'view_metrics' as const,
    processingActionLabel: '查看指标',
    parseTaskId: 81,
    importBatchId: 71,
    sizeLabel: '8 页',
    mimeType: 'application/pdf',
  },
  {
    id: 'demo-report-2',
    sourceDocumentId: 2,
    title: '血常规与生化检查',
    originalFilename: 'blood-tests-2025.pdf',
    date: '2025-05-22',
    facility: '市第一医院',
    typeLabel: '检验报告',
    statusLabel: '待复核',
    processingState: 'review_required' as const,
    processingHint: '请核对解析出的指标，确认后才能写入档案',
    processingAction: 'review_batch' as const,
    processingActionLabel: '继续复核',
    parseTaskId: 82,
    importBatchId: 72,
    sizeLabel: '4 页',
    mimeType: 'application/pdf',
  },
  {
    id: 'demo-report-3',
    sourceDocumentId: 3,
    title: '基础状态记录',
    originalFilename: 'baseline-status-2024.pdf',
    date: '2024-11-03',
    facility: '本人补充',
    typeLabel: '健康资料',
    statusLabel: '原件已保存',
    processingState: 'saved' as const,
    processingHint: '源文件已安全留存，尚未开始解析',
    processingAction: 'start_parse' as const,
    processingActionLabel: '本地解析',
    parseTaskId: null,
    importBatchId: null,
    sizeLabel: '7 页',
    mimeType: 'application/pdf',
  },
];

const loadDemoSourcePreview = (): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Demo preview canvas is unavailable'));
      return;
    }

    context.fillStyle = '#edf2f1';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(55, 40, 790, 1120);
    context.fillStyle = '#1f5d58';
    context.fillRect(55, 40, 790, 16);
    context.font = '700 38px "Microsoft YaHei", "PingFang SC", sans-serif';
    context.fillText('体检报告原件预览', 110, 135);
    context.fillStyle = '#63726f';
    context.font = '500 22px "Microsoft YaHei", "PingFang SC", sans-serif';
    context.fillText('虚构资料 · 仅用于界面演示', 110, 180);

    const sections = [
      { title: '基本信息', y: 270, rows: 3 },
      { title: '检查项目', y: 500, rows: 5 },
      { title: '机构说明', y: 850, rows: 3 },
    ];
    sections.forEach(section => {
      context.fillStyle = '#dff0ed';
      context.fillRect(110, section.y, 680, 52);
      context.fillStyle = '#1f5d58';
      context.font = '700 24px "Microsoft YaHei", "PingFang SC", sans-serif';
      context.fillText(section.title, 132, section.y + 35);
      for (let row = 0; row < section.rows; row += 1) {
        const rowY = section.y + 82 + row * 44;
        context.fillStyle = row % 2 === 0 ? '#eef2f1' : '#e3e9e7';
        context.fillRect(120, rowY, 620 - row * 35, 14);
      }
    });

    context.fillStyle = '#74817f';
    context.font = '500 20px "Microsoft YaHei", "PingFang SC", sans-serif';
    context.fillText('正式使用时，这里显示用户上传并留存的原件。', 150, 1100);
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Demo preview image could not be created'));
    }, 'image/png');
  });

const createDemoParseTask = (
  sourceDocumentId: number
): HealthSourceParseTask => ({
  id: 81,
  patient_id: 1,
  source_document_id: sourceDocumentId,
  created_by_user_id: 1,
  import_batch_id: 91,
  idempotency_key: 'demo-local-parse-task',
  parser_name: 'local-core-lab',
  parser_version: '1.0.0',
  status: 'succeeded',
  attempt_count: 1,
  summary: {
    candidate_count: 2,
    low_confidence_count: 1,
    unparsed_count: 1,
    ignored_line_count: 8,
    page_count: 7,
    character_count: 1824,
    extraction_method: 'native',
    extraction_confidence: 0.95,
    formal_write_count: 0,
  },
  completed_at: '2026-07-27T07:00:00Z',
  created_at: '2026-07-27T06:59:58Z',
  updated_at: '2026-07-27T07:00:00Z',
});

const DEMO_PARSER_READINESS: HealthParserReadiness = {
  parser_name: 'local-core-lab',
  parser_version: '1.0.0',
  status: 'ready',
  capabilities: {
    digital_pdf: {
      status: 'ready',
      reason_codes: [],
    },
    image_ocr: {
      status: 'ready',
      reason_codes: [],
    },
    scanned_pdf_ocr: {
      status: 'ready',
      reason_codes: [],
    },
    heic_image_ocr: {
      status: 'ready',
      reason_codes: [],
    },
  },
  supported_ocr_languages: ['chi_sim', 'eng'],
  reason_codes: [],
  worker: {
    status: 'running',
    poll_seconds: 5,
    max_tasks_per_cycle: 4,
    last_cycle_at: '2026-07-27T07:00:00Z',
    last_cycle_processed: 1,
    last_recovered_count: 0,
  },
  checked_at: '2026-07-27T07:00:00Z',
};

const createDemoReviewBatch = (
  sourceDocumentId: number
): HealthImportBatch => ({
  id: 91,
  patient_id: 1,
  source_document_id: sourceDocumentId,
  idempotency_key: 'demo-local-review-batch',
  parser_name: 'local-core-lab',
  parser_version: '1.0.0',
  status: 'pending_review',
  summary: {
    total: 2,
    pending: 2,
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    quality_issue_count: 1,
  },
  subject_mismatch_warning: {
    code: 'subject_mismatch_suspected',
    observed_name: '林小',
    confidence: 0.92,
    assessment_version: 'subject-identity-assessment@1.0.0',
    evidence: {
      label: 'patient_name',
      candidate_count: 1,
    },
    confirmation_required: true,
    confirmed_at: null,
  },
  items: [
    {
      id: 101,
      batch_id: 91,
      sequence: 1,
      observed_date: '2024-11-03',
      test_name: '空腹血糖',
      canonical_test_name: '空腹血糖',
      test_code: 'GLU',
      result_type: 'quantitative',
      numeric_value: 5.2,
      unit: 'mmol/L',
      ref_range_min: 3.9,
      ref_range_max: 6.1,
      ref_range_text: '3.9-6.1',
      result_status: 'normal',
      category: 'chemistry',
      source_page: 1,
      source_locator: '提取文本第 6 行',
      raw_text: '空腹血糖 5.2 mmol/L 3.9-6.1 正常',
      confidence: 0.95,
      decision: 'pending',
      validation_issues: [],
    },
    {
      id: 102,
      batch_id: 91,
      sequence: 2,
      observed_date: '2024-11-03',
      test_name: '低密度脂蛋白胆固醇',
      canonical_test_name: '低密度脂蛋白胆固醇',
      test_code: 'LDL-C',
      result_type: 'quantitative',
      numeric_value: 3.8,
      unit: 'mmol/L',
      ref_range_min: 0,
      ref_range_max: 3.4,
      ref_range_text: '0-3.4',
      result_status: 'high',
      category: 'lipids',
      source_page: 1,
      source_locator: '提取文本第 11 行',
      raw_text: '低密度脂蛋白 3.8 mmol/L 0-3.4 偏高',
      confidence: 0.82,
      decision: 'pending',
      validation_issues: ['low_confidence'],
    },
  ],
  created_at: '2026-07-27T07:00:00Z',
});

const DEMO_EXPERIENCE: HouseholdHealthExperienceModel = {
  subject: { id: 1, label: '林晓', relationshipLabel: '我的档案' },
  subjects: [
    { id: 1, label: '林晓', relationshipLabel: '我的档案' },
    { id: 2, label: '王芳', relationshipLabel: '可查看的档案' },
  ],
  snapshot: {
    subjectState: 'ready',
    metrics: DEMO_METRICS,
    reports: DEMO_REPORTS,
    errors: [],
    loadedAt: '2026-06-18T09:00:00Z',
  },
  capabilities: {
    canUpload: true,
    canExport: true,
    canUseAi: true,
    canViewSources: true,
    canReviseMetrics: true,
    canDownloadSources: true,
    canPreviewSources: true,
    canCopyForAi: true,
    canShare: true,
  },
  mode: 'demo',
};

interface HouseholdHealthExperienceActions {
  loading: boolean;
  aiCapability?: HealthAiCapability | null;
  aiHistory?: HealthAiAnswerSummary[];
  aiHistoryLoading?: boolean;
  aiHistoryLoadingMore?: boolean;
  aiHistoryTotal?: number;
  aiHistoryError?: string;
  onSubjectChange?: (_subjectId: number) => void;
  onUpload?: () => void;
  onExport?: () => void;
  onOpenDetails?: (_view: 'metrics' | 'sources' | 'exams' | 'quality') => void;
  onParseReport?: (_sourceDocumentId: number) => void;
  onDownloadReport?: (_sourceDocumentId: number) => void;
  onPreviewReport?: (_sourceDocumentId: number) => Promise<Blob>;
  onPrepareHandoff?: (_request: HouseholdHealthHandoffRequest) => Promise<void>;
  onAskAi?: (
    _request: HealthAiQuestionInput
  ) => Promise<HealthAiQuestionResponse>;
  onOpenAiHistory?: (_answerId: number) => Promise<HealthAiQuestionResponse>;
  onDeleteAiHistory?: (_answerId: number) => Promise<void>;
  onLoadMoreAiHistory?: () => Promise<void>;
  onRetryAiHistory?: () => Promise<void>;
  onOpenAiCitation?: (_metricId: string, _recordId: string) => void;
  onMetricRevisionSaved?: (_history: HealthFormalMetricRevisionHistory) => void;
  loadFormalMetricRevisions?: (
    _componentId: number,
    _signal?: AbortSignal
  ) => Promise<HealthFormalMetricRevisionHistory>;
  createFormalMetricRevision?: (
    _componentId: number,
    _input: HealthFormalMetricRevisionRequest
  ) => Promise<HealthFormalMetricRevisionHistory>;
  onRetry?: () => void;
}

interface HouseholdHealthExperienceContextValue extends HouseholdHealthExperienceActions {
  experience: HouseholdHealthExperienceModel;
  dashboard: HouseholdHealthDashboardPreferences;
  onPinnedMetricsChange: (_metricIds: string[]) => void;
  onTrendRangeChange: (
    _metricId: string,
    _range: HouseholdHealthTrendRange
  ) => void;
  onOpenFullExport?: () => void;
}

const HouseholdHealthExperienceContext =
  createContext<HouseholdHealthExperienceContextValue>({
    experience: DEMO_EXPERIENCE,
    loading: false,
    dashboard: {
      pinnedMetricIds: getDefaultPinnedHouseholdMetricIds(
        DEMO_EXPERIENCE.snapshot.metrics
      ),
      rangesByMetricId: {},
    },
    onPinnedMetricsChange: () => undefined,
    onTrendRangeChange: () => undefined,
  });

const useHouseholdHealthExperience = () =>
  useContext(HouseholdHealthExperienceContext);

export const buildDynamicSyntheticPreviewAnswerItems = (
  citations: HealthAiCitation[]
): HealthAiAnswerItem[] => {
  const byMetric = new Map<string, HealthAiCitation[]>();
  citations.forEach(citation => {
    const group = byMetric.get(citation.metric_id) ?? [];
    group.push(citation);
    byMetric.set(citation.metric_id, group);
  });

  return [...byMetric.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 8)
    .map(([, metricCitations]) => {
      const ordered = [...metricCitations].sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          left.record_id.localeCompare(right.record_id)
      );
      const first = ordered[0];
      const last = ordered.at(-1) ?? first;
      const formatValue = (citation: HealthAiCitation) =>
        `${citation.value}${
          citation.secondary_value === null
            ? ''
            : `/${citation.secondary_value}`
        } ${citation.unit}${citation.status ? `（${citation.status}）` : ''}`;

      if (ordered.length === 1) {
        return {
          text: `${first.label}在 ${first.date} 的所选记录为 ${formatValue(first)}。当前只有一条记录，不能据此描述长期趋势。`,
          citation_ids: [first.citation_id],
        };
      }

      return {
        text: `${first.label}从 ${first.date} 的 ${formatValue(first)}变化到 ${last.date} 的 ${formatValue(last)}。这里只复述所选记录，不判断原因、风险或诊断。`,
        citation_ids: ordered.map(citation => citation.citation_id),
      };
    });
};

function Sidebar({
  activePage,
  onNavigate,
}: {
  activePage: PageKey;
  onNavigate: (_page: PageKey) => void;
}) {
  const { experience } = useHouseholdHealthExperience();
  const items = NAV_ITEMS.filter(
    item =>
      (item.key !== 'assistant' ||
        (experience.capabilities.canUseAi &&
          experience.capabilities.canCopyForAi)) &&
      (item.key !== 'export' || experience.capabilities.canExport)
  );
  return (
    <aside className="hhp-sidebar" aria-label="主要导航">
      <div className="hhp-sidebar-spacer hhp-brand">
        <img src="/healthbox-icon.svg" alt="" width={36} height={36} />
        <span>
          HealthBox
          <small>健康档案盒</small>
        </span>
      </div>
      <nav>
        {items.map(item => {
          const Icon = item.icon;
          const isActive = isNavigationItemActive(activePage, item.key);
          return (
            <button
              key={item.key}
              type="button"
              className={`hhp-nav-item ${
                item.key === 'assistant' ? 'is-ai-entry' : ''
              } ${isActive ? 'is-active' : ''}`}
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={23} stroke={1.7} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileNavigation({
  activePage,
  onNavigate,
}: {
  activePage: PageKey;
  onNavigate: (_page: PageKey) => void;
}) {
  const { experience } = useHouseholdHealthExperience();
  const mobileItems = NAV_ITEMS.filter(
    item =>
      item.key !== 'export' &&
      (item.key !== 'assistant' ||
        (experience.capabilities.canUseAi &&
          experience.capabilities.canCopyForAi))
  );
  return (
    <nav className="hhp-mobile-nav" aria-label="移动端主要导航">
      {mobileItems.map(item => {
        const Icon = item.icon;
        const isActive = isNavigationItemActive(activePage, item.key);
        return (
          <button
            key={item.key}
            type="button"
            className={isActive ? 'is-active' : ''}
            onClick={() => onNavigate(item.key)}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={24} stroke={1.7} />
            <span>{item.mobileLabel}</span>
          </button>
        );
      })}
    </nav>
  );
}

function SubjectHeader({
  onMemberChange,
}: {
  onMemberChange: (_subjectId: number) => void;
}) {
  const { experience } = useHouseholdHealthExperience();
  const [open, setOpen] = useState(false);
  const subjectControlRef = useRef<HTMLDivElement>(null);
  const member = experience.subject;

  useEffect(() => {
    if (!open) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !subjectControlRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <header className="hhp-subject-header">
      <div className="hhp-subject-wrap">
        {experience.mode === 'demo' ? (
          <img
            src="/assets/prototype/demo-avatar.svg"
            alt=""
            className="hhp-avatar"
          />
        ) : (
          <span className="hhp-avatar hhp-avatar-fallback" aria-hidden="true">
            <IconUser size={23} />
          </span>
        )}
        <div className="hhp-subject-control" ref={subjectControlRef}>
          <button
            type="button"
            className="hhp-subject-button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
          >
            <span>
              {member?.relationshipLabel || '选择档案'} ·{' '}
              {member?.label || '尚未选择'}
            </span>
            <IconChevronDown size={18} stroke={1.7} />
          </button>
          <AnimatePresence>
            {open ? (
              <motion.div
                className="hhp-subject-menu"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
              >
                {experience.subjects.map(subject => (
                  <button
                    type="button"
                    key={subject.id}
                    onClick={() => {
                      onMemberChange(subject.id);
                      setOpen(false);
                    }}
                  >
                    <span>{subject.relationshipLabel}</span>
                    <strong>{subject.label}</strong>
                    {member?.id === subject.id ? <IconCheck size={17} /> : null}
                  </button>
                ))}
                <p>切换当前账号可以查看的健康档案</p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

function TrendChart({
  metric,
  points = metric.points,
  density = 'standard',
}: {
  metric: HouseholdHealthMetric;
  points?: readonly HouseholdHealthPoint[];
  density?: HouseholdHealthTrendDensity;
}) {
  const data = points.flatMap(point => {
    const timestamp = toHouseholdTrendTimestamp(point.date);
    return timestamp === null ? [] : [{ ...point, timestamp }];
  });
  const spanDays =
    data.length < 2
      ? 0
      : (data.at(-1)!.timestamp - data[0].timestamp) / 86_400_000;
  const formatFullDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
      2,
      '0'
    )}-${String(date.getUTCDate()).padStart(2, '0')}`;
  };
  const dot = {
    r: density === 'dense' ? 2 : density === 'sparse' ? 6 : 4.5,
    fill: '#078b89',
    stroke: '#fff',
    strokeWidth: density === 'dense' ? 1 : 2.5,
  };
  return (
    <div
      className="hhp-chart"
      data-density={density}
      aria-label={`${metric.label}趋势图`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 40, bottom: 0, left: 40 }}
        >
          <CartesianGrid
            stroke="#e7e8e4"
            strokeDasharray="4 4"
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={timestamp =>
              formatHouseholdTrendAxisDate(Number(timestamp), spanDays)
            }
            tick={{ fill: '#788084', fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: '#bcc2c2' }}
            minTickGap={28}
          />
          <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #dfe2dc',
              boxShadow: '0 8px 24px rgba(27, 45, 48, 0.08)',
            }}
            formatter={value => [`${value} ${metric.unit}`, metric.label]}
            labelFormatter={timestamp => formatFullDate(Number(timestamp))}
          />
          <Area
            type="monotoneX"
            dataKey="value"
            stroke="#078b89"
            strokeWidth={3}
            fill="#dcefed"
            fillOpacity={0.72}
            dot={dot}
            activeDot={{ r: 8 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricObservationTable({
  metric,
  points = metric.points,
  highlightedRecordId,
  canRevise = false,
  onRevise,
}: {
  metric: HouseholdHealthMetric;
  points?: readonly HouseholdHealthPoint[];
  highlightedRecordId?: string | null;
  canRevise?: boolean;
  onRevise?: (_componentId: number) => void;
}) {
  const rows = [...points].reverse();
  const showRevisionActions =
    canRevise && rows.some(point => point.componentId != null);
  const statusLabels: Record<string, string> = {
    normal: '正常',
    high: '偏高',
    low: '偏低',
    borderline: '临界',
    abnormal: '异常',
    critical: '需尽快关注',
  };
  return (
    <div className="hhp-metric-detail-table-wrap">
      <table aria-label={`${metric.label}详细数据`}>
        <caption>{metric.label}的正式记录</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">记录值</th>
            <th scope="col">状态</th>
            <th scope="col">来源</th>
            {showRevisionActions ? (
              <th scope="col" className="hhp-metric-action-column">
                操作
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map(point => (
            <tr
              key={point.id}
              id={`health-record-${point.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
              className={
                point.id === highlightedRecordId
                  ? 'is-citation-target'
                  : undefined
              }
            >
              <td>{point.date}</td>
              <td>
                {point.secondaryValue === null
                  ? point.value
                  : `${point.value} / ${point.secondaryValue}`}
                {metric.unit ? ` ${metric.unit}` : ''}
              </td>
              <td>
                {point.status
                  ? (statusLabels[point.status] ?? point.status)
                  : '未标注'}
              </td>
              <td>{point.sourceDocumentId ? '已关联原件' : '结构化记录'}</td>
              {showRevisionActions ? (
                <td className="hhp-metric-action-column">
                  {point.componentId != null ? (
                    <button
                      type="button"
                      className="hhp-metric-revise-button"
                      aria-label={`修订${metric.label} ${point.date} 的正式记录`}
                      onClick={() => onRevise?.(point.componentId as number)}
                    >
                      修订
                    </button>
                  ) : (
                    <span className="hhp-metric-action-unavailable">—</span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendRangeControl({
  metric,
  value,
  onChange,
  ariaLabel,
}: {
  metric: HouseholdHealthMetric;
  value: HouseholdHealthTrendRange;
  onChange: (_range: HouseholdHealthTrendRange) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="hhp-range-control">
      <span>时间范围</span>
      <select
        aria-label={ariaLabel || `${metric.label}时间范围`}
        value={value}
        onChange={event =>
          onChange(event.target.value as HouseholdHealthTrendRange)
        }
      >
        {HOUSEHOLD_HEALTH_TREND_RANGE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PinnedMetricModal({
  metrics,
  pinnedMetricIds,
  onClose,
  onSave,
}: {
  metrics: HouseholdHealthMetric[];
  pinnedMetricIds: string[];
  onClose: () => void;
  onSave: (_metricIds: string[]) => void;
}) {
  const eligibleMetrics = metrics.filter(
    metric => buildHouseholdTrendView(metric, 'all').hasTrend
  );
  const [selectedIds, setSelectedIds] = useState(() =>
    normalizePinnedHouseholdMetricIds(metrics, pinnedMetricIds)
  );
  const toggleMetric = (metricId: string) => {
    setSelectedIds(current => {
      if (current.includes(metricId)) {
        return current.length === 1
          ? current
          : current.filter(id => id !== metricId);
      }
      return current.length >= 2 ? current : [...current, metricId];
    });
  };
  const moveMetric = (metricId: string, offset: -1 | 1) => {
    setSelectedIds(current => {
      const index = current.indexOf(metricId);
      const nextIndex = index + offset;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  return (
    <motion.div
      className="hhp-modal-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        className="hhp-modal hhp-pinned-metric-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinned-metric-title"
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
      >
        <div className="hhp-modal-heading">
          <div>
            <p className="hhp-section-label">首页可显示 1—2 项</p>
            <h2 id="pinned-metric-title">管理常看指标</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <IconX size={20} />
          </button>
        </div>
        <p className="hhp-pinned-metric-help">
          只选择已有两次以上正式记录的指标。调整只影响展示，不修改任何健康数据。
        </p>
        <div className="hhp-pinned-metric-list">
          {eligibleMetrics.map(metric => {
            const selectedIndex = selectedIds.indexOf(metric.id);
            const selected = selectedIndex >= 0;
            const selectionLimitReached = selectedIds.length >= 2;
            return (
              <div className={selected ? 'is-selected' : ''} key={metric.id}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={metric.label}
                    checked={selected}
                    disabled={
                      (!selected && selectionLimitReached) ||
                      (selected && selectedIds.length === 1)
                    }
                    onChange={() => toggleMetric(metric.id)}
                  />
                  <span>
                    <strong>{metric.label}</strong>
                    <small>{metric.points.length} 条正式记录</small>
                  </span>
                </label>
                {selected ? (
                  <span className="hhp-pinned-order-actions">
                    <button
                      type="button"
                      aria-label={`上移${metric.label}`}
                      disabled={selectedIndex === 0}
                      onClick={() => moveMetric(metric.id, -1)}
                    >
                      <IconArrowUp size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移${metric.label}`}
                      disabled={selectedIndex === selectedIds.length - 1}
                      onClick={() => moveMetric(metric.id, 1)}
                    >
                      <IconArrowDown size={18} />
                    </button>
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <p className="hhp-pinned-session-note">
          当前版本在本次使用期间按档案保留选择，不会把指标数值写入浏览器存储。
        </p>
        <div className="hhp-pinned-metric-actions">
          <button
            type="button"
            className="hhp-secondary-button"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="hhp-modal-primary"
            onClick={() => {
              onSave(selectedIds);
              onClose();
            }}
          >
            <IconCheck size={19} />
            完成
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function HouseholdTrendCard({
  metric,
  view,
  range,
  secondary,
  onRangeChange,
  onOpenDetails,
}: {
  metric: HouseholdHealthMetric;
  view: HouseholdHealthTrendView;
  range: HouseholdHealthTrendRange;
  secondary: boolean;
  onRangeChange: (_range: HouseholdHealthTrendRange) => void;
  onOpenDetails: () => void;
}) {
  return (
    <article
      className={`hhp-card hhp-trend-card ${
        secondary ? 'is-secondary' : 'is-primary'
      }`}
    >
      <div className="hhp-card-heading">
        <div>
          <p className="hhp-section-label">
            {secondary ? '第 2 项常看指标' : '主要趋势'}
          </p>
          <h2>{metric.label}趋势</h2>
        </div>
        <TrendRangeControl
          metric={metric}
          value={range}
          onChange={onRangeChange}
        />
      </div>
      <p className="hhp-trend-window" aria-live="polite">
        {view.actualRangeLabel} · {view.points.length} 条记录
      </p>
      {view.hasTrend ? (
        <TrendChart
          metric={metric}
          points={view.points}
          density={view.density}
        />
      ) : (
        <div className="hhp-empty-state is-compact hhp-trend-empty">
          <IconChartLine size={30} />
          <strong>当前范围内暂无趋势</strong>
          <p>至少需要两次真实记录才能连接折线，可以换一个时间范围。</p>
        </div>
      )}
      <div className="hhp-trend-footer">
        <small>
          {view.rangeReason}。{view.displayReason}
          。未测量时段不补值，连线也不代表当时的实际读数。
        </small>
        <button type="button" className="hhp-text-link" onClick={onOpenDetails}>
          查看详细数据
          <IconChevronRight size={18} />
        </button>
      </div>
    </article>
  );
}

function HomePage({
  onNavigate,
  onOpenMetric,
  onOpenShare,
}: {
  onNavigate: (_page: PageKey) => void;
  onOpenMetric: (_metricId: string) => void;
  onOpenShare: () => void;
}) {
  const {
    experience,
    loading,
    dashboard,
    onPinnedMetricsChange,
    onTrendRangeChange,
    onUpload,
    onExport,
    onOpenDetails,
    onRetry,
  } = useHouseholdHealthExperience();
  const [pinnedMetricModalOpen, setPinnedMetricModalOpen] = useState(false);
  const pinnedMetrics = dashboard.pinnedMetricIds
    .map(metricId =>
      experience.snapshot.metrics.find(metric => metric.id === metricId)
    )
    .filter((metric): metric is HouseholdHealthMetric => Boolean(metric));
  const latestReport = experience.snapshot.reports[0] || null;
  const hasErrors = experience.snapshot.errors.length > 0;
  return (
    <section className="hhp-page hhp-home-page" aria-labelledby="home-title">
      <div className="hhp-page-heading">
        <div>
          <p className="hhp-eyebrow">个人健康概览</p>
          <h1 id="home-title">最近的变化</h1>
        </div>
        <span className="hhp-data-status">
          {hasErrors ? (
            <IconAlertTriangle size={17} />
          ) : (
            <IconCircleCheck size={17} />
          )}
          {loading ? '正在同步' : hasErrors ? '部分数据暂不可用' : '数据已同步'}
        </span>
      </div>

      <div className="hhp-primary-actions">
        {experience.capabilities.canUpload ? (
          <button
            type="button"
            className="hhp-action hhp-action-primary"
            onClick={onUpload}
          >
            <IconUpload size={27} stroke={1.8} />
            <span>上传新报告</span>
          </button>
        ) : null}
        {experience.capabilities.canShare === true ? (
          <button type="button" className="hhp-action" onClick={onOpenShare}>
            <IconShare3 size={25} stroke={1.8} />
            <span>复制 / 分享</span>
          </button>
        ) : null}
        {experience.capabilities.canExport ? (
          <button type="button" className="hhp-action" onClick={onExport}>
            <IconPrinter size={25} stroke={1.8} />
            <span>导出 / 打印</span>
          </button>
        ) : null}
      </div>

      <div className="hhp-trend-section-heading">
        <div>
          <p className="hhp-section-label">我关注的趋势</p>
          <h2>常看的变化</h2>
        </div>
        {experience.snapshot.metrics.length > 0 ? (
          <button
            type="button"
            className="hhp-manage-trends"
            onClick={() => setPinnedMetricModalOpen(true)}
          >
            <IconAdjustments size={18} />
            管理常看指标
          </button>
        ) : null}
      </div>

      {pinnedMetrics.length > 0 ? (
        <div
          className={`hhp-trend-grid ${
            pinnedMetrics.length === 1 ? 'has-one' : 'has-two'
          }`}
        >
          {pinnedMetrics.map((metric, index) => {
            const range = dashboard.rangesByMetricId[metric.id] ?? 'auto';
            const view = buildHouseholdTrendView(metric, range);
            return (
              <HouseholdTrendCard
                key={metric.id}
                metric={metric}
                view={view}
                range={range}
                secondary={index > 0}
                onRangeChange={nextRange =>
                  onTrendRangeChange(metric.id, nextRange)
                }
                onOpenDetails={() => onOpenMetric(metric.id)}
              />
            );
          })}
        </div>
      ) : (
        <article className="hhp-card hhp-trend-card">
          <div className="hhp-empty-state">
            <IconChartLine size={34} />
            <strong>还没有可绘制的长期趋势</strong>
            <p>同一指标至少保存两次正式记录后，这里才会显示折线。</p>
            {hasErrors ? (
              <button type="button" onClick={onRetry}>
                重试加载
              </button>
            ) : experience.capabilities.canUpload ? (
              <button type="button" onClick={onUpload}>
                上传第一份报告
              </button>
            ) : null}
          </div>
        </article>
      )}

      <div className="hhp-home-lower">
        {experience.capabilities.canViewSources ? (
          <article className="hhp-card hhp-recent-card">
            <div className="hhp-card-heading compact">
              <div>
                <p className="hhp-section-label">最近报告</p>
                <h2>体检报告</h2>
              </div>
              <span>{latestReport?.date || '暂无'}</span>
            </div>
            {latestReport ? (
              <button
                type="button"
                className="hhp-report-row"
                onClick={() =>
                  experience.mode === 'live' && onOpenDetails
                    ? onOpenDetails('sources')
                    : onNavigate('archive')
                }
              >
                <span className="hhp-report-icon">
                  <IconFileText size={22} />
                </span>
                <span>
                  <strong>{latestReport.title}</strong>
                  <p>
                    {latestReport.statusLabel} · {latestReport.facility}
                  </p>
                </span>
                <IconChevronRight size={20} />
              </button>
            ) : (
              <div className="hhp-empty-inline">尚未保存报告原件</div>
            )}
          </article>
        ) : null}
        {experience.capabilities.canUseAi &&
        experience.capabilities.canCopyForAi ? (
          <button
            type="button"
            className="hhp-ai-prompt"
            onClick={() => onNavigate('assistant')}
          >
            <span className="hhp-ai-prompt-icon">
              <IconSparkles size={23} />
            </span>
            <span>
              <small>
                {experience.mode === 'live'
                  ? '本地生成，不会自动发送'
                  : '想进一步了解？'}
              </small>
              <strong>
                {experience.mode === 'live'
                  ? '准备一份 AI 提问资料'
                  : '向 AI 询问我的正式资料'}
              </strong>
            </span>
            <IconChevronRight size={20} />
          </button>
        ) : experience.capabilities.canShare === true ? (
          <button type="button" className="hhp-ai-prompt" onClick={onOpenShare}>
            <span className="hhp-ai-prompt-icon">
              <IconCopy size={23} />
            </span>
            <span>
              <small>需要借助其他 AI？</small>
              <strong>复制一份去标识化资料摘要</strong>
            </span>
            <IconChevronRight size={20} />
          </button>
        ) : null}
      </div>
      <AnimatePresence>
        {pinnedMetricModalOpen ? (
          <PinnedMetricModal
            metrics={experience.snapshot.metrics}
            pinnedMetricIds={dashboard.pinnedMetricIds}
            onClose={() => setPinnedMetricModalOpen(false)}
            onSave={onPinnedMetricsChange}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function ArchivePage({
  requestedMetricId,
  requestedRecordId,
}: {
  requestedMetricId: string | null;
  requestedRecordId: string | null;
}) {
  const {
    experience,
    dashboard,
    onTrendRangeChange,
    onUpload,
    onOpenDetails,
    onParseReport,
    onDownloadReport,
    onPreviewReport,
    onMetricRevisionSaved,
    loadFormalMetricRevisions,
    createFormalMetricRevision,
  } = useHouseholdHealthExperience();
  const visibleTabs = useMemo(
    () =>
      experience.capabilities.canViewSources
        ? ARCHIVE_TABS
        : ARCHIVE_TABS.filter(item => item.key === 'metrics'),
    [experience.capabilities.canViewSources]
  );
  const [tab, setTab] = useState<ArchiveTab>(() =>
    requestedMetricId || !experience.capabilities.canViewSources
      ? 'metrics'
      : 'reports'
  );
  const [query, setQuery] = useState('');
  const [reportFiltersOpen, setReportFiltersOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState('');
  const [reportType, setReportType] = useState('');
  const [reportYear, setReportYear] = useState('');
  const [selectedMetricId, setSelectedMetricId] = useState(
    requestedMetricId ?? ''
  );
  const [metricDetailOpen, setMetricDetailOpen] = useState(
    Boolean(requestedRecordId)
  );
  const [previewReport, setPreviewReport] =
    useState<HouseholdHealthReport | null>(null);
  const [revisionComponentId, setRevisionComponentId] = useState<number | null>(
    null
  );
  useEffect(() => {
    if (!visibleTabs.some(item => item.key === tab)) setTab('metrics');
  }, [tab, visibleTabs]);
  useEffect(() => {
    if (
      requestedMetricId &&
      experience.snapshot.metrics.some(
        metric => metric.id === requestedMetricId
      )
    ) {
      setTab('metrics');
      setSelectedMetricId(requestedMetricId);
      setMetricDetailOpen(Boolean(requestedRecordId));
    }
  }, [experience.snapshot.metrics, requestedMetricId, requestedRecordId]);
  useEffect(() => {
    if (!requestedRecordId || !metricDetailOpen) return;
    const targetId = `health-record-${requestedRecordId.replace(
      /[^a-zA-Z0-9_-]/g,
      '-'
    )}`;
    const timer = window.setTimeout(() => {
      const target = document.getElementById(targetId);
      if (typeof target?.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [metricDetailOpen, requestedRecordId, selectedMetricId]);
  const reportFilterOptions = useMemo(
    () => buildHouseholdReportFilterOptions(experience.snapshot.reports),
    [experience.snapshot.reports]
  );
  const filteredReports = useMemo(
    () =>
      filterHouseholdHealthReports(experience.snapshot.reports, {
        query,
        status: reportStatus,
        type: reportType,
        year: reportYear,
      }),
    [experience.snapshot.reports, query, reportStatus, reportType, reportYear]
  );
  const activeReportFilterCount = [reportStatus, reportType, reportYear].filter(
    Boolean
  ).length;
  const hasReportConditions =
    Boolean(query.trim()) || activeReportFilterCount > 0;
  const clearReportConditions = () => {
    setQuery('');
    setReportStatus('');
    setReportType('');
    setReportYear('');
  };
  const selectedMetric =
    experience.snapshot.metrics.find(
      metric => metric.id === selectedMetricId
    ) ||
    experience.snapshot.metrics[0] ||
    null;
  const selectedMetricRange = selectedMetric
    ? (dashboard.rangesByMetricId[selectedMetric.id] ?? 'auto')
    : 'auto';
  const selectedMetricView = selectedMetric
    ? buildHouseholdTrendView(selectedMetric, selectedMetricRange)
    : null;
  return (
    <section className="hhp-page" aria-labelledby="archive-title">
      <div className="hhp-page-heading">
        <div>
          <p className="hhp-eyebrow">
            {experience.capabilities.canViewSources
              ? '原件、指标和长期变化'
              : '指标和长期变化'}
          </p>
          <h1 id="archive-title">健康档案</h1>
        </div>
        {experience.capabilities.canUpload ? (
          <button
            type="button"
            className="hhp-secondary-button"
            onClick={onUpload}
          >
            <IconUpload size={19} />
            上传新报告
          </button>
        ) : null}
      </div>

      <div className="hhp-tab-list" role="tablist" aria-label="健康档案分类">
        {visibleTabs.map(item => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            key={item.key}
            className={tab === item.key ? 'is-active' : ''}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
        >
          {tab === 'reports' ? (
            <div className="hhp-archive-panel">
              <div className="hhp-filter-row">
                <label className="hhp-search">
                  <IconSearch size={19} />
                  <span className="hhp-sr-only">搜索报告</span>
                  <input
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="搜索报告、机构或日期"
                  />
                </label>
                <button
                  type="button"
                  className={`hhp-filter-button ${
                    activeReportFilterCount > 0 ? 'is-active' : ''
                  }`}
                  aria-label={
                    activeReportFilterCount > 0
                      ? `筛选报告，已启用 ${activeReportFilterCount} 项`
                      : '筛选报告'
                  }
                  aria-expanded={reportFiltersOpen}
                  aria-controls="hhp-report-filters"
                  onClick={() => setReportFiltersOpen(value => !value)}
                >
                  <IconAdjustments size={18} />
                  筛选
                  {activeReportFilterCount > 0 ? (
                    <span className="hhp-filter-count">
                      {activeReportFilterCount}
                    </span>
                  ) : null}
                </button>
              </div>
              {reportFiltersOpen ? (
                <div
                  id="hhp-report-filters"
                  className="hhp-filter-panel"
                  role="group"
                  aria-label="报告筛选条件"
                >
                  <label>
                    <span>报告状态</span>
                    <select
                      aria-label="报告状态"
                      value={reportStatus}
                      onChange={event => setReportStatus(event.target.value)}
                    >
                      <option value="">全部状态</option>
                      {reportFilterOptions.statuses.map(status => (
                        <option value={status} key={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>资料类型</span>
                    <select
                      aria-label="资料类型"
                      value={reportType}
                      onChange={event => setReportType(event.target.value)}
                    >
                      <option value="">全部类型</option>
                      {reportFilterOptions.types.map(type => (
                        <option value={type} key={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>报告年份</span>
                    <select
                      aria-label="报告年份"
                      value={reportYear}
                      onChange={event => setReportYear(event.target.value)}
                    >
                      <option value="">全部年份</option>
                      {reportFilterOptions.years.map(year => (
                        <option value={year} key={year}>
                          {year} 年
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
              <div className="hhp-report-result-bar">
                <p role="status" aria-live="polite">
                  {hasReportConditions
                    ? `显示 ${filteredReports.length} / ${experience.snapshot.reports.length} 份报告`
                    : `共 ${experience.snapshot.reports.length} 份报告`}
                </p>
                {hasReportConditions ? (
                  <button type="button" onClick={clearReportConditions}>
                    清除全部条件
                  </button>
                ) : null}
              </div>
              <div className="hhp-report-list">
                {filteredReports.map(report => (
                  <div className="hhp-archive-report" key={report.id}>
                    <span className="hhp-file-tile">
                      <IconFileTypePdf size={25} />
                    </span>
                    <span className="hhp-report-copy">
                      <strong>{report.title}</strong>
                      <small>
                        {report.date} · {report.facility}
                      </small>
                    </span>
                    <span
                      className="hhp-report-status"
                      data-state={report.processingState || 'saved'}
                    >
                      <em>{report.statusLabel}</em>
                      <small>
                        {report.processingHint ? (
                          <>
                            <span>{report.processingHint}</span>
                            <span aria-hidden="true"> · </span>
                          </>
                        ) : null}
                        <span>{report.sizeLabel}</span>
                      </small>
                    </span>
                    <span className="hhp-report-actions">
                      {experience.capabilities.canUpload &&
                      (report.processingAction
                        ? report.processingAction !== 'none'
                        : ['已保存原件', '原件已保存'].includes(
                            report.statusLabel
                          )) ? (
                        <button
                          type="button"
                          className="hhp-report-parse"
                          onClick={() => {
                            if (report.processingAction === 'view_metrics') {
                              setTab('metrics');
                              return;
                            }
                            onParseReport?.(report.sourceDocumentId ?? 0);
                          }}
                        >
                          <IconFileSearch size={16} />
                          {report.processingActionLabel || '本地解析'}
                        </button>
                      ) : null}
                      {experience.capabilities.canPreviewSources &&
                      onPreviewReport &&
                      canPreviewHouseholdSource(report.mimeType) ? (
                        <button
                          type="button"
                          className="hhp-report-preview"
                          aria-label={`预览${report.title}原件`}
                          onClick={() => setPreviewReport(report)}
                        >
                          <IconEye size={16} />
                          在线预览
                        </button>
                      ) : null}
                      {experience.capabilities.canDownloadSources &&
                      onDownloadReport ? (
                        <button
                          type="button"
                          className="hhp-report-download"
                          aria-label={`下载${report.title}原件`}
                          onClick={() =>
                            onDownloadReport?.(report.sourceDocumentId)
                          }
                        >
                          <IconDownload size={16} />
                          下载原件
                        </button>
                      ) : null}
                      {onOpenDetails ? (
                        <button
                          type="button"
                          className="hhp-report-open"
                          aria-label={`打开${report.title}`}
                          onClick={() => onOpenDetails('sources')}
                        >
                          <IconChevronRight size={19} />
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
                {filteredReports.length === 0 ? (
                  <div className="hhp-empty-state is-compact">
                    <IconFileText size={30} />
                    <strong>没有找到报告原件</strong>
                    <p>
                      {hasReportConditions
                        ? '请调整或清除当前搜索与筛选条件。'
                        : '上传后会先完整保存源文件，再进入解析与复核。'}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === 'metrics' ? (
            <div className="hhp-archive-grid">
              <article className="hhp-card hhp-metric-browser">
                <div className="hhp-card-heading compact">
                  <div>
                    <p className="hhp-section-label">已确认指标</p>
                    <h2>选择一个指标查看趋势</h2>
                  </div>
                  <IconDatabase size={23} />
                </div>
                {experience.snapshot.metrics.map(metric => (
                  <button
                    type="button"
                    key={metric.id}
                    className={
                      selectedMetric?.id === metric.id ? 'is-selected' : ''
                    }
                    aria-label={`查看${metric.label}趋势`}
                    aria-pressed={selectedMetric?.id === metric.id}
                    onClick={() => {
                      setSelectedMetricId(metric.id);
                      setMetricDetailOpen(false);
                    }}
                  >
                    <span>
                      <strong>{metric.label}</strong>
                      <small>
                        {metric.points.length} 条正式记录
                        {metric.unit ? ` · ${metric.unit}` : ''}
                      </small>
                    </span>
                    <IconChevronRight size={18} />
                  </button>
                ))}
                {experience.snapshot.metrics.length === 0 ? (
                  <div className="hhp-empty-inline">暂无可绘制的指标趋势</div>
                ) : null}
              </article>
              {selectedMetric ? (
                <article
                  className="hhp-card hhp-mini-trend"
                  aria-label={`${selectedMetric.label}趋势摘要`}
                >
                  <div className="hhp-card-heading compact">
                    <div>
                      <p className="hhp-section-label">
                        {selectedMetric.label}
                      </p>
                      <h2>
                        {selectedMetricView?.actualRangeLabel} ·{' '}
                        {selectedMetricView?.points.length} 条记录
                      </h2>
                    </div>
                    <TrendRangeControl
                      metric={selectedMetric}
                      value={selectedMetricRange}
                      ariaLabel="时间范围"
                      onChange={range =>
                        onTrendRangeChange(selectedMetric.id, range)
                      }
                    />
                  </div>
                  <p className="hhp-trend-context-note">
                    {selectedMetricView?.rangeReason}
                    。曲线只连接真实记录，不补画缺失值，也不代表检查周期。
                  </p>
                  {selectedMetricView?.hasTrend ? (
                    <TrendChart
                      metric={selectedMetric}
                      points={selectedMetricView.points}
                      density={selectedMetricView.density}
                    />
                  ) : (
                    <div className="hhp-empty-state is-compact hhp-trend-empty">
                      <IconChartLine size={30} />
                      <strong>当前范围内暂无趋势</strong>
                      <p>至少需要两次真实记录，可以换一个时间范围。</p>
                    </div>
                  )}
                  <button
                    type="button"
                    className="hhp-text-link"
                    aria-expanded={metricDetailOpen}
                    aria-controls="hhp-metric-detail-table"
                    aria-label={`查看${selectedMetric.label}详细数据`}
                    onClick={() => setMetricDetailOpen(value => !value)}
                  >
                    {metricDetailOpen ? '收起详细数据' : '查看详细数据'}
                    <IconChevronRight
                      className={metricDetailOpen ? 'is-expanded' : ''}
                      size={18}
                    />
                  </button>
                  {metricDetailOpen ? (
                    <div id="hhp-metric-detail-table">
                      {requestedRecordId ? (
                        <p className="hhp-citation-target-note">
                          已从 AI
                          回答定位到引用记录；下表临时显示该指标的全部已加载记录。
                        </p>
                      ) : null}
                      <MetricObservationTable
                        metric={selectedMetric}
                        points={
                          requestedRecordId
                            ? selectedMetric.points
                            : selectedMetricView?.points
                        }
                        highlightedRecordId={requestedRecordId}
                        canRevise={
                          experience.capabilities.canReviseMetrics === true
                        }
                        onRevise={setRevisionComponentId}
                      />
                      {experience.mode === 'live' && onOpenDetails ? (
                        <button
                          type="button"
                          className="hhp-secondary-button hhp-open-full-metric"
                          onClick={() => onOpenDetails('metrics')}
                        >
                          打开完整指标详情
                          <IconChevronRight size={18} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ) : null}
            </div>
          ) : null}

          {tab === 'comparison' ? (
            <div className="hhp-card hhp-comparison">
              <div className="hhp-card-heading">
                <div>
                  <p className="hhp-section-label">体检批次</p>
                  <h2>
                    {experience.mode === 'demo'
                      ? '2026 年与 2025 年'
                      : '在详细档案中选择两次体检'}
                  </h2>
                </div>
                {onOpenDetails ? (
                  <button
                    type="button"
                    className="hhp-filter-button"
                    onClick={() => onOpenDetails('exams')}
                  >
                    {experience.mode === 'demo' ? '更换批次' : '打开对比工作台'}
                  </button>
                ) : null}
              </div>
              {experience.mode === 'demo' ? (
                <div className="hhp-comparison-table" role="table">
                  <div role="row" className="hhp-table-head">
                    <span>指标</span>
                    <span>2025</span>
                    <span>2026</span>
                    <span>说明</span>
                  </div>
                  {[
                    ['血压', '126 / 82', '124 / 80', '变化较小'],
                    ['体重', '67.6', '68.1', '记录可比较'],
                    ['空腹血糖', '5.1', '5.0', '同单位'],
                  ].map(row => (
                    <div role="row" key={row[0]}>
                      {row.map(cell => (
                        <span role="cell" key={cell}>
                          {cell}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="hhp-empty-state is-compact">
                  <IconChartLine size={30} />
                  <strong>这里不生成推测性的比较结果</strong>
                  <p>详细工作台会按报告批次、日期和单位检查可比性。</p>
                </div>
              )}
              <p className="hhp-data-note">
                这里只呈现可核对的原值和差异，不自动判断改善或恶化。
              </p>
            </div>
          ) : null}

          {tab === 'quality' && experience.mode === 'demo' ? (
            <div className="hhp-quality-grid">
              {[
                {
                  icon: IconCircleCheck,
                  title: '来源完整',
                  text: '17 条记录可以回到具体报告或手工来源。',
                },
                {
                  icon: IconInfoCircle,
                  title: '2 项资料不足',
                  text: '缺少计算筛查状态所需的基础资料。',
                },
                {
                  icon: IconShieldCheck,
                  title: '未发现冲突',
                  text: '当前没有同日同指标的正式记录冲突。',
                },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <article
                    className="hhp-card hhp-quality-card"
                    key={item.title}
                  >
                    <Icon size={27} />
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                  </article>
                );
              })}
            </div>
          ) : null}
          {tab === 'quality' && experience.mode === 'live' ? (
            <div className="hhp-card hhp-comparison">
              <div className="hhp-card-heading">
                <div>
                  <p className="hhp-section-label">数据质量</p>
                  <h2>检查缺失日期、单位和疑似重复</h2>
                </div>
                {onOpenDetails ? (
                  <button
                    type="button"
                    className="hhp-filter-button"
                    onClick={() => onOpenDetails('quality')}
                  >
                    打开质量工作台
                  </button>
                ) : null}
              </div>
              <p className="hhp-data-note">
                这里不会自动修改或删除任何健康数据，所有修订仍由用户确认。
              </p>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
      {previewReport && onPreviewReport ? (
        <HouseholdSourcePreviewModal
          report={previewReport}
          onLoad={onPreviewReport}
          onDownload={onDownloadReport}
          onClose={() => setPreviewReport(null)}
        />
      ) : null}
      <HealthFormalMetricRevisionModal
        opened={revisionComponentId !== null}
        componentId={revisionComponentId}
        onClose={() => setRevisionComponentId(null)}
        onRevised={history => onMetricRevisionSaved?.(history)}
        loadHistory={loadFormalMetricRevisions}
        createRevision={createFormalMetricRevision}
      />
    </section>
  );
}

function LiveAssistantPage() {
  const {
    experience,
    aiCapability,
    aiHistory = [],
    aiHistoryLoading = false,
    aiHistoryLoadingMore = false,
    aiHistoryTotal,
    aiHistoryError = '',
    onAskAi,
    onOpenAiHistory,
    onDeleteAiHistory,
    onLoadMoreAiHistory,
    onRetryAiHistory,
    onOpenAiCitation,
    onPrepareHandoff,
  } = useHouseholdHealthExperience();
  const [questionId, setQuestionId] =
    useState<HouseholdAiQuestionId>('recent_changes');
  const [question, setQuestion] = useState('最近有哪些变化？');
  const [range, setRange] = useState<HouseholdAiRange>('5y');
  const snapshotMetricIdsKey = experience.snapshot.metrics
    .map(metric => metric.id)
    .join('\0');
  const snapshotContentKey = experience.snapshot.metrics
    .flatMap(metric => [
      metric.id,
      metric.unit,
      metric.latestStatus ?? '',
      ...metric.points.flatMap(point => [
        point.id,
        point.date,
        String(point.value),
        point.secondaryValue === null ? '' : String(point.secondaryValue),
        point.status ?? '',
      ]),
    ])
    .join('\0');
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>(() =>
    experience.snapshot.metrics.map(metric => metric.id)
  );
  const [scopeOpen, setScopeOpen] = useState(false);
  const [handoff, setHandoff] = useState<HouseholdAiHandoffModel | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [answer, setAnswer] = useState<HealthAiQuestionResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [localHistory, setLocalHistory] =
    useState<HealthAiAnswerSummary[]>(aiHistory);
  const [historyError, setHistoryError] = useState('');
  const [openingAnswerId, setOpeningAnswerId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [deletingAnswerId, setDeletingAnswerId] = useState<number | null>(null);

  useEffect(() => {
    setQuestionId('recent_changes');
    setQuestion('最近有哪些变化？');
    setRange('5y');
    setSelectedMetricIds(
      snapshotMetricIdsKey ? snapshotMetricIdsKey.split('\0') : []
    );
    setHandoff(null);
    setCopied(false);
    setCopyError('');
    setAnswer(null);
    setAskError('');
    setHistoryOpen(false);
    setHistoryError('');
    setPendingDeleteId(null);
  }, [
    experience.snapshot.loadedAt,
    experience.subject?.id,
    snapshotContentKey,
    snapshotMetricIdsKey,
  ]);
  useEffect(() => {
    setLocalHistory(aiHistory);
  }, [aiHistory]);

  const visibleHistoryTotal = Math.max(
    aiHistoryTotal ?? localHistory.length,
    localHistory.length
  );
  const hasMoreHistory = localHistory.length < visibleHistoryTotal;
  const selectedMetrics = experience.snapshot.metrics.filter(metric =>
    selectedMetricIds.includes(metric.id)
  );
  const handoffText = handoff ? renderHouseholdAiHandoffText(handoff) : '';
  const connected = Boolean(aiCapability?.available && onAskAi);
  const serverSupportsRecentChanges = Boolean(
    aiCapability?.supported_question_ids.includes('recent_changes')
  );
  const capabilityIsTest = Boolean(aiCapability?.test_mode);
  const activeAnswerIsTest = Boolean(answer?.processing.test_mode);
  const connectedTitle = capabilityIsTest
    ? '虚构数据动态测试已开启'
    : '家庭服务器安全整理配置已通过门禁';
  const analyzeLabel = capabilityIsTest
    ? '运行虚构数据动态测试'
    : '家庭服务器安全整理最近变化';
  const canRunHandoffOnServer = Boolean(
    connected &&
    serverSupportsRecentChanges &&
    handoff?.status === 'ready' &&
    handoff.questionId === 'recent_changes'
  );

  const chooseQuestion = (
    id: HouseholdAiQuestionId,
    prompt: string,
    disabled?: boolean
  ) => {
    if (disabled) return;
    setQuestionId(id);
    setQuestion(prompt);
    setHandoff(null);
    setCopied(false);
    setCopyError('');
    setAnswer(null);
    setAskError('');
  };

  const generate = () => {
    const next = buildHouseholdAiHandoff(experience.snapshot, {
      questionId,
      question,
      range,
      selectedMetricIds,
    });
    setHandoff(next);
    setCopied(false);
    setCopyError('');
    setAnswer(null);
    setAskError('');
  };

  const ask = async () => {
    if (
      !handoff ||
      handoff.status !== 'ready' ||
      handoff.questionId !== 'recent_changes' ||
      !onAskAi ||
      !connected ||
      !serverSupportsRecentChanges
    ) {
      return;
    }
    setAsking(true);
    setAskError('');
    setAnswer(null);
    try {
      const response = await onAskAi({
        question_id: 'recent_changes',
        question: handoff.question,
        range: handoff.range,
        record_ids: handoff.observations.map(item => item.recordId),
      });
      setAnswer(response);
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
      setLocalHistory(current => [
        summary,
        ...current.filter(item => item.answer_id !== summary.answer_id),
      ]);
    } catch (error) {
      setAskError(
        getApiErrorCode(error) === 'health_ai_input_too_large'
          ? '所选记录超过家庭服务器上限，请缩短时间范围或减少指标后重试。已核对的资料预览仍保留。'
          : '家庭服务器暂时没有完成安全整理。已核对的资料预览仍保留，你可以重试或继续复制。'
      );
    } finally {
      setAsking(false);
    }
  };

  const openHistoryAnswer = async (summary: HealthAiAnswerSummary) => {
    setOpeningAnswerId(summary.answer_id);
    setHistoryError('');
    try {
      const stored =
        answer?.answer_id === summary.answer_id
          ? answer
          : await onOpenAiHistory?.(summary.answer_id);
      if (!stored) {
        throw new Error('Saved answer loader is not available');
      }
      setAnswer(stored);
      window.setTimeout(() => {
        const target = document.getElementById('ai-answer-title');
        if (typeof target?.scrollIntoView === 'function') {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
      }, 0);
    } catch {
      setHistoryError('这条历史回答暂时无法打开，请稍后重试。');
    } finally {
      setOpeningAnswerId(null);
    }
  };

  const deleteHistoryAnswer = async (summary: HealthAiAnswerSummary) => {
    if (pendingDeleteId !== summary.answer_id) {
      setPendingDeleteId(summary.answer_id);
      return;
    }
    setDeletingAnswerId(summary.answer_id);
    setHistoryError('');
    try {
      await onDeleteAiHistory?.(summary.answer_id);
      setLocalHistory(current =>
        current.filter(item => item.answer_id !== summary.answer_id)
      );
      if (answer?.answer_id === summary.answer_id) setAnswer(null);
      setPendingDeleteId(null);
    } catch {
      setHistoryError('删除没有完成，历史回答仍然保留。');
    } finally {
      setDeletingAnswerId(null);
    }
  };

  const openCitation = (citationId: string) => {
    const citation = answer?.citations.find(
      item => item.citation_id === citationId
    );
    if (!citation?.available || !onOpenAiCitation) return;
    onOpenAiCitation(citation.metric_id, citation.record_id);
  };

  const copy = async () => {
    if (!handoff || handoff.status !== 'ready') return;
    setCopying(true);
    setCopied(false);
    setCopyError('');
    try {
      if (onPrepareHandoff) {
        await onPrepareHandoff({
          kind: 'clipboard',
          scope: range === '5y' ? 'recent-five-years' : 'all-loaded',
          includeReports: false,
          metricCount: handoff.selectedMetricCount,
          reportCount: 0,
        });
      }
      try {
        await navigator.clipboard.writeText(handoffText);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = handoffText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopied(true);
    } catch {
      setCopyError('未能完成本地复制，资料预览仍保留，请稍后重试。');
    } finally {
      setCopying(false);
    }
  };

  return (
    <section className="hhp-page hhp-assistant-page" aria-labelledby="ai-title">
      <div className="hhp-page-heading hhp-ai-page-heading">
        <div>
          <p className="hhp-eyebrow">基于本人正式结构化档案</p>
          <h1 id="ai-title">AI 提问</h1>
          <p className="hhp-page-intro">
            先核对问题范围和引用。所有问题都可生成、复制资料；站内只安全整理“最近有哪些变化”。
          </p>
        </div>
      </div>

      <article
        className={`hhp-ai-provider-status ${connected ? 'is-connected' : ''}`}
        role="status"
      >
        <span>
          <IconDatabase size={23} />
        </span>
        <div>
          <strong>{connected ? connectedTitle : '站内模型尚未配置'}</strong>
          <p>
            {connected
              ? capabilityIsTest
                ? '虚构数据动态测试·非模型回答。只有点击运行测试后，家庭服务器才会读取本次所选记录 ID；测试提供方不会推断诊断或风险。'
                : `${aiCapability?.processing_location}。站内只回答最近变化；具体模型配置仅管理员可见，只有通过结构、引用和只读安全检查的回答才会展示并进入独立历史。`
              : '当前功能不会生成模型回答，也不会自动发送资料；它只在本地生成可核对的提问资料包。'}
          </p>
        </div>
      </article>

      <article className="hhp-ai-history-card">
        <button
          type="button"
          className="hhp-ai-history-toggle"
          aria-label="查看最近的家庭服务器整理结果"
          aria-expanded={historyOpen}
          aria-controls="hhp-ai-history-list"
          onClick={() => {
            setHistoryOpen(value => !value);
            setPendingDeleteId(null);
            setHistoryError('');
          }}
        >
          <span className="hhp-ai-history-icon">
            <IconHistory size={22} />
          </span>
          <span>
            <strong>最近的整理结果</strong>
            <small>首批读取 20 条，可继续加载全部；每条可随时删除</small>
          </span>
          <em>
            {aiHistoryLoading && localHistory.length === 0
              ? '载入中'
              : `${localHistory.length} / ${visibleHistoryTotal} 条`}
          </em>
          <IconChevronDown
            className={historyOpen ? 'is-expanded' : ''}
            size={19}
          />
        </button>
        {historyOpen ? (
          <div id="hhp-ai-history-list" className="hhp-ai-history-list">
            {aiHistoryLoading && localHistory.length === 0 ? (
              <p className="hhp-ai-history-state">正在读取历史回答…</p>
            ) : localHistory.length === 0 && !aiHistoryError ? (
              <p className="hhp-ai-history-state">
                还没有保存的结果。完成一次家庭服务器安全整理后会显示在这里。
              </p>
            ) : localHistory.length > 0 ? (
              localHistory.map(item => (
                <div className="hhp-ai-history-item" key={item.answer_id}>
                  <button
                    type="button"
                    className="hhp-ai-history-open"
                    aria-label={`打开回答：${item.question}`}
                    onClick={() => void openHistoryAnswer(item)}
                    disabled={openingAnswerId === item.answer_id}
                  >
                    <strong>{item.question}</strong>
                    <span>
                      {new Date(item.generated_at).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {item.record_count} 条引用
                      {' · '}
                      {item.test_mode
                        ? '虚构测试·非模型'
                        : '家庭服务器安全整理'}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`hhp-ai-history-delete ${
                      pendingDeleteId === item.answer_id ? 'is-confirming' : ''
                    }`}
                    aria-label={
                      pendingDeleteId === item.answer_id
                        ? `确认删除历史回答：${item.question}`
                        : `删除历史回答：${item.question}`
                    }
                    onClick={() => void deleteHistoryAnswer(item)}
                    disabled={deletingAnswerId === item.answer_id}
                  >
                    <IconTrash size={18} />
                    <span>
                      {deletingAnswerId === item.answer_id
                        ? '删除中'
                        : pendingDeleteId === item.answer_id
                          ? '确认删除'
                          : '删除'}
                    </span>
                  </button>
                </div>
              ))
            ) : null}
            {localHistory.length > 0 ? (
              <p className="hhp-ai-history-pagination-status">
                已显示 {localHistory.length} / 共 {visibleHistoryTotal} 条
              </p>
            ) : null}
            {aiHistoryError ? (
              <div className="hhp-ai-history-load-error" role="alert">
                <p>{aiHistoryError}</p>
                {onRetryAiHistory ? (
                  <button
                    type="button"
                    className="hhp-secondary-button"
                    aria-label="重试读取历史回答"
                    onClick={() => void onRetryAiHistory()}
                  >
                    重试
                  </button>
                ) : null}
              </div>
            ) : hasMoreHistory && onLoadMoreAiHistory ? (
              <div className="hhp-ai-history-pagination">
                <button
                  type="button"
                  className="hhp-secondary-button"
                  aria-label="加载更多历史回答"
                  disabled={aiHistoryLoadingMore}
                  onClick={() => void onLoadMoreAiHistory()}
                >
                  {aiHistoryLoadingMore ? '正在加载…' : '加载更多'}
                </button>
              </div>
            ) : null}
            {historyError ? (
              <p className="hhp-ai-history-error" role="alert">
                {historyError}
              </p>
            ) : null}
          </div>
        ) : null}
      </article>

      <button
        type="button"
        className="hhp-scope-bar"
        onClick={() => setScopeOpen(true)}
      >
        <span>
          <IconFileText size={21} />
          当前本人档案 ·{' '}
          {range === '1y'
            ? '最近 1 年'
            : range === '3y'
              ? '最近 3 年'
              : range === '5y'
                ? '最近 5 年'
                : '全部时间'}{' '}
          · {selectedMetricIds.length} 项指标 · 不含原件
        </span>
        <span>
          调整范围
          <IconChevronRight size={18} />
        </span>
      </button>

      <div className="hhp-ai-badges">
        <span className="is-teal">
          <IconShieldCheck size={18} />
          {connected
            ? capabilityIsTest
              ? '虚构数据动态测试·非模型回答'
              : '家庭服务器安全整理'
            : '本地生成'}
        </span>
        <span>
          <IconLock size={18} />
          只读正式档案 · 回答历史单独保存
        </span>
      </div>

      <div className="hhp-ai-layout">
        <div className="hhp-ai-workspace">
          <div className="hhp-question-grid">
            {LIVE_AI_QUESTIONS.map(item => {
              const Icon = item.icon;
              return (
                <button
                  type="button"
                  key={item.id}
                  className={
                    questionId === item.id && !item.disabled
                      ? 'is-selected'
                      : undefined
                  }
                  onClick={() =>
                    chooseQuestion(item.id, item.prompt, item.disabled)
                  }
                  disabled={item.disabled}
                  aria-label={item.label}
                  aria-describedby={
                    item.disabled ? 'screening-question-limit' : undefined
                  }
                >
                  <Icon size={28} stroke={1.7} />
                  <span>{item.label}</span>
                  {item.disabled ? (
                    <small>暂不可用</small>
                  ) : item.id !== 'recent_changes' ? (
                    <small>仅生成与复制资料</small>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p id="screening-question-limit" className="hhp-ai-screening-limit">
            <IconInfoCircle size={18} />
            “哪些检查可能需要安排”必须先有已发布指南和确定性筛查状态，不能交给模型自行计算。
          </p>
          <div className="hhp-question-box">
            <textarea
              value={question}
              onChange={event => {
                setQuestion(event.target.value);
                if (questionId !== 'term_or_custom') setQuestionId('custom');
                setHandoff(null);
                setCopied(false);
                setAnswer(null);
                setAskError('');
              }}
              placeholder="输入你希望结合资料询问的问题"
              aria-label="准备生成资料包的问题"
              maxLength={1000}
              rows={3}
            />
            <button
              type="button"
              onClick={generate}
              disabled={!question.trim() || selectedMetricIds.length === 0}
            >
              <IconClipboardText size={19} />
              生成提问资料
            </button>
          </div>
          <p className="hhp-ai-note">
            <IconInfoCircle size={18} />
            资料包默认排除姓名、联系方式、原件、文件名、正文和服务器路径
          </p>

          {handoff?.status === 'blocked' ? (
            <div className="hhp-ai-handoff-blocked" role="alert">
              <IconAlertTriangle size={20} />
              <div>
                <strong>暂时无法生成资料包</strong>
                <p>{handoff.limitations[0]}</p>
              </div>
            </div>
          ) : null}

          {handoff?.status === 'ready' ? (
            <article className="hhp-ai-handoff-card">
              <div className="hhp-ai-handoff-heading">
                <div>
                  <p className="hhp-section-label">复制前核对</p>
                  <h2>提问资料预览</h2>
                </div>
                <span>{handoff.observations.length} 条引用记录</span>
              </div>
              <div className="hhp-ai-handoff-summary">
                <span>当前本人档案</span>
                <span>{handoff.rangeLabel}</span>
                <span>截止 {handoff.dataCutoff}</span>
              </div>
              {handoff.omittedObservationCount > 0 ? (
                <div className="hhp-export-warning" role="status">
                  <IconInfoCircle size={18} />
                  <span>
                    当前范围已加载 {handoff.totalObservationCount}{' '}
                    条记录。为符合服务端上限，本次优先保留各指标最新记录；若指标数超过
                    200，则只保留最新记录日期较近的 200 项，再按时间补齐到{' '}
                    {handoff.observations.length}{' '}
                    条；可缩短时间范围或减少指标继续提问。
                  </span>
                </div>
              ) : null}
              <pre tabIndex={0}>{handoffText}</pre>
              {copyError ? (
                <div className="hhp-export-warning" role="alert">
                  <IconAlertTriangle size={18} />
                  <span>{copyError}</span>
                </div>
              ) : null}
              {askError ? (
                <div className="hhp-export-warning" role="alert">
                  <IconAlertTriangle size={18} />
                  <span>{askError}</span>
                </div>
              ) : null}
              <div className="hhp-ai-handoff-actions">
                {canRunHandoffOnServer ? (
                  <button
                    type="button"
                    className="hhp-ai-analyze-button"
                    onClick={() => void ask()}
                    disabled={asking}
                  >
                    <IconSparkles size={20} />
                    {asking
                      ? capabilityIsTest
                        ? '正在运行虚构数据动态测试…'
                        : '家庭服务器正在安全整理…'
                      : analyzeLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="hhp-ai-copy-button"
                  onClick={() => void copy()}
                  disabled={copying}
                >
                  {copied ? <IconCheck size={20} /> : <IconCopy size={20} />}
                  {copying
                    ? '正在复制…'
                    : copied
                      ? '已复制到剪贴板'
                      : '复制提问资料'}
                </button>
              </div>
              <p className="hhp-answer-limit">
                {canRunHandoffOnServer
                  ? '家庭服务器只读取上方引用记录，不读取原件、正文、身份信息、指南或其他成员档案；通过检查的回答只进入独立 AI 历史，手机和浏览器不会获得档案写权限。'
                  : '复制后资料将离开本系统；请在发送前再次确认目标 AI 的隐私、保留和地区政策。'}
              </p>
            </article>
          ) : null}

          {answer ? (
            <article
              className="hhp-ai-answer-card"
              aria-labelledby="ai-answer-title"
            >
              <div className="hhp-ai-answer-heading">
                <span>
                  <IconSparkles size={22} />
                </span>
                <div>
                  <p className="hhp-section-label">只读回答</p>
                  <h2 id="ai-answer-title">
                    {activeAnswerIsTest
                      ? '虚构数据动态测试结果'
                      : '家庭服务器安全整理结果'}
                  </h2>
                  <small>
                    {activeAnswerIsTest
                      ? '虚构数据动态测试·非模型回答'
                      : '家庭服务器模型生成·已通过引用与只读安全检查'}{' '}
                    · 数据截止 {answer.scope.data_cutoff}
                  </small>
                </div>
              </div>
              <section>
                <h3>简明回答</h3>
                {answer.answer_items.map((item, index) => (
                  <p key={`${item.text}-${index}`}>
                    {item.text}{' '}
                    <span className="hhp-ai-inline-citations">
                      {item.citation_ids.map(id => `[${id}]`).join(' ')}
                    </span>
                  </p>
                ))}
              </section>
              {answer.general_explanations.length > 0 ? (
                <section>
                  <h3>一般说明</h3>
                  <ul>
                    {answer.general_explanations.map(item => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section>
                <h3>使用的个人数据</h3>
                <div className="hhp-ai-citation-list">
                  {answer.citations.map(citation => (
                    <button
                      type="button"
                      key={citation.citation_id}
                      aria-label={`打开 ${citation.citation_id}：${citation.label}正式记录`}
                      onClick={() => openCitation(citation.citation_id)}
                      disabled={!citation.available || !onOpenAiCitation}
                    >
                      <strong>[{citation.citation_id}]</strong>
                      <span>
                        {citation.date} · {citation.label}
                      </span>
                      <small>
                        {citation.value}
                        {citation.secondary_value === null
                          ? ''
                          : `/${citation.secondary_value}`}{' '}
                        {citation.unit}
                        {citation.status ? ` · ${citation.status}` : ''}
                        {!citation.available ? ' · 原记录已不可用' : ''}
                      </small>
                      <IconChevronRight size={18} />
                    </button>
                  ))}
                </div>
              </section>
              {answer.limitations.length > 0 ? (
                <section>
                  <h3>缺失与局限</h3>
                  <ul>
                    {answer.limitations.map(item => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {answer.next_steps.length > 0 ? (
                <section>
                  <h3>可以继续做什么</h3>
                  <ul>
                    {answer.next_steps.map(item => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <p className="hhp-ai-disclaimer">{answer.disclaimer}</p>
            </article>
          ) : null}
        </div>

        <aside className="hhp-answer-includes">
          <h2>资料包会说明</h2>
          {[
            ['问题与时间范围', IconMessageQuestion],
            ['使用的正式记录', IconDatabase],
            ['缺失信息与局限', IconInfoCircle],
            ['默认排除的内容', IconLock],
          ].map(([label, Icon]) => (
            <div key={label as string}>
              <Icon size={22} stroke={1.7} />
              <span>{label as string}</span>
            </div>
          ))}
        </aside>
      </div>

      <AnimatePresence>
        {scopeOpen ? (
          <motion.div
            className="hhp-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="presentation"
            onMouseDown={event => {
              if (event.target === event.currentTarget) setScopeOpen(false);
            }}
          >
            <motion.div
              className="hhp-modal hhp-ai-scope-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="scope-title"
              initial={{ opacity: 0, scale: 0.97, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
            >
              <div className="hhp-modal-heading">
                <div>
                  <p className="hhp-eyebrow">提问范围</p>
                  <h2 id="scope-title">选择进入资料包的记录</h2>
                </div>
                <button
                  type="button"
                  className="hhp-icon-button"
                  aria-label="关闭"
                  onClick={() => setScopeOpen(false)}
                >
                  <IconX size={22} />
                </button>
              </div>
              <label className="hhp-field">
                <span>时间范围</span>
                <select
                  value={range}
                  onChange={event => {
                    setRange(event.target.value as HouseholdAiRange);
                    setHandoff(null);
                    setCopied(false);
                    setAnswer(null);
                    setAskError('');
                  }}
                >
                  <option value="1y">最近 1 年</option>
                  <option value="3y">最近 3 年</option>
                  <option value="5y">最近 5 年</option>
                  <option value="all">全部时间</option>
                </select>
              </label>
              <fieldset className="hhp-ai-metric-scope">
                <legend>结构化指标</legend>
                {experience.snapshot.metrics.map(metric => (
                  <label key={metric.id}>
                    <input
                      type="checkbox"
                      checked={selectedMetricIds.includes(metric.id)}
                      onChange={event => {
                        setSelectedMetricIds(current =>
                          event.target.checked
                            ? [...current, metric.id]
                            : current.filter(id => id !== metric.id)
                        );
                        setHandoff(null);
                        setCopied(false);
                        setAnswer(null);
                        setAskError('');
                      }}
                    />
                    <span>
                      <strong>{metric.label}</strong>
                      <small>{metric.points.length} 条正式观测</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <div className="hhp-ai-locked-scope">
                <IconLock size={19} />
                <div>
                  <strong>报告原件、文件名和正文固定排除</strong>
                  <small>本阶段没有开启原件外发或站内模型读取权限</small>
                </div>
              </div>
              <button
                type="button"
                className="hhp-modal-primary"
                onClick={() => setScopeOpen(false)}
                disabled={
                  selectedMetrics.length === 0 &&
                  experience.snapshot.metrics.length > 0
                }
              >
                保存范围
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function AssistantPage() {
  const { experience } = useHouseholdHealthExperience();
  if (
    !experience.capabilities.canUseAi ||
    !experience.capabilities.canCopyForAi
  ) {
    return null;
  }
  return <LiveAssistantPage />;
}

function ExportPage() {
  const { experience, onOpenFullExport, onPrepareHandoff } =
    useHouseholdHealthExperience();
  const [scope, setScope] =
    useState<HouseholdHealthExportScope>('recent-five-years');
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>(() =>
    experience.snapshot.metrics.map(metric => metric.id)
  );
  const [includeReports, setIncludeReports] = useState(true);
  const [copied, setCopied] = useState(false);
  const [handoffPending, setHandoffPending] =
    useState<HouseholdHealthHandoffKind | null>(null);
  const [handoffError, setHandoffError] = useState('');
  const [generatedAt] = useState(() => new Date().toISOString());
  const model = useMemo(
    () =>
      buildHouseholdHealthExportModel(
        experience.subject?.label || '未命名成员',
        experience.snapshot,
        {
          scope,
          metricIds: selectedMetricIds,
          includeReports,
        },
        generatedAt
      ),
    [
      experience.snapshot,
      experience.subject?.label,
      generatedAt,
      includeReports,
      scope,
      selectedMetricIds,
    ]
  );
  const hasOutput = model.observations.length > 0 || model.reports.length > 0;

  if (!experience.capabilities.canExport) return null;

  const prepareHandoff = async (kind: HouseholdHealthHandoffKind) => {
    if (!experience.capabilities.canExport) {
      throw new Error('Export is not allowed for this archive');
    }
    if (!onPrepareHandoff) return;
    await onPrepareHandoff({
      kind,
      scope,
      includeReports,
      metricCount: selectedMetricIds.length,
      reportCount: model.reports.length,
    });
  };

  const runHandoff = async (
    kind: HouseholdHealthHandoffKind,
    action: () => void | Promise<void>
  ) => {
    setHandoffPending(kind);
    setHandoffError('');
    try {
      await prepareHandoff(kind);
      await action();
    } catch {
      setHandoffError('未能记录本次数据交接，已停止导出。');
    } finally {
      setHandoffPending(null);
    }
  };

  const downloadCsv = () =>
    runHandoff('csv', () => {
      downloadBlob(
        new Blob([renderHouseholdHealthExportCsv(model)], {
          type: 'text/csv;charset=utf-8',
        }),
        buildHouseholdHealthExportFilename(model.generatedAt)
      );
    });
  const copySummary = () =>
    runHandoff('clipboard', async () => {
      const content = renderHouseholdHealthExportText(model);
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopied(true);
    });
  const printSummary = () =>
    runHandoff('print', () => {
      window.print();
    });
  const scopeOptions: Array<{
    value: HouseholdHealthExportScope;
    title: string;
    detail: string;
    disabled?: boolean;
  }> = [
    {
      value: 'recent-five-years',
      title: '最近 5 年摘要',
      detail: '以最新已加载记录为终点，保留包含边界日期的数据',
    },
    {
      value: 'all-loaded',
      title: '全部面板数据',
      detail: '导出当前页面已加载的所有趋势观测和报告来源',
    },
    {
      value: 'latest-report',
      title: '最近一份报告',
      detail: '只保留最近报告及通过来源文档 ID 明确关联的指标',
      disabled: experience.snapshot.reports.length === 0,
    },
  ];

  return (
    <section className="hhp-page" aria-labelledby="export-title">
      <div className="hhp-page-heading">
        <div>
          <p className="hhp-eyebrow">就医、分享与个人留存</p>
          <h1 id="export-title">导出与打印</h1>
        </div>
      </div>
      <div className="hhp-export-layout">
        <article className="hhp-card hhp-export-options">
          <h2>选择材料范围</h2>
          {scopeOptions.map(option => (
            <label
              key={option.value}
              className={`${scope === option.value ? 'is-active' : ''} ${
                option.disabled ? 'is-disabled' : ''
              }`}
            >
              <input
                type="radio"
                name="export-scope"
                value={option.value}
                checked={scope === option.value}
                disabled={option.disabled}
                onChange={() => {
                  setScope(option.value);
                  setCopied(false);
                }}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
              {scope === option.value ? <IconCheck size={20} /> : null}
            </label>
          ))}
          <div className="hhp-export-selection">
            <div>
              <strong>选择指标</strong>
              <button
                type="button"
                onClick={() => {
                  setSelectedMetricIds(
                    selectedMetricIds.length ===
                      experience.snapshot.metrics.length
                      ? []
                      : experience.snapshot.metrics.map(metric => metric.id)
                  );
                  setCopied(false);
                }}
              >
                {selectedMetricIds.length === experience.snapshot.metrics.length
                  ? '全部取消'
                  : '全部选择'}
              </button>
            </div>
            {experience.snapshot.metrics.length > 0 ? (
              experience.snapshot.metrics.map(metric => (
                <label key={metric.id}>
                  <input
                    type="checkbox"
                    checked={selectedMetricIds.includes(metric.id)}
                    onChange={event => {
                      setSelectedMetricIds(current =>
                        event.target.checked
                          ? [...current, metric.id]
                          : current.filter(id => id !== metric.id)
                      );
                      setCopied(false);
                    }}
                  />
                  <span>
                    <strong>{metric.label}</strong>
                    <small>{metric.points.length} 条已加载记录</small>
                  </span>
                </label>
              ))
            ) : (
              <p>当前没有可选择的趋势指标。</p>
            )}
            <label>
              <input
                type="checkbox"
                checked={includeReports}
                onChange={event => {
                  setIncludeReports(event.target.checked);
                  setCopied(false);
                }}
              />
              <span>
                <strong>报告来源清单</strong>
                <small>{experience.snapshot.reports.length} 份已保存原件</small>
              </span>
            </label>
          </div>
        </article>
        <article className="hhp-card hhp-export-preview">
          <div className="hhp-card-heading compact">
            <div>
              <p className="hhp-section-label">输出预览</p>
              <h2>{model.scopeLabel}</h2>
            </div>
            <IconFileText size={24} />
          </div>
          <ul>
            <li>主体：{model.subjectLabel}</li>
            <li>时间：{model.dateRangeLabel}</li>
            <li>
              包含：{model.observations.length} 条指标记录、
              {model.reports.length} 份报告来源
            </li>
            <li>不包含：账号、联系方式、服务器路径或原件文件内容</li>
          </ul>
          {model.sourceErrors.length > 0 ? (
            <div className="hhp-export-warning" role="status">
              <IconAlertTriangle size={18} />
              <span>
                有 {model.sourceErrors.length}{' '}
                个数据分区未完整加载，本次摘要可能不完整。
              </span>
            </div>
          ) : null}
          {handoffError ? (
            <div className="hhp-export-warning" role="alert">
              <IconAlertTriangle size={18} />
              <span>{handoffError}</span>
            </div>
          ) : null}
          {hasOutput ? (
            <div className="hhp-export-table-wrap">
              <table>
                <caption>所选指标记录</caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">指标</th>
                    <th scope="col">结果</th>
                    <th scope="col">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {model.observations.map(item => (
                    <tr key={item.id}>
                      <td>{item.date}</td>
                      <td>{item.metricLabel}</td>
                      <td>
                        {item.displayValue}
                        {item.unit ? ` ${item.unit}` : ''}
                      </td>
                      <td>
                        {item.sourceDocumentId === null
                          ? '未关联原件'
                          : `文档 #${item.sourceDocumentId}`}
                      </td>
                    </tr>
                  ))}
                  {model.reports.map(report => (
                    <tr key={`report-${report.sourceDocumentId}`}>
                      <td>{report.date.slice(0, 10)}</td>
                      <td>{report.title}</td>
                      <td>{report.statusLabel}</td>
                      <td>{report.facility}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="hhp-export-empty">
              至少选择一个有记录的指标或报告来源后再导出。
            </div>
          )}
          <p className="hhp-export-boundary">
            此处只导出当前家庭健康面板已经加载的数据；它不是服务器全部档案的替代品。
          </p>
          <div className="hhp-export-actions">
            <button
              type="button"
              onClick={() => void printSummary()}
              disabled={!hasOutput || handoffPending !== null}
            >
              <IconPrinter size={20} />
              打印 / 保存 PDF
            </button>
            <button
              type="button"
              onClick={() => void downloadCsv()}
              disabled={!hasOutput || handoffPending !== null}
            >
              <IconDownload size={20} />
              下载 CSV
            </button>
            <button
              type="button"
              onClick={() => void copySummary()}
              disabled={!hasOutput || handoffPending !== null}
            >
              {copied ? <IconCheck size={20} /> : <IconCopy size={20} />}
              {copied ? '摘要已复制' : '复制所选摘要'}
            </button>
            {experience.mode === 'live' && onOpenFullExport ? (
              <button type="button" onClick={onOpenFullExport}>
                <IconDownload size={20} />
                打开完整档案导出
              </button>
            ) : null}
          </div>
        </article>
      </div>
    </section>
  );
}

function MorePage({
  onNavigate,
  onOpenPrivacyAccess,
  onOpenAccountSettings,
}: {
  onNavigate: (_page: PageKey) => void;
  onOpenPrivacyAccess?: () => void;
  onOpenAccountSettings?: () => void;
}) {
  const { experience } = useHouseholdHealthExperience();
  return (
    <section className="hhp-page" aria-labelledby="more-title">
      <div className="hhp-page-heading">
        <div>
          <p className="hhp-eyebrow">账号、关系和服务设置</p>
          <h1 id="more-title">我的</h1>
        </div>
      </div>
      <div className="hhp-more-grid">
        {[
          {
            icon: IconBook2,
            title: '身体与筛查资料',
            text: '按身体部位浏览教育资料和权威原链接。',
            page: 'guidance' as const,
            action: undefined,
          },
          {
            icon: IconUsers,
            title: '可查看的档案',
            text: `当前可查看 ${experience.subjects.length} 份结构化档案。`,
            page: null,
            action: () => onNavigate('home'),
          },
          {
            icon: IconShieldCheck,
            title: '关系与隐私',
            text: '查看谁能访问你的面板，以及最近的访问记录。',
            page: null,
            action: onOpenPrivacyAccess,
          },
          {
            icon: IconSettings,
            title: '账号与设备',
            text: '修改密码、管理登录设备和安装到主屏幕。',
            page: null,
            action: onOpenAccountSettings,
          },
        ]
          .filter(item => item.page !== null || item.action !== undefined)
          .map(item => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                className="hhp-card hhp-more-card"
                key={item.title}
                onClick={() => {
                  if (item.page) onNavigate(item.page);
                  else item.action?.();
                }}
              >
                <span>
                  <Icon size={25} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.text}</p>
                </div>
                <IconChevronRight size={20} />
              </button>
            );
          })}
      </div>
      <article className="hhp-card hhp-privacy-summary">
        <IconLock size={26} />
        <div>
          <strong>
            {experience.mode === 'demo' ? '关于这个原型' : '数据与隐私边界'}
          </strong>
          {experience.mode === 'demo' ? (
            <p>
              当前页面只使用完全虚构的数据，不连接正式健康数据库，也不会把内容发送给外部
              AI 服务。
            </p>
          ) : (
            <p>
              当前页面只读取服务器中的正式健康记录；系统不会自动把内容发送给外部
              AI 服务。
            </p>
          )}
        </div>
      </article>
    </section>
  );
}

function ShareModal({
  open,
  onClose,
  initialFormat,
}: {
  open: boolean;
  onClose: () => void;
  initialFormat: 'general' | 'ai';
}) {
  const { experience, onPrepareHandoff } = useHouseholdHealthExperience();
  const [format, setFormat] = useState<'general' | 'ai'>(initialFormat);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [handoffError, setHandoffError] = useState('');
  const canShare = experience.capabilities.canShare === true;
  const canCopyForAi =
    canShare && experience.capabilities.canCopyForAi !== false;

  useEffect(() => {
    if (!open) return;
    setFormat(canCopyForAi ? initialFormat : 'general');
    setCopied(false);
    setCopying(false);
    setHandoffError('');
  }, [canCopyForAi, initialFormat, open]);

  const copy = async () => {
    if (!canShare || (format === 'ai' && !canCopyForAi)) {
      setHandoffError('当前档案未授权复制或分享，操作已停止。');
      return;
    }
    const metricLines = experience.snapshot.metrics.map(metric => {
      const values = metric.points
        .map(point => `${point.date.slice(0, 10)}=${point.value}`)
        .join('；');
      return `${metric.label}${metric.unit ? `（${metric.unit}）` : ''}：${values}`;
    });
    const prefix =
      format === 'ai'
        ? '请仅根据以下正式记录进行资料整理，指出数据缺失与局限，不要给出诊断：'
        : '健康资料摘要：';
    const content = `${prefix}\n${metricLines.join('\n') || '暂无可复制的结构化趋势。'}\n报告原件：${experience.snapshot.reports.length} 份。`;
    setCopying(true);
    setHandoffError('');
    try {
      if (onPrepareHandoff) {
        await onPrepareHandoff({
          kind: 'clipboard',
          scope: 'all-loaded',
          includeReports: false,
          metricCount: experience.snapshot.metrics.length,
          reportCount: experience.snapshot.reports.length,
        });
      }
      try {
        await navigator.clipboard.writeText(content);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopied(true);
    } catch {
      setHandoffError('未能记录本次数据交接，已停止复制。');
    } finally {
      setCopying(false);
    }
  };

  return (
    <AnimatePresence>
      {open && canShare ? (
        <motion.div
          className="hhp-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            className="hhp-modal"
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
          >
            <div className="hhp-modal-heading">
              <div>
                <p className="hhp-eyebrow">复制前预览</p>
                <h2 id="share-title">复制 / 分享</h2>
              </div>
              <button
                type="button"
                className="hhp-icon-button"
                aria-label="关闭"
                onClick={onClose}
              >
                <IconX size={22} />
              </button>
            </div>
            <div className="hhp-format-switch">
              <button
                type="button"
                className={format === 'general' ? 'is-active' : ''}
                onClick={() => {
                  setFormat('general');
                  setCopied(false);
                }}
              >
                通用数据
              </button>
              {canCopyForAi ? (
                <button
                  type="button"
                  className={format === 'ai' ? 'is-active' : ''}
                  onClick={() => {
                    setFormat('ai');
                    setCopied(false);
                  }}
                >
                  适合发给 AI
                </button>
              ) : null}
            </div>
            <div className="hhp-copy-preview">
              <strong>将包含</strong>
              <p>
                当前档案 · {experience.snapshot.metrics.length} 项趋势 ·{' '}
                {experience.snapshot.reports.length} 份报告来源
              </p>
              <small>默认不含姓名、账号、联系方式、原件和服务器路径。</small>
            </div>
            {handoffError ? (
              <div className="hhp-export-warning" role="alert">
                <IconAlertTriangle size={18} />
                <span>{handoffError}</span>
              </div>
            ) : null}
            <button
              type="button"
              className="hhp-modal-primary"
              onClick={() => void copy()}
              disabled={copying}
            >
              {copied ? <IconCheck size={20} /> : <IconCopy size={20} />}
              {copying
                ? '正在记录本次交接…'
                : copied
                  ? '已复制到剪贴板'
                  : '确认复制'}
            </button>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export interface HouseholdHealthPrototypeProps extends Omit<
  HouseholdHealthExperienceActions,
  'loading'
> {
  experience?: HouseholdHealthExperienceModel;
  loading?: boolean;
  dashboardPreferences?: HouseholdHealthDashboardPreferences | null;
  onDashboardPreferencesChange?: (
    _preferences: HouseholdHealthDashboardPreferences
  ) => void;
  onOpenPrivacyAccess?: () => void;
  onOpenAccountSettings?: () => void;
  page?: PageKey;
  onPageChange?: (_page: PageKey) => void;
}

export default function HouseholdHealthPrototype({
  experience,
  loading = false,
  aiCapability,
  aiHistory: controlledAiHistory,
  aiHistoryLoading = false,
  aiHistoryLoadingMore = false,
  aiHistoryTotal,
  aiHistoryError = '',
  onSubjectChange,
  onUpload,
  onExport,
  onOpenDetails,
  onParseReport,
  onDownloadReport,
  onPreviewReport,
  onPrepareHandoff,
  onAskAi,
  onOpenAiHistory,
  onDeleteAiHistory,
  onLoadMoreAiHistory,
  onRetryAiHistory,
  onMetricRevisionSaved,
  onRetry,
  dashboardPreferences,
  onDashboardPreferencesChange,
  onOpenPrivacyAccess,
  onOpenAccountSettings,
  page: controlledPage,
  onPageChange,
}: HouseholdHealthPrototypeProps = {}) {
  const [internalActivePage, setInternalActivePage] = useState<PageKey>('home');
  const requestedPage = controlledPage ?? internalActivePage;
  const setActivePage = (nextPage: PageKey) => {
    if (controlledPage === undefined) setInternalActivePage(nextPage);
    onPageChange?.(nextPage);
  };
  const [archiveMetricId, setArchiveMetricId] = useState<string | null>(null);
  const [archiveRecordId, setArchiveRecordId] = useState<string | null>(null);
  const [demoSubjectId, setDemoSubjectId] = useState(
    DEMO_EXPERIENCE.subject?.id ?? 1
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFormat, setShareFormat] = useState<'general' | 'ai'>('general');
  const [uploadMessage, setUploadMessage] = useState('');
  const [demoUploadOpen, setDemoUploadOpen] = useState(false);
  const [demoParseTask, setDemoParseTask] =
    useState<HealthSourceParseTask | null>(null);
  const [demoReviewBatch, setDemoReviewBatch] =
    useState<HealthImportBatch | null>(null);
  const [dashboardBySubject, setDashboardBySubject] = useState<
    Record<string, HouseholdHealthDashboardPreferences>
  >({});
  const [localAiHistoryBySubject, setLocalAiHistoryBySubject] = useState<
    Record<string, HealthAiAnswerSummary[]>
  >({});
  const [localAiAnswersBySubject, setLocalAiAnswersBySubject] = useState<
    Record<string, Record<number, HealthAiQuestionResponse>>
  >({});
  const [demoFormalMetricHistory, setDemoFormalMetricHistory] = useState<
    Record<number, HealthFormalMetricRevisionHistory>
  >({});
  const previewView =
    !experience && import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get('view')
      : null;
  const aiHandoffPreview =
    previewView === 'ai-handoff' || previewView === 'ai-connected';
  const aiConnectedPreview = previewView === 'ai-connected';
  const uploadRecoveryPreview = previewView === 'upload-recovery';
  const demoMetrics = DEMO_EXPERIENCE.snapshot.metrics.map(metric => ({
    ...metric,
    points: metric.points.map(point => {
      if (point.componentId == null) return point;
      const current = demoFormalMetricHistory[point.componentId]?.revisions[0];
      if (!current || current.result_type !== 'quantitative') return point;
      return {
        ...point,
        value: current.numeric_value ?? point.value,
        status: current.result_status ?? point.status,
      };
    }),
  }));
  const demoBaseExperience: HouseholdHealthExperienceModel = {
    ...DEMO_EXPERIENCE,
    snapshot: {
      ...DEMO_EXPERIENCE.snapshot,
      metrics: demoMetrics,
    },
    ...(aiHandoffPreview
      ? {
          mode: 'live' as const,
          accessNotice:
            '开发验收模式：仅使用完全虚构数据，模拟正式本人 AI 提问资料交接。',
        }
      : {}),
  };
  const demoSubject =
    demoBaseExperience.subjects.find(subject => subject.id === demoSubjectId) ??
    demoBaseExperience.subject;
  const demoSubjectIsOwner = demoSubject?.relationshipLabel === '我的档案';
  const resolvedExperience = experience ?? {
    ...demoBaseExperience,
    subject: demoSubject,
    snapshot: demoSubjectIsOwner
      ? demoBaseExperience.snapshot
      : {
          ...demoBaseExperience.snapshot,
          reports: [],
        },
    capabilities: demoSubjectIsOwner
      ? demoBaseExperience.capabilities
      : {
          canUpload: false,
          canExport: false,
          canUseAi: false,
          canViewSources: false,
          canReviseMetrics: false,
          canDownloadSources: false,
          canPreviewSources: false,
          canCopyForAi: false,
          canShare: false,
        },
    accessNotice: demoSubjectIsOwner
      ? demoBaseExperience.accessNotice
      : '共享档案只展示结构化指标与趋势，不包含报告原件、文字描述、导出、修改、资料包复制或家庭服务器整理。',
  };
  const assistantAllowed = Boolean(
    resolvedExperience.capabilities.canUseAi &&
    resolvedExperience.capabilities.canCopyForAi
  );
  const exportAllowed = Boolean(resolvedExperience.capabilities.canExport);
  const protectedPageDenied =
    (requestedPage === 'assistant' && !assistantAllowed) ||
    (requestedPage === 'export' && !exportAllowed);
  const activePage = protectedPageDenied ? ('home' as const) : requestedPage;
  useEffect(() => {
    if (
      !loading &&
      ((controlledPage === 'assistant' && !assistantAllowed) ||
        (controlledPage === 'export' && !exportAllowed))
    ) {
      onPageChange?.('home');
    }
  }, [assistantAllowed, controlledPage, exportAllowed, loading, onPageChange]);
  const dashboardSubjectKey = String(
    resolvedExperience.subject?.id ?? 'missing'
  );
  const usesControlledDashboardPreferences = dashboardPreferences !== undefined;
  const storedDashboard = usesControlledDashboardPreferences
    ? dashboardPreferences
    : dashboardBySubject[dashboardSubjectKey];
  const availableMetricIds = new Set(
    resolvedExperience.snapshot.metrics.map(metric => metric.id)
  );
  const dashboard: HouseholdHealthDashboardPreferences = {
    pinnedMetricIds: normalizePinnedHouseholdMetricIds(
      resolvedExperience.snapshot.metrics,
      storedDashboard?.pinnedMetricIds ??
        getDefaultPinnedHouseholdMetricIds(resolvedExperience.snapshot.metrics)
    ),
    rangesByMetricId: Object.fromEntries(
      Object.entries(storedDashboard?.rangesByMetricId ?? {}).filter(
        ([metricId]) => availableMetricIds.has(metricId)
      )
    ),
  };
  const memberLabel = resolvedExperience.subject?.label || '当前成员';
  const resolvedPreviewReport =
    onPreviewReport ??
    (resolvedExperience.mode === 'demo' ? loadDemoSourcePreview : undefined);
  const resolvedDownloadReport =
    onDownloadReport ??
    (resolvedExperience.mode === 'demo'
      ? (sourceDocumentId: number) => {
          const report = resolvedExperience.snapshot.reports.find(
            item => item.sourceDocumentId === sourceDocumentId
          );
          void loadDemoSourcePreview().then(blob =>
            downloadBlob(blob, `${report?.title || '报告原件'}-预览示意.png`)
          );
        }
      : undefined);
  const resolvedAiCapability =
    aiCapability ??
    (aiConnectedPreview
      ? {
          available: true,
          provider: 'dynamic_test',
          model: '规则测试器（非模型）',
          processing_location: '家庭服务器处理',
          reason_code: null,
          test_mode: true,
          processing_mode: 'test',
          local_handoff_available: true,
          supported_question_ids: ['recent_changes'],
          screening_question_available: false,
        }
      : null);
  const baseOnAskAi =
    onAskAi ??
    (aiConnectedPreview
      ? async (
          input: HealthAiQuestionInput
        ): Promise<HealthAiQuestionResponse> => {
          const selected = input.record_ids
            .map(recordId => {
              for (const metric of resolvedExperience.snapshot.metrics) {
                const point = metric.points.find(item => item.id === recordId);
                if (point) return { metric, point };
              }
              return null;
            })
            .filter(
              (
                item
              ): item is {
                metric: HouseholdHealthMetric;
                point: HouseholdHealthPoint;
              } => item !== null
            )
            .sort(
              (left, right) =>
                left.metric.id.localeCompare(right.metric.id) ||
                left.point.date.localeCompare(right.point.date) ||
                left.point.id.localeCompare(right.point.id)
            );
          const citations = selected.map(({ metric, point }, index) => ({
            citation_id: `R${index + 1}`,
            record_id: point.id,
            metric_id: metric.id,
            label: metric.label,
            date: point.date.slice(0, 10),
            value: point.value,
            secondary_value: point.secondaryValue,
            unit: metric.unit,
            status:
              point.status === 'normal'
                ? '正常'
                : point.status === 'high'
                  ? '偏高'
                  : point.status === 'low'
                    ? '偏低'
                    : point.status,
            available: true,
          }));
          const dataCutoff =
            citations
              .map(item => item.date)
              .sort()
              .at(-1) ?? '暂无';
          return {
            status: 'answered',
            answer_id: 9001,
            request_id: 'synthetic-browser-preview',
            patient_id: resolvedExperience.subject?.id ?? 1,
            question_id: input.question_id,
            question: input.question,
            generated_at: new Date().toISOString(),
            scope: {
              range: input.range,
              record_count: citations.length,
              metric_count: new Set(selected.map(item => item.metric.id)).size,
              data_cutoff: dataCutoff,
              includes_originals: false,
              includes_narrative_background: false,
              includes_guidance: false,
              includes_screening_state: false,
            },
            processing: {
              provider: 'dynamic_test',
              model: '规则测试器（非模型）',
              processing_location: '家庭服务器处理',
              test_mode: true,
              processing_mode: 'test',
              template_version: 'household-ai-answer@1.0.0',
            },
            answer_items: buildDynamicSyntheticPreviewAnswerItems(citations),
            general_explanations: [
              '不同时间、机构或检测方法的结果需要结合原始参考范围理解。',
            ],
            citations,
            limitations: [
              '当前回答只使用本次勾选的结构化记录，没有读取报告正文或叙述性病史。',
            ],
            next_steps: [
              '就医时可以携带这些记录，请医生判断是否需要采用同一方法复查。',
            ],
            disclaimer:
              '这是完全虚构数据生成的界面验收结果，不构成诊断或治疗建议。',
          };
        }
      : undefined);
  const usesControlledAiHistory = controlledAiHistory !== undefined;
  const resolvedAiHistory = usesControlledAiHistory
    ? controlledAiHistory
    : (localAiHistoryBySubject[dashboardSubjectKey] ?? []);
  const resolvedAiHistoryTotal = usesControlledAiHistory
    ? (aiHistoryTotal ?? resolvedAiHistory.length)
    : resolvedAiHistory.length;
  const resolvedOnAskAi = baseOnAskAi
    ? async (input: HealthAiQuestionInput) => {
        const response = await baseOnAskAi(input);
        if (!usesControlledAiHistory) {
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
          setLocalAiAnswersBySubject(current => ({
            ...current,
            [dashboardSubjectKey]: {
              ...(current[dashboardSubjectKey] ?? {}),
              [response.answer_id]: response,
            },
          }));
          setLocalAiHistoryBySubject(current => ({
            ...current,
            [dashboardSubjectKey]: [
              summary,
              ...(current[dashboardSubjectKey] ?? []).filter(
                item => item.answer_id !== summary.answer_id
              ),
            ],
          }));
        }
        return response;
      }
    : undefined;
  const resolvedOnOpenAiHistory =
    onOpenAiHistory ??
    (!usesControlledAiHistory
      ? async (answerId: number) => {
          const answer =
            localAiAnswersBySubject[dashboardSubjectKey]?.[answerId];
          if (!answer) {
            throw new Error('这条回答已不存在，请刷新后重试。');
          }
          return answer;
        }
      : undefined);
  const resolvedOnDeleteAiHistory =
    onDeleteAiHistory ??
    (!usesControlledAiHistory
      ? async (answerId: number) => {
          setLocalAiAnswersBySubject(current => {
            const answers = { ...(current[dashboardSubjectKey] ?? {}) };
            delete answers[answerId];
            return {
              ...current,
              [dashboardSubjectKey]: answers,
            };
          });
          setLocalAiHistoryBySubject(current => ({
            ...current,
            [dashboardSubjectKey]: (current[dashboardSubjectKey] ?? []).filter(
              item => item.answer_id !== answerId
            ),
          }));
        }
      : undefined);
  const resolvedLoadFormalMetricRevisions = experience
    ? undefined
    : async (componentId: number, signal?: AbortSignal) => {
        if (signal?.aborted) throw new Error('请求已取消');
        const existing = demoFormalMetricHistory[componentId];
        if (existing) return existing;
        const history = createDemoFormalMetricHistory(componentId);
        setDemoFormalMetricHistory(current => ({
          ...current,
          [componentId]: current[componentId] ?? history,
        }));
        return history;
      };
  const resolvedCreateFormalMetricRevision = experience
    ? undefined
    : async (componentId: number, input: HealthFormalMetricRevisionRequest) => {
        const history =
          demoFormalMetricHistory[componentId] ??
          createDemoFormalMetricHistory(componentId);
        const currentRevision = history.revisions[0];
        if (currentRevision.id !== input.expected_current_revision_id) {
          throw new Error('这条记录已经更新，请重新打开');
        }
        const nextRevision = {
          id: currentRevision.id + 1,
          component_id: componentId,
          patient_id: history.patient_id,
          version: currentRevision.version + 1,
          action: 'revised' as const,
          supersedes_revision_id: currentRevision.id,
          reason: input.reason,
          ...input.result,
          created_by_user_id: 1,
          created_at: new Date().toISOString(),
        };
        const nextHistory: HealthFormalMetricRevisionHistory = {
          ...history,
          current_revision_id: nextRevision.id,
          revisions: [nextRevision, ...history.revisions],
        };
        setDemoFormalMetricHistory(current => ({
          ...current,
          [componentId]: nextHistory,
        }));
        return nextHistory;
      };

  const title = useMemo(() => PAGE_LABELS[activePage], [activePage]);
  const navigate = (page: PageKey) => {
    setArchiveMetricId(null);
    setArchiveRecordId(null);
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openArchiveMetric = (metricId: string, recordId?: string) => {
    setArchiveMetricId(metricId);
    setArchiveRecordId(recordId ?? null);
    setActivePage('archive');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const openShare = (format: 'general' | 'ai' = 'general') => {
    if (
      !resolvedExperience.capabilities.canShare ||
      (format === 'ai' && !resolvedExperience.capabilities.canCopyForAi)
    ) {
      return;
    }
    setShareFormat(format);
    setShareOpen(true);
  };
  const openUpload = () => {
    if (onUpload) {
      onUpload();
      return;
    }
    setDemoUploadOpen(true);
  };
  const openReportParse = (sourceDocumentId: number) => {
    if (resolvedExperience.mode !== 'demo') {
      if (onParseReport) {
        onParseReport(sourceDocumentId);
      } else {
        onOpenDetails?.('sources');
      }
      return;
    }
    const report = resolvedExperience.snapshot.reports.find(
      item => item.sourceDocumentId === sourceDocumentId
    );
    if (
      report?.processingAction === 'review_batch' ||
      report?.processingAction === 'view_history'
    ) {
      setDemoReviewBatch(createDemoReviewBatch(sourceDocumentId));
      return;
    }
    setDemoParseTask(createDemoParseTask(sourceDocumentId));
  };
  const changeSubject = (subjectId: number) => {
    if (!experience) setDemoSubjectId(subjectId);
    onSubjectChange?.(subjectId);
    setArchiveMetricId(null);
    setArchiveRecordId(null);
    setShareOpen(false);
    setActivePage('home');
  };
  const commitDashboardPreferences = (
    nextPreferences: HouseholdHealthDashboardPreferences
  ) => {
    if (usesControlledDashboardPreferences) {
      onDashboardPreferencesChange?.(nextPreferences);
      return;
    }
    setDashboardBySubject(current => ({
      ...current,
      [dashboardSubjectKey]: nextPreferences,
    }));
  };
  const changePinnedMetrics = (metricIds: string[]) => {
    commitDashboardPreferences({
      ...dashboard,
      pinnedMetricIds: normalizePinnedHouseholdMetricIds(
        resolvedExperience.snapshot.metrics,
        metricIds
      ),
    });
  };
  const changeTrendRange = (
    metricId: string,
    range: HouseholdHealthTrendRange
  ) => {
    commitDashboardPreferences({
      ...dashboard,
      rangesByMetricId: {
        ...dashboard.rangesByMetricId,
        [metricId]: range,
      },
    });
  };
  const contextValue: HouseholdHealthExperienceContextValue = {
    experience: resolvedExperience,
    loading,
    dashboard,
    onPinnedMetricsChange: changePinnedMetrics,
    onTrendRangeChange: changeTrendRange,
    onSubjectChange: changeSubject,
    onUpload: openUpload,
    onExport: () => {
      if (resolvedExperience.capabilities.canExport) navigate('export');
    },
    onOpenFullExport: onExport,
    onOpenDetails,
    onParseReport: openReportParse,
    onDownloadReport: resolvedDownloadReport,
    onPreviewReport: resolvedPreviewReport,
    onPrepareHandoff,
    onAskAi: resolvedOnAskAi,
    aiHistory: resolvedAiHistory,
    aiHistoryLoading,
    aiHistoryLoadingMore,
    aiHistoryTotal: resolvedAiHistoryTotal,
    aiHistoryError,
    onOpenAiHistory: resolvedOnOpenAiHistory,
    onDeleteAiHistory: resolvedOnDeleteAiHistory,
    onLoadMoreAiHistory,
    onRetryAiHistory,
    onOpenAiCitation: openArchiveMetric,
    onMetricRevisionSaved,
    loadFormalMetricRevisions: resolvedLoadFormalMetricRevisions,
    createFormalMetricRevision: resolvedCreateFormalMetricRevision,
    aiCapability: resolvedAiCapability,
    onRetry,
  };

  return (
    <HouseholdHealthExperienceContext.Provider value={contextValue}>
      <div
        className="health-prototype"
        data-testid="household-health-prototype"
      >
        <div className="hhp-shell">
          <Sidebar activePage={activePage} onNavigate={navigate} />
          <div className="hhp-workspace">
            <SubjectHeader onMemberChange={changeSubject} />
            {resolvedExperience.accessNotice ? (
              <div className="hhp-access-notice" role="status">
                <IconShieldCheck size={19} />
                <span>{resolvedExperience.accessNotice}</span>
              </div>
            ) : null}
            <main>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activePage}-${resolvedExperience.subject?.id ?? 'none'}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18 }}
                >
                  {activePage === 'home' ? (
                    <HomePage
                      onNavigate={navigate}
                      onOpenMetric={openArchiveMetric}
                      onOpenShare={() => openShare('general')}
                    />
                  ) : null}
                  {activePage === 'archive' ? (
                    <ArchivePage
                      requestedMetricId={archiveMetricId}
                      requestedRecordId={archiveRecordId}
                    />
                  ) : null}
                  {activePage === 'assistant' ? <AssistantPage /> : null}
                  {activePage === 'export' ? (
                    <ExportPage
                      key={`${resolvedExperience.subject?.id ?? 'none'}-${
                        resolvedExperience.snapshot.loadedAt ?? 'loading'
                      }`}
                    />
                  ) : null}
                  {activePage === 'more' ? (
                    <MorePage
                      onNavigate={navigate}
                      onOpenPrivacyAccess={onOpenPrivacyAccess}
                      onOpenAccountSettings={onOpenAccountSettings}
                    />
                  ) : null}
                  {activePage === 'guidance' ? (
                    <ScreeningKnowledgePage onBack={() => navigate('more')} />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>

        <MobileNavigation activePage={activePage} onNavigate={navigate} />
        <ShareModal
          open={shareOpen}
          initialFormat={shareFormat}
          onClose={() => setShareOpen(false)}
        />
        {demoUploadOpen && resolvedExperience.mode === 'demo' ? (
          <HouseholdReportUploadModal
            patientId={resolvedExperience.subject?.id ?? 1}
            subjectLabel={memberLabel}
            onClose={() => setDemoUploadOpen(false)}
            onSaved={() =>
              setUploadMessage('原型演示：原件不会真正上传或保存。')
            }
            startParseTask={async sourceDocumentId =>
              createDemoParseTask(sourceDocumentId)
            }
            serverBatchMode={uploadRecoveryPreview}
            listUploadBatches={
              uploadRecoveryPreview
                ? async () => [await createDemoRecoveryBatch()]
                : undefined
            }
            getUploadBatch={
              uploadRecoveryPreview
                ? async () => createDemoRecoveryBatch()
                : undefined
            }
            completeUploadBatch={
              uploadRecoveryPreview
                ? async () => createDemoRecoveryBatch('completed')
                : undefined
            }
            cancelUploadBatch={
              uploadRecoveryPreview
                ? async () => createDemoRecoveryBatch('cancelled')
                : undefined
            }
            listSimilarityRelations={async () => []}
            reviewSimilarityRelation={async (_relationId, decision) => ({
              ...DEMO_SIMILARITY_RELATION,
              review_status: decision,
              reviewed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })}
            thumbnailSourceDocument={async sourceDocumentId =>
              createDemoSimilarityThumbnail(sourceDocumentId)
            }
            uploadDocument={(_patientId, _input, options) =>
              new Promise(resolve => {
                if (uploadRecoveryPreview) {
                  window.setTimeout(() => {
                    options?.onProgress?.({
                      loaded: 100,
                      total: 100,
                      percent: 100,
                    });
                    resolve({ id: 1 });
                  }, 20);
                  return;
                }
                [18, 46, 73, 92].forEach((percent, index) => {
                  window.setTimeout(
                    () =>
                      options?.onProgress?.({
                        loaded: percent,
                        total: 100,
                        percent,
                      }),
                    180 * (index + 1)
                  );
                });
                window.setTimeout(() => {
                  options?.onProgress?.({
                    loaded: 100,
                    total: 100,
                    percent: 100,
                  });
                  resolve({ id: 1 });
                }, 900);
              })
            }
          />
        ) : null}

        {demoParseTask && resolvedExperience.mode === 'demo' ? (
          <HealthSourceParseModal
            task={demoParseTask}
            opened
            onClose={() => setDemoParseTask(null)}
            onChanged={setDemoParseTask}
            onOpenBatch={async () => {
              setDemoReviewBatch(
                createDemoReviewBatch(demoParseTask.source_document_id)
              );
              setDemoParseTask(null);
            }}
            onManualEntry={() => {
              setDemoParseTask(null);
              setUploadMessage('原型演示：已切换到手工候选录入。');
            }}
            loadReadiness={async () => DEMO_PARSER_READINESS}
          />
        ) : null}

        {demoReviewBatch && resolvedExperience.mode === 'demo' ? (
          <HealthImportReviewModal
            batch={demoReviewBatch}
            opened
            onClose={() => setDemoReviewBatch(null)}
            onChanged={setDemoReviewBatch}
            reviewBatch={async (_batchId, reviews) => {
              const reviewById = new Map(
                reviews.map(review => [review.item_id, review])
              );
              const items = demoReviewBatch.items.map(item => {
                const review = reviewById.get(item.id);
                if (!review) return item;
                return {
                  ...item,
                  ...(review.candidate || {}),
                  decision: review.decision,
                  review_notes: review.review_notes || null,
                };
              });
              const pending = items.filter(
                item => item.decision === 'pending'
              ).length;
              const updated: HealthImportBatch = {
                ...demoReviewBatch,
                items,
                status: pending === 0 ? 'reviewed' : 'pending_review',
                reviewed_at: pending === 0 ? '2026-07-27T07:01:00Z' : null,
                summary: {
                  ...demoReviewBatch.summary,
                  pending,
                  accepted: items.filter(item => item.decision === 'accepted')
                    .length,
                  rejected: items.filter(item => item.decision === 'rejected')
                    .length,
                },
              };
              setDemoReviewBatch(updated);
              return updated;
            }}
            commitBatch={async (_batchId, input) => {
              if (
                !input?.subject_mismatch_confirmation?.acknowledged ||
                input.subject_mismatch_confirmation.target_patient_id !==
                  demoReviewBatch.patient_id
              ) {
                throw new Error('原型演示：请先确认报告对象。');
              }
              const updated: HealthImportBatch = {
                ...demoReviewBatch,
                status: 'committed',
                committed_at: '2026-07-27T07:02:00Z',
                subject_mismatch_warning: {
                  ...demoReviewBatch.subject_mismatch_warning!,
                  confirmation_required: false,
                  confirmed_at: '2026-07-27T07:02:00Z',
                },
              };
              setDemoReviewBatch(updated);
              setUploadMessage('原型演示：已将接受项写入正式记录。');
              return {
                batch: updated,
                created_lab_result_ids: [201],
                created_component_ids: [301, 302],
              };
            }}
            rollbackBatch={async () => {
              const updated: HealthImportBatch = {
                ...demoReviewBatch,
                status: 'rolled_back',
                rolled_back_at: '2026-07-27T07:03:00Z',
              };
              setDemoReviewBatch(updated);
              setUploadMessage('原型演示：该批次创建的正式记录已回滚。');
              return {
                batch: updated,
                deleted_lab_result_ids: [201],
                deleted_component_ids: [301, 302],
              };
            }}
          />
        ) : null}

        <AnimatePresence>
          {uploadMessage ? (
            <motion.div
              className="hhp-toast"
              role="status"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 18 }}
            >
              <IconCheck size={19} />
              <span>{uploadMessage}</span>
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => setUploadMessage('')}
              >
                <IconX size={17} />
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <span className="hhp-sr-only" aria-live="polite">
          当前页面：{title}
        </span>
      </div>
    </HouseholdHealthExperienceContext.Provider>
  );
}
