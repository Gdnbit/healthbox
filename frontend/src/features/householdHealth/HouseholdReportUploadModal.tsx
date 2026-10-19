/* eslint-disable i18next/no-literal-string -- Chinese-first household upload flow */
import {
  IconAlertTriangle,
  IconCheck,
  IconFile,
  IconFileSearch,
  IconFileTypePdf,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import healthImportApi, {
  type HealthSourceUploadBatch,
  type HealthSourceUploadManifestItem,
  type HealthSourceSimilarityRelation,
  type SourceDocumentUpload,
  type SourceDocumentUploadOptions,
} from '../../services/api/healthImportApi';
import {
  fingerprintHealthUploadFile,
  formatHealthUploadBytes,
  healthUploadKind,
  healthUploadMimeType,
  validateHealthUploadSelection,
  type HealthUploadRejection,
} from './healthUploadValidation';

type QueueStatus = 'queued' | 'uploading' | 'saved' | 'duplicate' | 'error';
type ParseHandoffStatus = 'starting' | 'queued' | 'failed';

interface QueueItem {
  id: string;
  file: File;
  fingerprint: string;
  status: QueueStatus;
  progress: number;
  serverItemId?: number;
  sourceDocumentId?: number;
  parseHandoffStatus?: ParseHandoffStatus;
}

interface HouseholdReportUploadModalProps {
  patientId: number;
  subjectLabel: string;
  onClose: () => void;
  onSaved: () => void;
  uploadDocument?: (
    _patientId: number,
    _input: SourceDocumentUpload,
    _options?: SourceDocumentUploadOptions
  ) => Promise<unknown>;
  startParseTask?: (_sourceDocumentId: number) => Promise<unknown>;
  createUploadBatch?: (
    _patientId: number,
    _input: {
      idempotency_key: string;
      document_type: string;
      report_date?: string;
      facility?: string;
      documents: HealthSourceUploadManifestItem[];
    }
  ) => Promise<HealthSourceUploadBatch>;
  completeUploadBatch?: (_batchId: number) => Promise<HealthSourceUploadBatch>;
  listUploadBatches?: (
    _patientId: number,
    _signal?: AbortSignal
  ) => Promise<HealthSourceUploadBatch[]>;
  getUploadBatch?: (
    _batchId: number,
    _signal?: AbortSignal
  ) => Promise<HealthSourceUploadBatch>;
  cancelUploadBatch?: (_batchId: number) => Promise<HealthSourceUploadBatch>;
  listSimilarityRelations?: (
    _patientId: number,
    _signal?: AbortSignal,
    _reviewStatus?: 'pending' | 'confirmed' | 'dismissed'
  ) => Promise<HealthSourceSimilarityRelation[]>;
  reviewSimilarityRelation?: (
    _relationId: number,
    _decision: 'confirmed' | 'dismissed'
  ) => Promise<HealthSourceSimilarityRelation>;
  thumbnailSourceDocument?: (
    _sourceDocumentId: number,
    _signal?: AbortSignal
  ) => Promise<Blob>;
  operatorContext?: {
    mode: 'delegated';
    label: string;
  };
  serverBatchMode?: boolean;
}

const DOCUMENT_TYPES = [
  { value: 'checkup', label: '体检报告' },
  { value: 'laboratory', label: '检验报告' },
  { value: 'imaging', label: '影像报告' },
  { value: 'visit', label: '就诊资料' },
  { value: 'prescription', label: '处方' },
  { value: 'other', label: '其他资料' },
];

const AUTO_PARSE_DOCUMENT_TYPES = new Set(['checkup', 'laboratory']);

const isServerDuplicate = (error: unknown): boolean =>
  (error instanceof Error ? error.message : String(error)).includes(
    'Duplicate source document'
  );

const clientSha256 = (fingerprint: string): string | undefined => {
  const normalized = fingerprint.replace(/^sha-256:/, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
};

const createClientToken = (prefix: string): string => {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`.slice(0, 64);
};

const sourceDocumentIdFromResult = (result: unknown): number | undefined => {
  if (!result || typeof result !== 'object' || !('id' in result)) {
    return undefined;
  }
  const id = Number(result.id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

const statusText: Record<QueueStatus, string> = {
  queued: '等待保存',
  uploading: '正在保存',
  saved: '原件已保存',
  duplicate: '服务器中已有相同原件，已跳过',
  error: '保存失败，请重试',
};

interface SimilarityThumbnailProps {
  sourceDocumentId: number;
  label: string;
  loadThumbnail: (
    _sourceDocumentId: number,
    _signal?: AbortSignal
  ) => Promise<Blob>;
}

const SimilarityThumbnail = ({
  sourceDocumentId,
  label,
  loadThumbnail,
}: SimilarityThumbnailProps) => {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setFailed(false);
    void loadThumbnail(sourceDocumentId, controller.signal)
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [label, loadThumbnail, sourceDocumentId]);

  return (
    <figure className="hhp-similarity-thumbnail">
      <div>
        {url ? (
          <img src={url} alt={`${label}缩略图`} />
        ) : (
          <span role="status">
            {failed ? '缩略图暂不可用' : '正在生成缩略图…'}
          </span>
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
};

interface SimilarityReviewCardProps {
  relation: HealthSourceSimilarityRelation;
  reviewing: boolean;
  loadThumbnail: SimilarityThumbnailProps['loadThumbnail'];
  onReview: (
    _relation: HealthSourceSimilarityRelation,
    _decision: 'confirmed' | 'dismissed'
  ) => void;
}

const SimilarityReviewCard = ({
  relation,
  reviewing,
  loadThumbnail,
  onReview,
}: SimilarityReviewCardProps) => {
  const isOverlap = relation.relation_type === 'partial_overlap';
  const confidenceLabel =
    relation.confidence >= 0.85 ? '线索较强' : '需要仔细核对';
  return (
    <article className="hhp-similarity-card">
      <header>
        <div>
          <span>{isOverlap ? '局部重叠候选' : '近似整页候选'}</span>
          <strong>
            {isOverlap
              ? '可能存在局部重叠，但两张都可能含有独有区域'
              : '两张看起来像同一页，但仍需要人工确认'}
          </strong>
        </div>
        <small>{confidenceLabel}</small>
      </header>
      <div className="hhp-similarity-thumbnails">
        <SimilarityThumbnail
          sourceDocumentId={relation.source_document_id}
          label={relation.source_display_name}
          loadThumbnail={loadThumbnail}
        />
        <SimilarityThumbnail
          sourceDocumentId={relation.related_source_document_id}
          label={relation.related_display_name}
          loadThumbnail={loadThumbnail}
        />
      </div>
      <p>
        <IconAlertTriangle size={17} />
        <span>
          两份原件都会完整保留。这里仅记录你的判断，不会裁剪、合并、替换或删除。
        </span>
      </p>
      <footer>
        <button
          type="button"
          onClick={() => onReview(relation, 'dismissed')}
          disabled={reviewing}
        >
          不是同一页
        </button>
        <button
          type="button"
          className="is-primary"
          onClick={() => onReview(relation, 'confirmed')}
          disabled={reviewing}
          aria-label={isOverlap ? '确认这两张存在重叠' : '确认这两张是近似整页'}
        >
          {reviewing
            ? '正在记录…'
            : isOverlap
              ? '确认存在重叠'
              : '确认近似整页'}
        </button>
      </footer>
    </article>
  );
};

const HouseholdReportUploadModal = ({
  patientId,
  subjectLabel,
  onClose,
  onSaved,
  uploadDocument,
  createUploadBatch,
  completeUploadBatch,
  listUploadBatches,
  getUploadBatch,
  cancelUploadBatch,
  listSimilarityRelations,
  reviewSimilarityRelation,
  thumbnailSourceDocument,
  operatorContext,
  serverBatchMode,
  startParseTask,
}: HouseholdReportUploadModalProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const batchKeyRef = useRef('');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [rejections, setRejections] = useState<HealthUploadRejection[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [startingParseItemId, setStartingParseItemId] = useState<string | null>(
    null
  );
  const [dragActive, setDragActive] = useState(false);
  const [documentType, setDocumentType] = useState('checkup');
  const canOfferAutomaticParse =
    Boolean(startParseTask) && operatorContext?.mode !== 'delegated';
  const [parseAfterUpload, setParseAfterUpload] = useState(
    canOfferAutomaticParse
  );
  const [reportDate, setReportDate] = useState('');
  const [facility, setFacility] = useState('');
  const [batch, setBatch] = useState<HealthSourceUploadBatch | null>(null);
  const [batchError, setBatchError] = useState('');
  const usesServerBatch = serverBatchMode ?? uploadDocument === undefined;
  const [batchNotice, setBatchNotice] = useState('');
  const [checkingBatches, setCheckingBatches] = useState(usesServerBatch);
  const [historyCheckBlocked, setHistoryCheckBlocked] = useState(false);
  const [recoveredBatch, setRecoveredBatch] = useState(false);
  const [recoveryInitialPreservedCount, setRecoveryInitialPreservedCount] =
    useState(0);
  const [recoverySkippedSavedItemIds, setRecoverySkippedSavedItemIds] =
    useState<number[]>([]);
  const [otherUnfinishedCount, setOtherUnfinishedCount] = useState(0);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [similarityRelations, setSimilarityRelations] = useState<
    HealthSourceSimilarityRelation[]
  >([]);
  const [checkingSimilarity, setCheckingSimilarity] = useState(false);
  const [similarityError, setSimilarityError] = useState('');
  const [similarityNotice, setSimilarityNotice] = useState('');
  const [reviewingSimilarityId, setReviewingSimilarityId] = useState<
    number | null
  >(null);
  const canLoadSimilarity = usesServerBatch || Boolean(listSimilarityRelations);

  const loadSimilarityThumbnail = useCallback(
    (sourceDocumentId: number, signal?: AbortSignal) =>
      thumbnailSourceDocument
        ? thumbnailSourceDocument(sourceDocumentId, signal)
        : healthImportApi.thumbnailSourceDocument(sourceDocumentId, signal),
    [thumbnailSourceDocument]
  );

  const reloadSimilarityRelations = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!canLoadSimilarity || operatorContext?.mode === 'delegated') return;
      setCheckingSimilarity(true);
      try {
        const relations = listSimilarityRelations
          ? await listSimilarityRelations(patientId, signal, 'pending')
          : await healthImportApi.listSourceSimilarityRelations(
              patientId,
              signal,
              'pending'
            );
        if (!signal?.aborted) {
          setSimilarityRelations(
            relations.filter(relation => relation.review_status === 'pending')
          );
          setSimilarityError('');
        }
      } catch {
        if (!signal?.aborted) {
          setSimilarityError(
            '暂时无法读取相似图片待确认项；原件上传和留存不受影响。'
          );
        }
      } finally {
        if (!signal?.aborted) setCheckingSimilarity(false);
      }
    },
    [
      canLoadSimilarity,
      listSimilarityRelations,
      operatorContext?.mode,
      patientId,
    ]
  );

  useEffect(() => {
    if (!canLoadSimilarity || operatorContext?.mode === 'delegated') return;
    const controller = new AbortController();
    void reloadSimilarityRelations(controller.signal);
    return () => controller.abort();
  }, [canLoadSimilarity, operatorContext?.mode, reloadSimilarityRelations]);

  useEffect(() => {
    if (!usesServerBatch) return;
    const controller = new AbortController();
    setCheckingBatches(true);
    const load = listUploadBatches
      ? listUploadBatches(patientId, controller.signal)
      : healthImportApi.listSourceUploadBatches(patientId, controller.signal);
    void load
      .then(batches => {
        if (controller.signal.aborted) return;
        const unfinished = batches.filter(
          candidate =>
            candidate.status === 'open' || candidate.status === 'partial'
        );
        if (unfinished.length > 0) {
          setBatch(unfinished[0]);
          setRecoveredBatch(true);
          setRecoveryInitialPreservedCount(
            unfinished[0].items.filter(
              item => item.status === 'uploaded' || item.status === 'duplicate'
            ).length
          );
          setRecoverySkippedSavedItemIds([]);
          setOtherUnfinishedCount(Math.max(0, unfinished.length - 1));
          setDocumentType(unfinished[0].document_type);
          setReportDate(unfinished[0].report_date || '');
          setFacility(unfinished[0].facility || '');
        }
        setHistoryCheckBlocked(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHistoryCheckBlocked(true);
          setBatchError(
            '暂时无法检查上次上传状态。为避免重复保存，当前不能开始新批次。'
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCheckingBatches(false);
      });
    return () => controller.abort();
  }, [listUploadBatches, patientId, usesServerBatch]);

  const existing = items.map(item => ({
    size: item.file.size,
    fingerprint: item.fingerprint,
  }));
  const uploadable = items.filter(
    item => item.status === 'queued' || item.status === 'error'
  );
  const savedCount = items.filter(item => item.status === 'saved').length;
  const parseQueuedCount = items.filter(
    item => item.parseHandoffStatus === 'queued'
  ).length;
  const parseFailedCount = items.filter(
    item => item.parseHandoffStatus === 'failed'
  ).length;
  const parseTypeEligible = AUTO_PARSE_DOCUMENT_TYPES.has(documentType);
  const shouldParseAfterUpload =
    canOfferAutomaticParse && parseTypeEligible && parseAfterUpload;
  const pendingBatchItems =
    batch?.items.filter(
      item => item.status === 'pending' || item.status === 'failed'
    ) || [];
  const preservedBatchCount =
    batch?.items.filter(
      item => item.status === 'uploaded' || item.status === 'duplicate'
    ).length || 0;
  const queuedServerItemIds = new Set(
    items.map(item => item.serverItemId).filter(Boolean)
  );
  const recoveryRemainingCount = pendingBatchItems.filter(
    item => !queuedServerItemIds.has(item.id)
  ).length;
  const recoveryCanMatch = pendingBatchItems.every(item =>
    Boolean(item.client_sha256)
  );

  const addFiles = async (files: File[]) => {
    if (
      files.length === 0 ||
      preparing ||
      uploading ||
      checkingBatches ||
      historyCheckBlocked ||
      (batch && recoveredBatch && !recoveryCanMatch) ||
      (batch && !recoveredBatch)
    ) {
      return;
    }
    setPreparing(true);
    try {
      const initial = validateHealthUploadSelection(existing, files);
      const fingerprints = new Map<File, string>();
      for (const file of initial.accepted) {
        try {
          fingerprints.set(file, await fingerprintHealthUploadFile(file));
        } catch {
          fingerprints.set(file, '');
        }
      }
      const final = validateHealthUploadSelection(
        existing,
        initial.accepted,
        fingerprints
      );
      const recoveryRejections: HealthUploadRejection[] = [];
      const skippedSavedItemIds: number[] = [];
      const acceptedItems: QueueItem[] = [];
      final.accepted.forEach((file, index) => {
        const fingerprint = fingerprints.get(file) || '';
        if (batch && recoveredBatch) {
          const normalizedSha256 = clientSha256(fingerprint);
          const mimeType = healthUploadMimeType(file);
          const sameFile = (
            candidate: HealthSourceUploadBatch['items'][number]
          ) =>
            Boolean(
              normalizedSha256 &&
              candidate.client_sha256 &&
              candidate.client_sha256 === normalizedSha256 &&
              candidate.original_filename === file.name &&
              candidate.mime_type === mimeType &&
              candidate.size_bytes === file.size
            );
          const matchingItem = batch.items.find(
            candidate =>
              (candidate.status === 'pending' ||
                candidate.status === 'failed') &&
              !queuedServerItemIds.has(candidate.id) &&
              sameFile(candidate)
          );
          if (!matchingItem) {
            const alreadySavedItem = batch.items.find(
              candidate =>
                (candidate.status === 'uploaded' ||
                  candidate.status === 'duplicate') &&
                sameFile(candidate)
            );
            if (alreadySavedItem) {
              skippedSavedItemIds.push(alreadySavedItem.id);
              return;
            }
            recoveryRejections.push({
              fileName: file.name,
              code: 'recovery_mismatch',
              message: '不属于上次未完成清单，已跳过',
            });
            return;
          }
          acceptedItems.push({
            id: matchingItem.client_item_id,
            serverItemId: matchingItem.id,
            file,
            fingerprint,
            status: 'queued',
            progress: 0,
          });
          queuedServerItemIds.add(matchingItem.id);
          return;
        }
        acceptedItems.push({
          id: createClientToken(`file-${index + 1}`),
          file,
          fingerprint,
          status: 'queued',
          progress: 0,
        });
      });
      setRejections([
        ...initial.rejected,
        ...final.rejected,
        ...recoveryRejections,
      ]);
      if (skippedSavedItemIds.length > 0) {
        setRecoverySkippedSavedItemIds(current => [
          ...new Set([...current, ...skippedSavedItemIds]),
        ]);
      }
      setItems(current => [...current, ...acceptedItems]);
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const updateStatus = (id: string, status: QueueStatus, progress?: number) => {
    setItems(current =>
      current.map(item =>
        item.id === id
          ? {
              ...item,
              status,
              progress:
                progress === undefined
                  ? item.progress
                  : Math.min(100, Math.max(0, Math.round(progress))),
            }
          : item
      )
    );
  };

  const updateParseHandoff = (
    id: string,
    status: ParseHandoffStatus,
    sourceDocumentId?: number
  ): void => {
    setItems(current =>
      current.map(item =>
        item.id === id
          ? {
              ...item,
              sourceDocumentId: sourceDocumentId ?? item.sourceDocumentId,
              parseHandoffStatus: status,
            }
          : item
      )
    );
  };

  const queueLocalParse = async (
    itemId: string,
    sourceDocumentId: number
  ): Promise<boolean> => {
    if (!startParseTask) return false;
    updateParseHandoff(itemId, 'starting', sourceDocumentId);
    try {
      await startParseTask(sourceDocumentId);
      updateParseHandoff(itemId, 'queued', sourceDocumentId);
      return true;
    } catch {
      updateParseHandoff(itemId, 'failed', sourceDocumentId);
      return false;
    }
  };

  const saveItem = async (
    item: QueueItem,
    sourceBatch?: HealthSourceUploadBatch,
    serverItemId?: number
  ): Promise<QueueStatus> => {
    updateStatus(item.id, 'uploading', 0);
    try {
      const input: SourceDocumentUpload = {
        file: item.file,
        displayName: item.file.name,
        documentType,
        reportDate: reportDate || undefined,
        facility: facility.trim() || undefined,
        sourceUploadBatchId: sourceBatch?.id,
        sourceUploadItemId: serverItemId,
      };
      const options: SourceDocumentUploadOptions = {
        onProgress: progress => {
          const percent =
            progress.percent ??
            (progress.total > 0
              ? (progress.loaded / progress.total) * 100
              : undefined);
          if (percent !== undefined) {
            updateStatus(item.id, 'uploading', percent);
          }
        },
      };
      const savedDocument = uploadDocument
        ? await uploadDocument(patientId, input, options)
        : await healthImportApi.uploadSourceDocument(patientId, input, options);
      const sourceDocumentId = sourceDocumentIdFromResult(savedDocument);
      updateStatus(item.id, 'saved', 100);
      onSaved();
      if (shouldParseAfterUpload) {
        if (sourceDocumentId) {
          await queueLocalParse(item.id, sourceDocumentId);
        } else {
          updateParseHandoff(item.id, 'failed');
        }
      }
      return 'saved';
    } catch (error) {
      const nextStatus = isServerDuplicate(error) ? 'duplicate' : 'error';
      updateStatus(item.id, nextStatus, nextStatus === 'duplicate' ? 100 : 0);
      return nextStatus;
    }
  };

  const reconcileQueueFromBatch = (
    serverBatch: HealthSourceUploadBatch
  ): void => {
    const serverItems = new Map(serverBatch.items.map(item => [item.id, item]));
    setItems(current =>
      current.map(item => {
        const serverItem = item.serverItemId
          ? serverItems.get(item.serverItemId)
          : undefined;
        if (!serverItem) return item;
        if (serverItem.status === 'uploaded') {
          return { ...item, status: 'saved', progress: 100 };
        }
        if (serverItem.status === 'duplicate') {
          return { ...item, status: 'duplicate', progress: 100 };
        }
        if (serverItem.status === 'failed') {
          return { ...item, status: 'error', progress: 0 };
        }
        return item;
      })
    );
  };

  const finalizeBatch = async (
    sourceBatch: HealthSourceUploadBatch
  ): Promise<void> => {
    const wasRecovered = recoveredBatch || recoveryInitialPreservedCount > 0;
    try {
      const completed = completeUploadBatch
        ? await completeUploadBatch(sourceBatch.id)
        : await healthImportApi.completeSourceUploadBatch(sourceBatch.id);
      setBatch(completed);
      reconcileQueueFromBatch(completed);
      if (completed.status === 'completed') {
        setRecoveredBatch(false);
        if (wasRecovered) {
          const newlyCompletedCount = Math.max(
            0,
            completed.expected_file_count - recoveryInitialPreservedCount
          );
          setBatchNotice(
            `${completed.expected_file_count} 个原件已完整登记：上次保留 ${recoveryInitialPreservedCount} 个，本次完成 ${newlyCompletedCount} 个。${
              otherUnfinishedCount > 0
                ? ` 还有 ${otherUnfinishedCount} 个更早批次，请关闭后重新打开继续处理。`
                : ''
            }`
          );
        } else if (otherUnfinishedCount > 0) {
          setBatchNotice(
            `本批次已完成；还有 ${otherUnfinishedCount} 个更早批次，请关闭后重新打开继续处理。`
          );
        }
      }
      setBatchError(
        completed.status === 'partial'
          ? '仍有文件未保存，请重试失败项。已成功保存的原件不会丢失。'
          : ''
      );
    } catch {
      try {
        const refreshed = getUploadBatch
          ? await getUploadBatch(sourceBatch.id)
          : await healthImportApi.getSourceUploadBatch(sourceBatch.id);
        setBatch(refreshed);
        reconcileQueueFromBatch(refreshed);
        const remaining = refreshed.items.filter(
          item => item.status === 'pending' || item.status === 'failed'
        ).length;
        setBatchError(
          remaining > 0
            ? `还有 ${remaining} 个原件待重新选择或重试；已经保存的不会丢失。`
            : '文件已处理，但批次状态暂时无法确认。可再次点击下方按钮重试。'
        );
      } catch {
        setBatchError(
          '文件已逐个处理，但批次状态暂时无法确认。可再次点击下方按钮重试确认。'
        );
      }
    }
    await reloadSimilarityRelations();
  };

  const ensureBatch = async (): Promise<HealthSourceUploadBatch | null> => {
    if (!usesServerBatch) return null;
    if (batch) return batch;
    if (!batchKeyRef.current) {
      batchKeyRef.current = createClientToken('health-upload');
    }
    const documents: HealthSourceUploadManifestItem[] = items.map(
      (item, index) => ({
        client_item_id: item.id,
        sequence: index + 1,
        original_filename: item.file.name,
        mime_type: healthUploadMimeType(item.file) || item.file.type,
        size_bytes: item.file.size,
        client_sha256: clientSha256(item.fingerprint),
      })
    );
    try {
      const created = createUploadBatch
        ? await createUploadBatch(patientId, {
            idempotency_key: batchKeyRef.current,
            document_type: documentType,
            report_date: reportDate || undefined,
            facility: facility.trim() || undefined,
            documents,
          })
        : await healthImportApi.createSourceUploadBatch(patientId, {
            idempotency_key: batchKeyRef.current,
            document_type: documentType,
            report_date: reportDate || undefined,
            facility: facility.trim() || undefined,
            documents,
          });
      const serverItems = new Map(
        created.items.map(item => [item.client_item_id, item])
      );
      setItems(current =>
        current.map(item => ({
          ...item,
          serverItemId: serverItems.get(item.id)?.id,
        }))
      );
      setBatch(created);
      setRecoveredBatch(false);
      setRecoveryInitialPreservedCount(0);
      setRecoverySkippedSavedItemIds([]);
      setBatchError('');
      setBatchNotice('');
      return created;
    } catch {
      setBatchError('暂时无法建立安全上传批次，尚未传输任何文件。请稍后重试。');
      return null;
    }
  };

  const saveAll = async () => {
    const canFinalize =
      usesServerBatch &&
      batch !== null &&
      (batch.status === 'open' || batch.status === 'partial') &&
      pendingBatchItems.length === 0;
    if ((uploadable.length === 0 && !canFinalize) || uploading) return;
    setUploading(true);
    try {
      const activeBatch = await ensureBatch();
      if (usesServerBatch && !activeBatch) return;
      const serverItems = new Map(
        activeBatch?.items.map(item => [item.client_item_id, item]) || []
      );
      for (const item of uploadable) {
        const serverItemId =
          item.serverItemId || serverItems.get(item.id)?.id || undefined;
        if (usesServerBatch && !serverItemId) {
          updateStatus(item.id, 'error');
          setBatchError(
            '服务器没有返回完整的文件清单，已停止保存；请关闭后重新选择。'
          );
          continue;
        }
        await saveItem(item, activeBatch || undefined, serverItemId);
      }
      if (activeBatch) await finalizeBatch(activeBatch);
    } finally {
      setUploading(false);
    }
  };

  const retryItem = async (item: QueueItem) => {
    if (uploading) return;
    setUploading(true);
    try {
      const activeBatch = batch || (await ensureBatch());
      if (usesServerBatch && !activeBatch) return;
      const serverItemId =
        item.serverItemId ||
        activeBatch?.items.find(
          candidate => candidate.client_item_id === item.id
        )?.id;
      if (usesServerBatch && !serverItemId) {
        setBatchError('找不到该文件的服务器记录，请关闭后重新选择。');
        return;
      }
      await saveItem(item, activeBatch || undefined, serverItemId);
      if (activeBatch) await finalizeBatch(activeBatch);
    } finally {
      setUploading(false);
    }
  };

  const retryParseItem = async (item: QueueItem): Promise<void> => {
    if (
      startingParseItemId !== null ||
      !item.sourceDocumentId ||
      !startParseTask
    ) {
      return;
    }
    setStartingParseItemId(item.id);
    try {
      await queueLocalParse(item.id, item.sourceDocumentId);
    } finally {
      setStartingParseItemId(null);
    }
  };

  const reloadUnfinishedBatches = async (): Promise<void> => {
    const batches = listUploadBatches
      ? await listUploadBatches(patientId)
      : await healthImportApi.listSourceUploadBatches(patientId);
    const unfinished = batches.filter(
      candidate => candidate.status === 'open' || candidate.status === 'partial'
    );
    setBatch(unfinished[0] || null);
    setRecoveredBatch(unfinished.length > 0);
    setRecoveryInitialPreservedCount(
      unfinished[0]?.items.filter(
        item => item.status === 'uploaded' || item.status === 'duplicate'
      ).length || 0
    );
    setRecoverySkippedSavedItemIds([]);
    setOtherUnfinishedCount(Math.max(0, unfinished.length - 1));
    if (unfinished[0]) {
      setDocumentType(unfinished[0].document_type);
      setReportDate(unfinished[0].report_date || '');
      setFacility(unfinished[0].facility || '');
    }
  };

  const cancelCurrentBatch = async () => {
    if (!batch || uploading) return;
    setUploading(true);
    try {
      const cancelled = cancelUploadBatch
        ? await cancelUploadBatch(batch.id)
        : await healthImportApi.cancelSourceUploadBatch(batch.id);
      const preserved = cancelled.items.filter(
        item => item.status === 'uploaded' || item.status === 'duplicate'
      ).length;
      setItems([]);
      setRejections([]);
      setBatch(null);
      setRecoveredBatch(false);
      setRecoveryInitialPreservedCount(0);
      setRecoverySkippedSavedItemIds([]);
      setOtherUnfinishedCount(0);
      setDocumentType('checkup');
      setReportDate('');
      setFacility('');
      batchKeyRef.current = '';
      setBatchError('');
      setBatchNotice(
        preserved > 0
          ? `旧批次已结束，已保存的 ${preserved} 个原件继续保留。`
          : '旧批次已结束，没有删除任何已保存资料。'
      );
      try {
        await reloadUnfinishedBatches();
        setHistoryCheckBlocked(false);
      } catch {
        setHistoryCheckBlocked(true);
        setBatchError(
          '旧批次已结束，但暂时无法检查其他未完成批次；请关闭后重试。'
        );
      }
    } catch {
      setBatchError('暂时无法结束本批次，请稍后重试。已保存原件未受影响。');
    } finally {
      setCancelConfirm(false);
      setUploading(false);
    }
  };

  const reviewSimilarity = async (
    relation: HealthSourceSimilarityRelation,
    decision: 'confirmed' | 'dismissed'
  ): Promise<void> => {
    if (reviewingSimilarityId !== null || operatorContext?.mode === 'delegated')
      return;
    setReviewingSimilarityId(relation.id);
    setSimilarityError('');
    setSimilarityNotice('');
    try {
      if (reviewSimilarityRelation) {
        await reviewSimilarityRelation(relation.id, decision);
      } else {
        await healthImportApi.reviewSourceSimilarityRelation(
          relation.id,
          decision
        );
      }
      setSimilarityRelations(current =>
        current.filter(candidate => candidate.id !== relation.id)
      );
      setSimilarityNotice(
        decision === 'confirmed'
          ? '已记录确认；两份原件均未改变。'
          : '已排除这条相似线索；两份原件均未改变。'
      );
    } catch {
      setSimilarityError('暂时无法保存这次判断，请稍后重试。两份原件未改变。');
    } finally {
      setReviewingSimilarityId(null);
    }
  };

  const canSubmit =
    !checkingBatches &&
    !historyCheckBlocked &&
    (uploadable.length > 0 ||
      (usesServerBatch &&
        batch !== null &&
        (batch.status === 'open' || batch.status === 'partial') &&
        pendingBatchItems.length === 0));

  return (
    <div
      className="hhp-modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !uploading) onClose();
      }}
    >
      <section
        className="hhp-modal hhp-upload-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="household-upload-title"
      >
        <div className="hhp-modal-heading">
          <div>
            <p className="hhp-eyebrow">先完整保存源文件</p>
            <h2 id="household-upload-title">上传新报告</h2>
          </div>
          <button
            type="button"
            className="hhp-icon-button"
            aria-label="关闭"
            onClick={onClose}
            disabled={uploading}
          >
            <IconX size={22} />
          </button>
        </div>

        <div className="hhp-upload-subject">
          <span>保存到</span>
          <strong>{subjectLabel}</strong>
          <small>
            {operatorContext?.mode === 'delegated'
              ? '请再次确认报告所属人和当前目标档案一致'
              : '请在继续前确认这是本人的报告'}
          </small>
        </div>

        {operatorContext?.mode === 'delegated' ? (
          <div className="hhp-upload-operator-warning" role="status">
            <strong>{operatorContext.label}</strong>
            <small>
              系统会同时保存实际管理员和目标档案；此次操作不会冒充成员本人。
            </small>
            <small>相似图片关系需要由档案本人确认</small>
          </div>
        ) : null}

        <input
          ref={inputRef}
          className="hhp-hidden-input"
          id="household-report-files"
          aria-label="选择报告文件"
          type="file"
          multiple
          disabled={
            preparing ||
            uploading ||
            checkingBatches ||
            historyCheckBlocked ||
            Boolean(batch && recoveredBatch && !recoveryCanMatch) ||
            Boolean(batch && !recoveredBatch)
          }
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"
          onChange={event =>
            void addFiles(Array.from(event.target.files || []))
          }
        />
        <label
          className={`hhp-upload-dropzone ${dragActive ? 'is-active' : ''}`}
          htmlFor="household-report-files"
          onDragEnter={event => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={event => {
            event.preventDefault();
            if (event.currentTarget === event.target) setDragActive(false);
          }}
          onDrop={event => {
            event.preventDefault();
            setDragActive(false);
            void addFiles(Array.from(event.dataTransfer.files || []));
          }}
        >
          <span>
            <IconUpload size={29} />
          </span>
          <strong>
            {checkingBatches
              ? '正在检查上次上传…'
              : batch && recoveredBatch
                ? recoveryCanMatch
                  ? '重新选择待完成文件'
                  : '该批次无法安全重新匹配'
                : batch
                  ? '本批次清单已锁定'
                  : preparing
                    ? '正在检查文件…'
                    : '选择图片或 PDF'}
          </strong>
          <small>
            {checkingBatches
              ? '确认没有未完成批次后即可选择新报告'
              : batch && recoveredBatch
                ? !recoveryCanMatch
                  ? '请先结束旧批次，再重新选择需要保存的报告'
                  : recoveryRemainingCount > 0
                    ? `只接受上次清单中尚未保存的 ${recoveryRemainingCount} 个原件`
                    : '待完成文件已经选齐，可以继续保存'
                : batch
                  ? '如需添加其他文件，请完成本批次后重新打开上传'
                  : '最多 30 个 · 图片 20 MB/张 · PDF 50 MB/个 · 合计 300 MB'}
          </small>
        </label>

        <div className="hhp-upload-meta">
          <label>
            <span>资料类型</span>
            <select
              value={documentType}
              onChange={event => setDocumentType(event.target.value)}
              disabled={uploading || checkingBatches || Boolean(batch)}
            >
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>报告日期（可选）</span>
            <input
              type="date"
              value={reportDate}
              onChange={event => setReportDate(event.target.value)}
              disabled={uploading || checkingBatches || Boolean(batch)}
            />
          </label>
          <label>
            <span>机构（可选）</span>
            <input
              type="text"
              value={facility}
              placeholder="医院或体检中心"
              onChange={event => setFacility(event.target.value)}
              disabled={uploading || checkingBatches || Boolean(batch)}
            />
          </label>
        </div>

        {canOfferAutomaticParse ? (
          parseTypeEligible ? (
            <div className="hhp-upload-auto-parse">
              <label>
                <input
                  type="checkbox"
                  aria-label="保存后自动开始本地解析"
                  checked={parseAfterUpload}
                  onChange={event => setParseAfterUpload(event.target.checked)}
                  disabled={uploading || preparing}
                />
                <span>
                  <strong>保存后自动开始本地解析</strong>
                  <small>
                    解析结果只进入待复核区，不会自动写入健康指标或趋势。
                  </small>
                </span>
              </label>
              <IconFileSearch size={21} aria-hidden="true" />
            </div>
          ) : (
            <div className="hhp-upload-auto-parse is-unavailable" role="status">
              <span>
                <strong>此类资料先只保存原件</strong>
                <small>
                  当前自动解析仅用于体检报告和检验报告，之后仍可从档案手动处理。
                </small>
              </span>
            </div>
          )
        ) : null}

        {batch && recoveredBatch ? (
          <section
            className="hhp-upload-recovery"
            aria-labelledby="household-upload-recovery-title"
          >
            <div className="hhp-upload-recovery-heading">
              <span aria-hidden="true">
                <IconRefresh size={21} />
              </span>
              <div>
                <p className="hhp-eyebrow">上传可以继续</p>
                <h3 id="household-upload-recovery-title">继续上次上传</h3>
                <small>
                  已保存的原件留在服务器；重新选择原文件后，系统只补齐未完成部分。
                </small>
              </div>
            </div>

            <div className="hhp-upload-recovery-summary">
              <div>
                <strong>
                  已安全保存 {preservedBatchCount} / {batch.expected_file_count}
                </strong>
                <small>不会再次上传</small>
              </div>
              <div>
                <strong>还有 {pendingBatchItems.length} 个待处理</strong>
                <small>选择上次的原文件即可继续</small>
              </div>
            </div>

            {recoverySkippedSavedItemIds.length > 0 ? (
              <div className="hhp-upload-recovery-confirmed" role="status">
                <IconCheck size={18} />
                <span>
                  已识别 {recoverySkippedSavedItemIds.length}{' '}
                  个上次保存的原件，本次不会重复上传。
                </span>
              </div>
            ) : null}

            {pendingBatchItems.length > 0 ? (
              <details className="hhp-upload-recovery-files">
                <summary>查看待处理文件（{pendingBatchItems.length}）</summary>
                <ul>
                  {pendingBatchItems.map(item => {
                    const isSelected = queuedServerItemIds.has(item.id);
                    return (
                      <li key={item.id}>
                        <span>{item.original_filename}</span>
                        <small className={isSelected ? 'is-selected' : ''}>
                          {isSelected
                            ? '已选，等待保存'
                            : item.status === 'failed'
                              ? '上次保存失败，待重新选择'
                              : '待重新选择'}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        {rejections.length > 0 ? (
          <div className="hhp-upload-rejections" role="status">
            <div>
              <IconAlertTriangle size={19} />
              <strong>已跳过 {rejections.length} 个文件</strong>
              <button
                type="button"
                onClick={() => setRejections([])}
                aria-label="清除跳过提示"
              >
                <IconX size={17} />
              </button>
            </div>
            {rejections.map((rejection, index) => (
              <p key={`${rejection.fileName}:${rejection.code}:${index}`}>
                <span>{rejection.fileName}</span>
                <small>{rejection.message}</small>
              </p>
            ))}
          </div>
        ) : null}

        {batchNotice ? (
          <div className="hhp-upload-batch-message" role="status">
            <IconCheck size={19} />
            <span>{batchNotice}</span>
          </div>
        ) : null}

        {batchError ? (
          <div className="hhp-upload-batch-message is-error" role="alert">
            <IconAlertTriangle size={19} />
            <span>{batchError}</span>
          </div>
        ) : batch ? (
          <div className="hhp-upload-batch-message" role="status">
            {recoveredBatch ? (
              <IconRefresh size={19} />
            ) : (
              <IconCheck size={19} />
            )}
            <span>
              {recoveredBatch
                ? `发现上次未完成的上传：已保留 ${preservedBatchCount} 个，还有 ${pendingBatchItems.length} 个待处理${
                    otherUnfinishedCount > 0
                      ? `；另有 ${otherUnfinishedCount} 个更早批次`
                      : ''
                  }`
                : batch.status === 'completed'
                  ? '本批次已完整登记'
                  : '服务器已登记本批次，可安全逐个保存原件'}
            </span>
          </div>
        ) : null}

        {similarityNotice ? (
          <div className="hhp-upload-batch-message" role="status">
            <IconCheck size={19} />
            <span>{similarityNotice}</span>
          </div>
        ) : null}

        {similarityError ? (
          <div className="hhp-upload-batch-message is-error" role="alert">
            <IconAlertTriangle size={19} />
            <span>{similarityError}</span>
          </div>
        ) : null}

        {similarityRelations.length > 0 ? (
          <section
            className="hhp-similarity-review"
            aria-labelledby="household-similarity-review-title"
          >
            <div className="hhp-similarity-review-heading">
              <div>
                <p className="hhp-eyebrow">需要你判断</p>
                <h3 id="household-similarity-review-title">
                  发现 {similarityRelations.length} 组图片需要确认
                </h3>
              </div>
              <small>算法只提供线索，不会自动处理原件</small>
            </div>
            <div className="hhp-similarity-review-list">
              {similarityRelations.map(relation => (
                <SimilarityReviewCard
                  key={relation.id}
                  relation={relation}
                  reviewing={reviewingSimilarityId === relation.id}
                  loadThumbnail={loadSimilarityThumbnail}
                  onReview={(candidate, decision) =>
                    void reviewSimilarity(candidate, decision)
                  }
                />
              ))}
            </div>
          </section>
        ) : checkingSimilarity ? (
          <p className="hhp-similarity-checking" role="status">
            正在检查是否有相似图片需要确认…
          </p>
        ) : null}

        {items.length > 0 ? (
          <div className="hhp-upload-queue" aria-label="待保存文件">
            {items.map(item => {
              const kind = healthUploadKind(item.file);
              const FileIcon =
                kind === 'image'
                  ? IconPhoto
                  : kind === 'pdf'
                    ? IconFileTypePdf
                    : IconFile;
              return (
                <div
                  className={`hhp-upload-item is-${item.status}`}
                  key={item.id}
                >
                  <span className="hhp-upload-file-icon">
                    <FileIcon size={22} />
                  </span>
                  <span className="hhp-upload-file-copy">
                    <strong>{item.file.name}</strong>
                    <small>
                      {item.status === 'uploading'
                        ? `${formatHealthUploadBytes(
                            Math.round((item.file.size * item.progress) / 100)
                          )} / ${formatHealthUploadBytes(item.file.size)}`
                        : formatHealthUploadBytes(item.file.size)}
                    </small>
                    {item.status === 'uploading' ? (
                      <span
                        className="hhp-upload-progress"
                        role="progressbar"
                        aria-label={`${item.file.name} 上传进度`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={item.progress}
                      >
                        <span style={{ width: `${item.progress}%` }} />
                      </span>
                    ) : null}
                  </span>
                  <span className="hhp-upload-file-status">
                    {item.status === 'saved' ? <IconCheck size={17} /> : null}
                    {item.status === 'uploading'
                      ? `正在保存 ${item.progress}%`
                      : item.status === 'saved' &&
                          item.parseHandoffStatus === 'starting'
                        ? '原件已保存 · 正在安排解析'
                        : item.status === 'saved' &&
                            item.parseHandoffStatus === 'queued'
                          ? '原件已保存 · 解析已排队'
                          : item.status === 'saved' &&
                              item.parseHandoffStatus === 'failed'
                            ? '原件已保存 · 解析启动失败'
                            : statusText[item.status]}
                  </span>
                  {item.status === 'saved' &&
                  item.parseHandoffStatus === 'failed' &&
                  item.sourceDocumentId ? (
                    <button
                      type="button"
                      className="hhp-upload-item-action"
                      aria-label={`重试解析 ${item.file.name}`}
                      onClick={() => void retryParseItem(item)}
                      disabled={startingParseItemId !== null}
                    >
                      <IconRefresh size={18} />
                    </button>
                  ) : item.status === 'error' ? (
                    <button
                      type="button"
                      className="hhp-upload-item-action"
                      aria-label={`重试 ${item.file.name}`}
                      onClick={() => void retryItem(item)}
                      disabled={uploading}
                    >
                      <IconRefresh size={18} />
                    </button>
                  ) : item.status === 'queued' ||
                    (item.status === 'duplicate' && !batch) ? (
                    <button
                      type="button"
                      className="hhp-upload-item-action"
                      aria-label={`移除 ${item.file.name}`}
                      onClick={() =>
                        setItems(current =>
                          current.filter(candidate => candidate.id !== item.id)
                        )
                      }
                      disabled={uploading || Boolean(batch && !recoveredBatch)}
                    >
                      <IconTrash size={18} />
                    </button>
                  ) : (
                    <span className="hhp-upload-item-action" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="hhp-upload-empty">
            {canOfferAutomaticParse
              ? '原件会先完整保存；本地解析结果只进入待复核区。'
              : '这里暂时只保存原件，不会自动把内容写入健康指标。'}
          </p>
        )}

        {batch && (batch.status === 'open' || batch.status === 'partial') ? (
          <div className="hhp-upload-batch-actions">
            {cancelConfirm ? (
              <>
                <span>结束后，未保存项会关闭；已保存原件不会删除。</span>
                <div>
                  <button
                    type="button"
                    onClick={() => setCancelConfirm(false)}
                    disabled={uploading}
                  >
                    返回
                  </button>
                  <button
                    type="button"
                    className="is-danger"
                    onClick={() => void cancelCurrentBatch()}
                    disabled={uploading}
                  >
                    确认结束
                  </button>
                </div>
              </>
            ) : (
              <>
                <span>不想继续这次上传？已保存原件仍会保留。</span>
                <button
                  type="button"
                  onClick={() => setCancelConfirm(true)}
                  disabled={uploading}
                >
                  结束本批次
                </button>
              </>
            )}
          </div>
        ) : null}

        <div className="hhp-upload-footer">
          <span>
            {items.length} 个文件
            {savedCount > 0 ? ` · 已保存 ${savedCount} 个` : ''}
            {parseQueuedCount > 0 ? ` · 已安排解析 ${parseQueuedCount} 个` : ''}
            {parseFailedCount > 0 ? ` · 解析待重试 ${parseFailedCount} 个` : ''}
            {recoveredBatch && preservedBatchCount > 0
              ? ` · 上次已保留 ${preservedBatchCount} 个`
              : ''}
          </span>
          <div>
            <button
              type="button"
              className="hhp-upload-cancel"
              onClick={onClose}
              disabled={uploading}
            >
              稍后再说
            </button>
            <button
              type="button"
              className="hhp-modal-primary"
              onClick={() => void saveAll()}
              disabled={!canSubmit || uploading || preparing || checkingBatches}
            >
              <IconUpload size={19} />
              {uploading
                ? '正在保存原件…'
                : uploadable.length > 0
                  ? `保存 ${uploadable.length} 个原件`
                  : batch &&
                      (batch.status === 'open' || batch.status === 'partial')
                    ? pendingBatchItems.length > 0
                      ? `请重新选择 ${recoveryRemainingCount} 个`
                      : '确认批次状态'
                    : items.length > 0
                      ? '本批次已保存'
                      : checkingBatches
                        ? '正在检查'
                        : '请选择文件'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default HouseholdReportUploadModal;
