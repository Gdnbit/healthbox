import type {
  ComponentCatalogResponse,
  TrendResponse,
} from '../../services/api/labTestComponentApi';
import type {
  HealthImportBatch,
  HealthSourceDocument,
  HealthSourceParseTask,
} from '../../services/api/healthImportApi';
import { convertForDisplay } from '../../utils/unitConversion';
import type { VitalRecordLike } from '../../utils/vitalInsights';
import { resolveHouseholdReportProcessing } from './householdReportProcessing';
import type {
  HouseholdHealthLoadError,
  HouseholdHealthMetric,
  HouseholdHealthPoint,
  HouseholdHealthReport,
  HouseholdHealthSnapshot,
} from './types';

type VitalsResponse =
  | VitalRecordLike[]
  | { data?: VitalRecordLike[] | null }
  | null
  | undefined;

export interface HouseholdHealthDataDependencies {
  getVitals: (
    _patientId: number,
    _params?: Record<string, string | number>
  ) => Promise<VitalsResponse>;
  getCatalog: (
    _patientId: number,
    _options?: { limit?: number },
    _signal?: AbortSignal
  ) => Promise<ComponentCatalogResponse>;
  getTrend: (
    _patientId: number,
    _testName: string,
    _options?: { limit?: number; unit?: string | null },
    _signal?: AbortSignal
  ) => Promise<TrendResponse>;
  getSourceDocuments: (
    _patientId: number,
    _signal?: AbortSignal
  ) => Promise<HealthSourceDocument[]>;
  getParseTasks?: (
    _patientId: number,
    _signal?: AbortSignal
  ) => Promise<HealthSourceParseTask[]>;
  getImportBatches?: (
    _patientId: number,
    _signal?: AbortSignal
  ) => Promise<HealthImportBatch[]>;
}

interface VitalDefinition {
  id: string;
  label: string;
  displayUnit: string;
  primaryField: keyof VitalRecordLike;
  secondaryField?: keyof VitalRecordLike;
  conversion?:
    | {
        measurementType: 'weight';
        storageUnit: 'lb';
      }
    | {
        measurementType: 'temperature';
        storageUnit: '°F';
      };
  priority: number;
}

const VITAL_DEFINITIONS: VitalDefinition[] = [
  {
    id: 'blood_pressure',
    label: '血压',
    displayUnit: 'mmHg',
    primaryField: 'systolic_bp',
    secondaryField: 'diastolic_bp',
    priority: 0,
  },
  {
    id: 'weight',
    label: '体重',
    displayUnit: 'kg',
    primaryField: 'weight',
    conversion: {
      measurementType: 'weight',
      storageUnit: 'lb',
    },
    priority: 1,
  },
  {
    id: 'blood_glucose',
    label: '血糖',
    displayUnit: 'mg/dL',
    primaryField: 'blood_glucose',
    priority: 2,
  },
  {
    id: 'a1c',
    label: '糖化血红蛋白',
    displayUnit: '%',
    primaryField: 'a1c',
    priority: 3,
  },
  {
    id: 'heart_rate',
    label: '心率',
    displayUnit: '次/分',
    primaryField: 'heart_rate',
    priority: 4,
  },
  {
    id: 'oxygen_saturation',
    label: '血氧饱和度',
    displayUnit: '%',
    primaryField: 'oxygen_saturation',
    priority: 5,
  },
  {
    id: 'temperature',
    label: '体温',
    displayUnit: '°C',
    primaryField: 'temperature',
    conversion: {
      measurementType: 'temperature',
      storageUnit: '°F',
    },
    priority: 6,
  },
  {
    id: 'respiratory_rate',
    label: '呼吸频率',
    displayUnit: '次/分',
    primaryField: 'respiratory_rate',
    priority: 7,
  },
];

const LAB_PRIORITY_TERMS = [
  '空腹血糖',
  'glucose',
  '低密度脂蛋白',
  'ldl',
  '总胆固醇',
  'cholesterol',
  '甘油三酯',
  'triglyceride',
  '血红蛋白',
  'hemoglobin',
];

