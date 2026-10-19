/* eslint-disable i18next/no-literal-string -- Chinese-first household archive flow */
import {
  IconAlertTriangle,
  IconArchive,
  IconArrowLeft,
  IconCheck,
  IconClock,
  IconDatabase,
  IconDownload,
  IconFileDescription,
  IconLoader2,
  IconLock,
  IconRefresh,
  IconShieldCheck,
  IconX,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentPatient } from '../hooks/useGlobalData';
import { usePatientPermissions } from '../hooks/usePatientPermissions';
import healthArchiveExportApi, {
  type HealthArchiveExport,
} from '../services/api/healthArchiveExportApi';
import logger from '../services/logger';
import { downloadBlob } from '../utils/downloadUtils';
import './health-archive-export.css';

interface PatientLike {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
}

const patientLabel = (patient?: PatientLike | null): string =>
  [patient?.first_name, patient?.last_name].filter(Boolean).join('').trim() ||
  '未命名成员';

const createIdempotencyKey = (): string => {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `health-archive-${randomPart}`.slice(0, 64);
};

const formatBytes = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const statusLabel: Record<HealthArchiveExport['status'], string> = {
  queued: '等待生成',
  running: '正在整理与校验',
  ready: '可以下载',
  failed: '生成失败',
  cancelled: '已取消',
  expired: '下载已过期',
};

const errorMessages: Record<string, string> = {
  source_file_binding_missing: '有报告缺少可用的原件绑定，归档已安全停止。',
  source_file_path_invalid: '有报告的存储位置异常，归档已安全停止。',
  source_file_missing: '有留存报告原件缺失，归档已安全停止。',
  source_size_mismatch: '有报告原件的大小与登记记录不一致。',
  source_sha256_mismatch: '有报告原件未通过完整性校验。',
  archive_crc_failed: 'ZIP 完整性校验没有通过。',
  archive_integrity_mismatch: '生成文件在下载前未通过二次校验。',
  archive_generation_failed: '生成过程中遇到异常，请稍后重试或联系管理员。',
};

const mergeHistory = (
  current: HealthArchiveExport[],
  next: HealthArchiveExport
): HealthArchiveExport[] =>
  [next, ...current.filter(item => item.id !== next.id)]
    .sort((a, b) => b.id - a.id)
    .slice(0, 10);

function ArchiveScopeCards() {
  return (
    <div className="hae-scope-grid" aria-label="归档包含内容">
      <article className="hae-scope-card">
        <span className="hae-scope-icon hae-scope-icon--blue">
          <IconDatabase size={24} />
        </span>
        <div>
          <h2>结构化健康数据</h2>
          <p>指标、生命体征、健康背景、来源、解析复核和完整版本历史。</p>
        </div>
      </article>
      <article className="hae-scope-card">
        <span className="hae-scope-icon hae-scope-icon--orange">
          <IconFileDescription size={24} />
        </span>
        <div>
          <h2>全部留存报告原件</h2>
          <p>包括仍在使用及已撤回的报告，保持上传时的原始文件内容。</p>
        </div>
      </article>
      <article className="hae-scope-card">
        <span className="hae-scope-icon hae-scope-icon--green">
          <IconShieldCheck size={24} />
        </span>
        <div>
          <h2>清单与完整性校验</h2>
          <p>附中文说明、版本化清单、逐项 SHA-256、ZIP CRC 与总校验值。</p>
        </div>
      </article>
    </div>
  );
}

