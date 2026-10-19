export const HEALTH_UPLOAD_LIMITS = {
  maxFiles: 30,
  imageBytes: 20 * 1024 * 1024,
  pdfBytes: 50 * 1024 * 1024,
  batchBytes: 300 * 1024 * 1024,
} as const;

export type HealthUploadRejectionCode =
  | 'unsupported_type'
  | 'file_too_large'
  | 'too_many'
  | 'batch_too_large'
  | 'duplicate'
  | 'recovery_mismatch'
  | 'already_saved';

export interface ExistingHealthUpload {
  size: number;
  fingerprint: string;
}

export interface HealthUploadRejection {
  fileName: string;
  code: HealthUploadRejectionCode;
  message: string;
}

export interface HealthUploadValidationResult {
  accepted: File[];
  rejected: HealthUploadRejection[];
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif)$/i;
const PDF_EXTENSION = /\.pdf$/i;

export const healthUploadMimeType = (file: File): string | null => {
  if (file.type === 'application/pdf' || PDF_EXTENSION.test(file.name)) {
    return 'application/pdf';
  }
  if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name)) {
    return 'image/jpeg';
  }
  if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
    return 'image/png';
  }
  if (file.type === 'image/webp' || /\.webp$/i.test(file.name)) {
    return 'image/webp';
  }
  if (file.type === 'image/heic' || /\.heic$/i.test(file.name)) {
    return 'image/heic';
  }
  if (file.type === 'image/heif' || /\.heif$/i.test(file.name)) {
    return 'image/heif';
  }
  return null;
};

export const healthUploadKind = (file: File): 'image' | 'pdf' | null => {
  const mimeType = healthUploadMimeType(file);
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType?.startsWith('image/') ||
    IMAGE_MIME_TYPES.has(file.type) ||
    IMAGE_EXTENSIONS.test(file.name)
  ) {
    return 'image';
  }
  return null;
};

const rejectionMessage = (
  code: HealthUploadRejectionCode,
  kind?: 'image' | 'pdf' | null
): string => {
  if (code === 'unsupported_type') return '仅支持常见图片和 PDF';
  if (code === 'too_many') return '一次最多选择 30 个文件';
  if (code === 'batch_too_large') return '本次选择总大小不能超过 300 MB';
  if (code === 'duplicate') return '与本次队列中的文件完全相同，已自动跳过';
  if (code === 'recovery_mismatch') return '不属于上次未完成清单，已跳过';
  if (code === 'already_saved') return '该原件已在上次批次中保存，无需重传';
  return kind === 'pdf' ? '单个 PDF 不能超过 50 MB' : '单张图片不能超过 20 MB';
};

export const validateHealthUploadSelection = (
  existing: ExistingHealthUpload[],
  incoming: File[],
  fingerprints: ReadonlyMap<File, string> = new Map()
): HealthUploadValidationResult => {
  const accepted: File[] = [];
  const rejected: HealthUploadRejection[] = [];
  const knownFingerprints = new Set(
    existing.map(item => item.fingerprint).filter(Boolean)
  );
  let queuedCount = existing.length;
  let queuedBytes = existing.reduce((total, item) => total + item.size, 0);

  incoming.forEach(file => {
    const kind = healthUploadKind(file);
    const fingerprint = fingerprints.get(file) || '';
    let code: HealthUploadRejectionCode | null = null;

    if (!kind) code = 'unsupported_type';
    else if (
      file.size >
      (kind === 'pdf'
        ? HEALTH_UPLOAD_LIMITS.pdfBytes
        : HEALTH_UPLOAD_LIMITS.imageBytes)
    ) {
      code = 'file_too_large';
    } else if (queuedCount >= HEALTH_UPLOAD_LIMITS.maxFiles) {
      code = 'too_many';
    } else if (queuedBytes + file.size > HEALTH_UPLOAD_LIMITS.batchBytes) {
      code = 'batch_too_large';
    } else if (fingerprint && knownFingerprints.has(fingerprint)) {
      code = 'duplicate';
    }

    if (code) {
      rejected.push({
        fileName: file.name,
        code,
        message: rejectionMessage(code, kind),
      });
      return;
    }

    accepted.push(file);
    queuedCount += 1;
    queuedBytes += file.size;
    if (fingerprint) knownFingerprints.add(fingerprint);
  });

  return { accepted, rejected };
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

export const fingerprintHealthUploadFile = async (
  file: File
): Promise<string> => {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      await file.arrayBuffer()
    );
    return `sha-256:${bytesToHex(new Uint8Array(digest))}`;
  }
  return '';
};

export const formatHealthUploadBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