const documentTypeLabels: Record<string, string> = {
  checkup: '体检报告',
  laboratory: '检验报告',
  imaging: '影像报告',
  prescription: '处方',
  visit: '就诊资料',
  other: '其他资料',
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const normalizeVitals = (response: VitalsResponse): VitalRecordLike[] => {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.data)) return response.data;
  return [];
};

const toVitalDisplayValue = (
  value: number,
  definition: VitalDefinition
): number | null => {
  if (!definition.conversion) return value;
  return asFiniteNumber(
    convertForDisplay(value, definition.conversion.measurementType, 'metric')
  );
};

const buildVitalMetrics = (response: VitalsResponse): HouseholdHealthMetric[] =>
  VITAL_DEFINITIONS.map(definition => {
    const points = normalizeVitals(response)
      .flatMap(record => {
        const storedValue = asFiniteNumber(record[definition.primaryField]);
        if (storedValue === null || !record.recorded_date) return [];
        const value = toVitalDisplayValue(storedValue, definition);
        if (value === null) return [];
        const secondaryValue = definition.secondaryField
          ? asFiniteNumber(record[definition.secondaryField])
          : null;
        return [
          {
            id: `vital:${definition.id}:${record.id}`,
            date: record.recorded_date,
            value,
            secondaryValue,
            sourceDocumentId: null,
            status: null,
          } satisfies HouseholdHealthPoint,
        ];
      })
      .sort((a, b) => timestamp(a.date) - timestamp(b.date));

    return {
      metric: {
        id: `vital:${definition.id}`,
        kind: 'vital' as const,
        label: definition.label,
        unit: definition.displayUnit,
        points,
        latestStatus: points[points.length - 1]?.status ?? null,
      },
      priority: definition.priority,
    };
  })
    .filter(candidate => candidate.metric.points.length >= 1)
    .sort((a, b) => a.priority - b.priority)
    .map(candidate => candidate.metric);

const labPriority = (label: string): number => {
  const normalized = label.toLocaleLowerCase();
  const index = LAB_PRIORITY_TERMS.findIndex(term =>
    normalized.includes(term.toLocaleLowerCase())
  );
  return index === -1 ? LAB_PRIORITY_TERMS.length : index;
};

const buildLabMetric = (
  entry: ComponentCatalogResponse['items'][number],
  response: TrendResponse
): HouseholdHealthMetric | null => {
  const points = response.data_points
    .flatMap(point => {
      const value = asFiniteNumber(point.value);
      const date =
        point.recorded_date ||
        point.lab_result.completed_date ||
        point.created_at ||
        '';
      if (value === null || !date) return [];
      return [
        {
          id: `lab:${point.id}`,
          componentId: point.id,
          date,
          value,
          secondaryValue: null,
          sourceDocumentId: point.source_document_id ?? null,
          status: point.status ?? null,
        } satisfies HouseholdHealthPoint,
      ];
    })
    .sort((a, b) => timestamp(a.date) - timestamp(b.date));

  if (points.length < 1) return null;
  return {
    id: `lab:${entry.trend_test_name}:${entry.unit ?? ''}`,
    kind: 'lab',
    label: entry.test_name || entry.trend_test_name,
    unit: entry.unit ?? '',
    points,
    latestStatus: points[points.length - 1]?.status ?? entry.status ?? null,
  };
};

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const buildReports = (
  documents: HealthSourceDocument[],
  parseTasks: HealthSourceParseTask[],
  importBatches: HealthImportBatch[]
): HouseholdHealthReport[] =>
  [...documents]
    .sort(
      (a, b) =>
        timestamp(b.report_date || b.created_at) -
        timestamp(a.report_date || a.created_at)
    )
    .map(document => {
      const processing = resolveHouseholdReportProcessing(
        document,
        parseTasks,
        importBatches
      );
      return {
        id: `source:${document.id}`,
        sourceDocumentId: document.id,
        title:
          document.display_name ||
          document.original_filename ||
          `报告原件 #${document.id}`,
        originalFilename:
          document.original_filename || `health-source-${document.id}`,
        date: document.report_date || document.created_at.slice(0, 10),
        facility: document.facility?.trim() || '来源机构未记录',
        typeLabel: documentTypeLabels[document.document_type] || '健康资料',
        statusLabel: processing.label,
        processingState: processing.state,
        processingHint: processing.hint,
        processingAction: processing.action,
        processingActionLabel: processing.actionLabel,
        parseTaskId: processing.parseTaskId,
        importBatchId: processing.importBatchId,
        sizeLabel: formatBytes(document.size_bytes),
        mimeType: document.mime_type,
      };
    });

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const emptyHouseholdHealthSnapshot = (
  subjectState: HouseholdHealthSnapshot['subjectState'] = 'ready'
): HouseholdHealthSnapshot => ({
  subjectState,
  metrics: [],
  reports: [],
  errors: [],
  loadedAt: null,
});