function ProcessingState({
  archive,
  onCancel,
  cancelling,
}: {
  archive: HealthArchiveExport;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const running = archive.status === 'running';
  return (
    <div className="hae-state hae-state--processing" role="status">
      <span className="hae-state-symbol">
        <IconLoader2 className="hae-spin" size={28} />
      </span>
      <div className="hae-state-copy">
        <h2>{running ? '正在整理完整档案' : '已加入生成队列'}</h2>
        <p>
          {running
            ? '系统正在收集结构化记录和原件，并逐项验证完整性。你可以离开本页，稍后再回来查看。'
            : '任务会在后台开始；刷新或暂时离开不会丢失进度。'}
        </p>
        <ol className="hae-progress-steps">
          <li className="is-complete">
            <IconCheck size={16} /> 请求已保存
          </li>
          <li className={running ? 'is-active' : ''}>
            <span>2</span> 收集并校验
          </li>
          <li>
            <span>3</span> 准备下载
          </li>
        </ol>
      </div>
      {archive.status === 'queued' ? (
        <button
          className="hae-link-button"
          type="button"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling ? '正在取消…' : '取消任务'}
        </button>
      ) : null}
    </div>
  );
}

function ReadyState({
  archive,
  onDownload,
  downloading,
  onRegenerate,
}: {
  archive: HealthArchiveExport;
  onDownload: () => void;
  downloading: boolean;
  onRegenerate: () => void;
}) {
  const structuredCount = archive.manifest_summary.structured_record_count ?? 0;
  return (
    <div className="hae-state hae-state--ready" aria-live="polite">
      <div className="hae-ready-heading">
        <span className="hae-state-symbol">
          <IconCheck size={28} />
        </span>
        <div>
          <h2>归档已完成并通过校验</h2>
          <p>
            下载链接将在 {formatDateTime(archive.expires_at)}{' '}
            失效；健康数据和原件不会因此删除。
          </p>
        </div>
      </div>
      <div className="hae-result-grid">
        <div>
          <span>报告原件</span>
          <strong>{archive.original_count} 份报告原件</strong>
        </div>
        <div>
          <span>结构化记录</span>
          <strong>{structuredCount} 条结构化记录</strong>
        </div>
        <div>
          <span>归档大小</span>
          <strong>{formatBytes(archive.archive_size_bytes)}</strong>
        </div>
      </div>
      <div className="hae-hash">
        <span>归档 SHA-256</span>
        <code title={archive.archive_sha256 || ''}>
          {archive.archive_sha256
            ? `${archive.archive_sha256.slice(0, 12)}…${archive.archive_sha256.slice(-8)}`
            : '—'}
        </code>
      </div>
      <div className="hae-primary-actions">
        <button
          className="hae-primary-button"
          type="button"
          onClick={onDownload}
          disabled={downloading}
        >
          {downloading ? (
            <IconLoader2 className="hae-spin" size={20} />
          ) : (
            <IconDownload size={20} />
          )}
          {downloading ? '正在核验并下载…' : '下载完整档案'}
        </button>
        <button
          className="hae-secondary-button"
          type="button"
          onClick={onRegenerate}
          disabled={downloading}
        >
          <IconRefresh size={19} />
          重新生成最新档案
        </button>
      </div>
    </div>
  );
}

