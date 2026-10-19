export type HouseholdHealthSection = 'vitals' | 'labs' | 'reports';

export interface HouseholdHealthPoint {
  id: string;
  componentId?: number | null;
  date: string;
  value: number;
  secondaryValue: number | null;
  sourceDocumentId: number | null;
  status: string | null;
}

export interface HouseholdHealthMetric {
  id: string;
  kind: 'vital' | 'lab';
  label: string;
  unit: string;
  points: HouseholdHealthPoint[];
  latestStatus: string | null;
}

export type HouseholdReportProcessingState =
  | 'saved'
  | 'processing'
  | 'review_required'
  | 'ready_to_commit'
  | 'committed'
  | 'attention'
  | 'rolled_back'
  | 'withdrawn';

export type HouseholdReportProcessingAction =
  | 'start_parse'
  | 'view_task'
  | 'review_batch'
  | 'view_metrics'
  | 'view_history'
  | 'none';

export interface HouseholdHealthReport {
  id: string;
  sourceDocumentId: number;
  title: string;
  originalFilename: string;
  date: string;
  facility: string;
  typeLabel: string;
  statusLabel: string;
  processingState?: HouseholdReportProcessingState;
  processingHint?: string;
  processingAction?: HouseholdReportProcessingAction;
  processingActionLabel?: string | null;
  parseTaskId?: number | null;
  importBatchId?: number | null;
  sizeLabel: string;
  mimeType: string;
}

export interface HouseholdHealthLoadError {
  section: HouseholdHealthSection;
  message: string;
}

export interface HouseholdHealthSnapshot {
  subjectState: 'ready' | 'missing';
  metrics: HouseholdHealthMetric[];
  reports: HouseholdHealthReport[];
  errors: HouseholdHealthLoadError[];
  loadedAt: string | null;
}

export interface HouseholdHealthSubject {
  id: number;
  label: string;
  relationshipLabel: string;
}

export interface HouseholdHealthCapabilities {
  canUpload: boolean;
  canExport: boolean;
  canUseAi: boolean;
  canViewSources: boolean;
  canReviseMetrics?: boolean;
  canDownloadSources?: boolean;
  canPreviewSources?: boolean;
  canCopyForAi?: boolean;
  canShare?: boolean;
}

export type HouseholdHealthHandoffKind = 'clipboard' | 'csv' | 'print';

export interface HouseholdHealthHandoffRequest {
  kind: HouseholdHealthHandoffKind;
  scope: 'all-loaded' | 'latest-report' | 'recent-five-years';
  includeReports: boolean;
  metricCount: number;
  reportCount: number;
}

export interface HouseholdHealthExperienceModel {
  subject: HouseholdHealthSubject | null;
  subjects: HouseholdHealthSubject[];
  snapshot: HouseholdHealthSnapshot;
  capabilities: HouseholdHealthCapabilities;
  accessNotice?: string;
  mode: 'demo' | 'live';
}