export const loadHouseholdHealthSnapshot = async (
  patientId: number | null,
  dependencies: HouseholdHealthDataDependencies,
  signal?: AbortSignal
): Promise<HouseholdHealthSnapshot> => {
  if (!patientId) return emptyHouseholdHealthSnapshot('missing');

  const [
    vitalsResult,
    catalogResult,
    documentsResult,
    parseTasksResult,
    importBatchesResult,
  ] = await Promise.allSettled([
    dependencies.getVitals(patientId, { limit: 500 }),
    dependencies.getCatalog(patientId, { limit: 500 }, signal),
    dependencies.getSourceDocuments(patientId, signal),
    dependencies.getParseTasks?.(patientId, signal) ?? Promise.resolve([]),
    dependencies.getImportBatches?.(patientId, signal) ?? Promise.resolve([]),
  ]);

  const errors: HouseholdHealthLoadError[] = [];
  const metrics =
    vitalsResult.status === 'fulfilled'
      ? buildVitalMetrics(vitalsResult.value)
      : [];
  if (vitalsResult.status === 'rejected') {
    errors.push({
      section: 'vitals',
      message: messageOf(vitalsResult.reason),
    });
  }

  if (catalogResult.status === 'fulfilled') {
    const candidates = catalogResult.value.items
      .filter(
        entry =>
          entry.result_type !== 'qualitative' &&
          entry.result_type !== 'textual' &&
          entry.reading_count >= 1 &&
          typeof entry.latest_value === 'number'
      )
      .sort(
        (a, b) =>
          labPriority(a.test_name) - labPriority(b.test_name) ||
          b.reading_count - a.reading_count ||
          a.test_name.localeCompare(b.test_name)
      );

    const trends = await Promise.allSettled(
      candidates.map(entry =>
        dependencies.getTrend(
          patientId,
          entry.trend_test_name,
          { limit: 500, unit: entry.unit ?? '' },
          signal
        )
      )
    );
    trends.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const metric = buildLabMetric(candidates[index], result.value);
        if (metric) metrics.push(metric);
      } else {
        errors.push({
          section: 'labs',
          message: messageOf(result.reason),
        });
      }
    });
  } else {
    errors.push({
      section: 'labs',
      message: messageOf(catalogResult.reason),
    });
  }

  const reports =
    documentsResult.status === 'fulfilled'
      ? buildReports(
          documentsResult.value || [],
          parseTasksResult.status === 'fulfilled'
            ? parseTasksResult.value || []
            : [],
          importBatchesResult.status === 'fulfilled'
            ? importBatchesResult.value || []
            : []
        )
      : [];
  if (documentsResult.status === 'rejected') {
    errors.push({
      section: 'reports',
      message: messageOf(documentsResult.reason),
    });
  }
  if (parseTasksResult.status === 'rejected') {
    errors.push({
      section: 'reports',
      message: messageOf(parseTasksResult.reason),
    });
  }
  if (importBatchesResult.status === 'rejected') {
    errors.push({
      section: 'reports',
      message: messageOf(importBatchesResult.reason),
    });
  }

  return {
    subjectState: 'ready',
    metrics,
    reports,
    errors,
    loadedAt: new Date().toISOString(),
  };
};