function HealthArchiveExportPage() {
  const navigate = useNavigate();
  const { patient, loading: patientLoading } = useCurrentPatient() as {
    patient?: PatientLike | null;
    loading: boolean;
  };
  const { isOwner } = usePatientPermissions();
  const [archive, setArchive] = useState<HealthArchiveExport | null>(null);
  const [history, setHistory] = useState<HealthArchiveExport[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingKey = useRef<string | null>(null);

  const label = useMemo(() => patientLabel(patient), [patient]);
  const canAccess = Boolean(patient?.id && isOwner);
  const processing =
    archive?.status === 'queued' || archive?.status === 'running';

  useEffect(() => {
    let active = true;
    setArchive(null);
    setHistory([]);
    setError(null);
    pendingKey.current = null;
    if (!patient?.id || !isOwner) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    void healthArchiveExportApi
      .list(patient.id)
      .then(result => {
        if (!active) return;
        setHistory(result.items);
        setArchive(result.items[0] || null);
      })
      .catch(loadError => {
        if (!active) return;
        logger.error('health_archive_export_list_failed', {
          component: 'HealthArchiveExportPage',
          patientId: patient.id,
          error:
            loadError instanceof Error ? loadError.message : String(loadError),
        });
        setError('暂时无法读取归档任务，请稍后重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOwner, patient?.id]);

  useEffect(() => {
    if (!archive || !processing) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void healthArchiveExportApi
        .get(archive.id)
        .then(next => {
          if (!active) return;
          setArchive(next);
          setHistory(current => mergeHistory(current, next));
          setError(null);
        })
        .catch(pollError => {
          if (!active) return;
          logger.error('health_archive_export_poll_failed', {
            component: 'HealthArchiveExportPage',
            archiveExportId: archive.id,
            error:
              pollError instanceof Error
                ? pollError.message
                : String(pollError),
          });
          setError('进度刷新失败，系统仍会在后台继续处理。');
        });
    }, 1600);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [archive, processing]);

  const createArchive = async () => {
    if (!patient?.id || !isOwner || creating || processing) return;
    const key = pendingKey.current || createIdempotencyKey();
    pendingKey.current = key;
    setCreating(true);
    setError(null);
    try {
      const next = await healthArchiveExportApi.create(patient.id, key);
      pendingKey.current = null;
      setArchive(next);
      setHistory(current => mergeHistory(current, next));
    } catch (createError) {
      logger.error('health_archive_export_create_failed', {
        component: 'HealthArchiveExportPage',
        patientId: patient.id,
        error:
          createError instanceof Error
            ? createError.message
            : String(createError),
      });
      setError('归档请求没有成功保存。再次点击会安全重试同一次请求。');
    } finally {
      setCreating(false);
    }
  };

  const cancelArchive = async () => {
    if (!archive || archive.status !== 'queued' || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const next = await healthArchiveExportApi.cancel(archive.id);
      setArchive(next);
      setHistory(current => mergeHistory(current, next));
    } catch (cancelError) {
      logger.error('health_archive_export_cancel_failed', {
        component: 'HealthArchiveExportPage',
        archiveExportId: archive.id,
        error:
          cancelError instanceof Error
            ? cancelError.message
            : String(cancelError),
      });
      setError('任务可能已经开始，当前无法取消。');
    } finally {
      setCancelling(false);
    }
  };

  const downloadArchive = async () => {
    if (!archive?.can_download || downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const result = await healthArchiveExportApi.download(archive.id);
      downloadBlob(result.blob, result.filename);
    } catch (downloadError) {
      logger.error('health_archive_export_download_failed', {
        component: 'HealthArchiveExportPage',
        archiveExportId: archive.id,
        error:
          downloadError instanceof Error
            ? downloadError.message
            : String(downloadError),
      });
      setError('下载前完整性校验未通过或链接已经失效，请重新生成。');
    } finally {
      setDownloading(false);
    }
  };

  const resetForRegeneration = () => {
    setArchive(null);
    pendingKey.current = null;
    setError(null);
  };

  if (patientLoading) {
    return (
      <main className="health-archive-page">
        <div className="hae-loading" role="status">
          <IconLoader2 className="hae-spin" size={28} />
          正在读取当前档案…
        </div>
      </main>
    );
  }

  return (
    <main className="health-archive-page">
      <div className="hae-container">
        <button
          type="button"
          className="hae-back"
          onClick={() => navigate('/family-health')}
        >
          <IconArrowLeft size={18} />
          返回家庭健康
        </button>

        <header className="hae-header">
          <div>
            <p className="hae-eyebrow">离线保存 · 搬迁 · 就医备份</p>
            <h1>完整档案导出</h1>
            <p>
              把服务器中的健康记录和报告原件整理成一份可以长期自行保存的 ZIP。
            </p>
          </div>
          {patient ? (
            <span className="hae-subject">
              <IconLock size={16} />
              当前档案：<strong>{label}</strong>
            </span>
          ) : null}
        </header>

        {!canAccess ? (
          <section className="hae-access-denied" aria-live="polite">
            <span>
              <IconLock size={28} />
            </span>
            <div>
              <h2>这里只能导出你自己的档案</h2>
              <p>
                查看家人或朋友的面板不会自动获得完整导出权限。请切换回自己的档案后再继续。
              </p>
            </div>
            <button type="button" onClick={() => navigate('/family-health')}>
              返回并切换档案
            </button>
          </section>
        ) : (
          <>
            <ArchiveScopeCards />

            <aside className="hae-privacy-note">
              <IconShieldCheck size={22} />
              <p>
                <strong>隐私边界：</strong>
                不会包含账号密码、登录会话、第二因素材料、活动日志、服务器配置、绝对路径或数据库备份。
              </p>
            </aside>

            <section
              className="hae-action-card"
              aria-labelledby="archive-action-title"
            >
              <div className="hae-action-intro">
                <div>
                  <p className="hae-section-kicker">本人专属 · 后台生成</p>
                  <h2 id="archive-action-title">生成一份最新完整档案</h2>
                </div>
                <span>
                  <IconClock size={17} />
                  完成后可下载 24 小时
                </span>
              </div>

              {error ? (
                <div className="hae-error" role="alert">
                  <IconAlertTriangle size={19} />
                  <span>{error}</span>
                  <button type="button" onClick={() => setError(null)}>
                    <IconX size={17} />
                    <span className="hae-visually-hidden">关闭提示</span>
                  </button>
                </div>
              ) : null}

              {loading ? (
                <div className="hae-inline-loading" role="status">
                  <IconLoader2 className="hae-spin" size={22} />
                  正在检查最近的归档任务…
                </div>
              ) : archive?.status === 'queued' ||
                archive?.status === 'running' ? (
                <ProcessingState
                  archive={archive}
                  onCancel={() => void cancelArchive()}
                  cancelling={cancelling}
                />
              ) : archive?.status === 'ready' ? (
                <ReadyState
                  archive={archive}
                  onDownload={() => void downloadArchive()}
                  downloading={downloading}
                  onRegenerate={resetForRegeneration}
                />
              ) : archive?.status === 'failed' ? (
                <div className="hae-state hae-state--failed" role="alert">
                  <span className="hae-state-symbol">
                    <IconAlertTriangle size={27} />
                  </span>
                  <div className="hae-state-copy">
                    <h2>归档没有生成，原数据未受影响</h2>
                    <p>
                      {errorMessages[archive.error_code || ''] ||
                        '完整性门禁阻止了不完整归档，请重试或联系管理员检查原件。'}
                    </p>
                  </div>
                  <button
                    className="hae-secondary-button"
                    type="button"
                    onClick={resetForRegeneration}
                  >
                    <IconRefresh size={18} />
                    重新尝试
                  </button>
                </div>
              ) : (
                <div className="hae-create-state">
                  <span className="hae-create-icon">
                    <IconArchive size={32} />
                  </span>
                  <div>
                    <h2>
                      {archive?.status === 'expired'
                        ? '上一次下载已过期'
                        : archive?.status === 'cancelled'
                          ? '上一次任务已取消'
                          : '还没有生成完整档案'}
                    </h2>
                    <p>
                      生成过程不会修改健康记录；如有任一报告缺失或校验失败，系统会整份停止。
                    </p>
                  </div>
                  <button
                    className="hae-primary-button"
                    type="button"
                    onClick={() => void createArchive()}
                    disabled={creating}
                  >
                    {creating ? (
                      <IconLoader2 className="hae-spin" size={20} />
                    ) : (
                      <IconArchive size={20} />
                    )}
                    {creating ? '正在保存请求…' : '生成完整档案'}
                  </button>
                </div>
              )}
            </section>

            {history.length > 1 ? (
              <section
                className="hae-history"
                aria-labelledby="archive-history-title"
              >
                <div className="hae-history-heading">
                  <h2 id="archive-history-title">最近任务</h2>
                  <span>只保留任务记录；下载文件到期后自动清理</span>
                </div>
                <ul>
                  {history.slice(0, 5).map(item => (
                    <li key={item.id}>
                      <span className={`hae-history-dot is-${item.status}`} />
                      <div>
                        <strong>{statusLabel[item.status]}</strong>
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                      <span>{formatBytes(item.archive_size_bytes)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

export default HealthArchiveExportPage;
