/* eslint-disable i18next/no-literal-string -- Chinese-first household health source preview */
import { useEffect, useId, useState } from 'react';
import {
  IconDownload,
  IconFileOff,
  IconLoader2,
  IconX,
} from '@tabler/icons-react';
import type { HouseholdHealthReport } from './types';

const PREVIEWABLE_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const canPreviewHouseholdSource = (mimeType: string): boolean =>
  PREVIEWABLE_MIME_TYPES.has(mimeType.trim().toLowerCase());

interface HouseholdSourcePreviewModalProps {
  report: HouseholdHealthReport;
  onLoad: (_sourceDocumentId: number) => Promise<Blob>;
  onDownload?: (_sourceDocumentId: number) => void;
  onClose: () => void;
}

export default function HouseholdSourcePreviewModal({
  report,
  onLoad,
  onDownload,
  onClose,
}: HouseholdSourcePreviewModalProps) {
  const titleId = useId();
  const [objectUrl, setObjectUrl] = useState('');
  const [resolvedMimeType, setResolvedMimeType] = useState(
    report.mimeType.trim().toLowerCase()
  );
  const [error, setError] = useState('');

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    let createdUrl = '';

    void onLoad(report.sourceDocumentId)
      .then(blob => {
        if (!active) return;
        const blobMimeType = blob.type.trim().toLowerCase();
        if (!canPreviewHouseholdSource(blobMimeType)) {
          setError('这个文件暂时不能在浏览器中预览，请下载原件后查看。');
          return;
        }
        if (typeof URL.createObjectURL !== 'function') {
          setError('当前浏览器不支持安全预览，请下载原件后查看。');
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setResolvedMimeType(blobMimeType);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (active) {
          setError('原件加载失败，请稍后重试，或直接下载原件。');
        }
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [onLoad, report.sourceDocumentId]);

  const isPdf = resolvedMimeType === 'application/pdf';

  return (
    <div className="hhp-modal-backdrop hhp-preview-backdrop">
      <section
        className="hhp-modal hhp-source-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="hhp-source-preview-heading">
          <div>
            <p>仅本次浏览 · 关闭后释放临时链接</p>
            <h2 id={titleId}>{report.title}原件预览</h2>
            <small>
              {report.date} · {report.facility}
            </small>
          </div>
          <button
            type="button"
            className="hhp-source-preview-close"
            aria-label={`关闭${report.title}原件预览`}
            onClick={onClose}
            autoFocus
          >
            <IconX size={21} />
          </button>
        </header>

        <div className="hhp-source-preview-stage">
          {!objectUrl && !error ? (
            <div className="hhp-source-preview-state" role="status">
              <IconLoader2 className="is-spinning" size={30} />
              <strong>正在安全加载原件…</strong>
              <span>文件不会因预览产生新的服务器副本。</span>
            </div>
          ) : null}

          {error ? (
            <div className="hhp-source-preview-state is-error" role="alert">
              <IconFileOff size={32} />
              <strong>暂时无法在线预览</strong>
              <span>{error}</span>
            </div>
          ) : null}

          {objectUrl && isPdf ? (
            <iframe
              className="hhp-source-preview-frame"
              src={objectUrl}
              title={`${report.title} PDF 原件预览`}
              sandbox=""
              referrerPolicy="no-referrer"
            />
          ) : null}

          {objectUrl && !isPdf ? (
            <img
              className="hhp-source-preview-image"
              src={objectUrl}
              alt={`${report.title}原件`}
            />
          ) : null}
        </div>

        <footer className="hhp-source-preview-footer">
          <span>预览只用于查看留存原件，不会修改已录入指标。</span>
          {onDownload ? (
            <button
              type="button"
              onClick={() => onDownload(report.sourceDocumentId)}
            >
              <IconDownload size={17} />
              下载原件
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
