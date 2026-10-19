/* eslint-disable i18next/no-literal-string -- Chinese-first household health workflow */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@mantine/core';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconHistory,
  IconRefresh,
} from '@tabler/icons-react';
import healthImportApi, {
  type HealthFormalMetricRevision,
  type HealthFormalMetricRevisionHistory,
  type HealthFormalMetricRevisionRequest,
} from '../../services/api/healthImportApi';
import './health-formal-metric-revision-modal.css';

interface HealthFormalMetricRevisionModalProps {
  opened: boolean;
  componentId: number | null;
  onClose: () => void;
  onRevised: (_history: HealthFormalMetricRevisionHistory) => void;
  loadHistory?: typeof healthImportApi.listFormalMetricRevisions;
  createRevision?: typeof healthImportApi.reviseFormalMetric;
}

interface RevisionDraft {
  resultType: 'quantitative' | 'qualitative' | 'textual';
  numericValue: string;
  qualitativeValue: string;
  textualValue: string;
  unit: string;
  refRangeMin: string;
  refRangeMax: string;
  refRangeText: string;
  resultStatus: string;
  reason: string;
}

const emptyDraft: RevisionDraft = {
  resultType: 'quantitative',
  numericValue: '',
  qualitativeValue: '',
  textualValue: '',
  unit: '',
  refRangeMin: '',
  refRangeMax: '',
  refRangeText: '',
  resultStatus: '',
  reason: '',
};

const createRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const toDraft = (revision: HealthFormalMetricRevision): RevisionDraft => ({
  resultType: revision.result_type,
  numericValue:
    revision.numeric_value === null || revision.numeric_value === undefined
      ? ''
      : String(revision.numeric_value),
  qualitativeValue: revision.qualitative_value ?? '',
  textualValue: revision.textual_value ?? '',
  unit: revision.unit ?? '',
  refRangeMin:
    revision.ref_range_min === null || revision.ref_range_min === undefined
      ? ''
      : String(revision.ref_range_min),
  refRangeMax:
    revision.ref_range_max === null || revision.ref_range_max === undefined
      ? ''
      : String(revision.ref_range_max),
  refRangeText: revision.ref_range_text ?? '',
  resultStatus: revision.result_status ?? '',
  reason: '',
});

const optionalNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const displayRevisionValue = (revision: HealthFormalMetricRevision): string => {
  if (revision.result_type === 'quantitative') {
    return `${revision.numeric_value ?? '—'}${revision.unit ? ` ${revision.unit}` : ''}`;
  }
  if (revision.result_type === 'qualitative') {
    return revision.qualitative_value || '—';
  }
  return revision.textual_value || '—';
};

const statusLabel = (status?: string | null): string => {
  const labels: Record<string, string> = {
    normal: '正常',
    high: '偏高',
    low: '偏低',
    abnormal: '异常',
    critical: '需尽快关注',
    borderline: '临界',
  };
  return status ? (labels[status] ?? status) : '未标注';
};

const HealthFormalMetricRevisionModal = ({
  opened,
  componentId,
  onClose,
  onRevised,
  loadHistory = healthImportApi.listFormalMetricRevisions,
  createRevision = healthImportApi.reviseFormalMetric,
}: HealthFormalMetricRevisionModalProps) => {
  const [history, setHistory] =
    useState<HealthFormalMetricRevisionHistory | null>(null);
  const [draft, setDraft] = useState<RevisionDraft>(emptyDraft);
  const [requestId, setRequestId] = useState(createRequestId);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [historyExpanded, setHistoryExpanded] = useState(true);

  useEffect(() => {
    if (!opened || componentId === null) return;
    const controller = new AbortController();
    setLoading(true);
    setHistory(null);
    setLoadError('');
    setSubmitError('');
    setSuccessMessage('');
    setRequestId(createRequestId());
    void loadHistory(componentId, controller.signal)
      .then(nextHistory => {
        if (controller.signal.aborted) return;
        setHistory(nextHistory);
        setDraft(toDraft(nextHistory.revisions[0]));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadError('暂时无法读取这条记录的修订历史');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [componentId, loadHistory, opened]);

  const currentRevision = history?.revisions[0] ?? null;
  const canSubmit = useMemo(() => {
    if (!currentRevision || saving || draft.reason.trim().length < 3) {
      return false;
    }
    if (draft.resultType === 'quantitative') {
      return (
        draft.numericValue.trim() !== '' &&
        Number.isFinite(Number(draft.numericValue))
      );
    }
    if (draft.resultType === 'qualitative') {
      return draft.qualitativeValue.trim().length > 0;
    }
    return draft.textualValue.trim().length > 0;
  }, [currentRevision, draft, saving]);

  const updateDraft = <K extends keyof RevisionDraft>(
    key: K,
    value: RevisionDraft[K]
  ) => setDraft(current => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!history || !currentRevision || componentId === null || !canSubmit) {
      return;
    }
    const minimum = optionalNumber(draft.refRangeMin);
    const maximum = optionalNumber(draft.refRangeMax);
    if (minimum !== null && maximum !== null && minimum >= maximum) {
      setSubmitError('参考范围下限必须小于上限。');
      return;
    }

    const request: HealthFormalMetricRevisionRequest = {
      expected_current_revision_id: history.current_revision_id,
      idempotency_key: requestId,
      reason: draft.reason.trim(),
      result: {
        result_type: draft.resultType,
        numeric_value:
          draft.resultType === 'quantitative'
            ? Number(draft.numericValue)
            : null,
        qualitative_value:
          draft.resultType === 'qualitative'
            ? draft.qualitativeValue.trim()
            : null,
        textual_value:
          draft.resultType === 'textual' ? draft.textualValue.trim() : null,
        unit: draft.unit.trim() || null,
        ref_range_min: draft.resultType === 'quantitative' ? minimum : null,
        ref_range_max: draft.resultType === 'quantitative' ? maximum : null,
        ref_range_text: draft.refRangeText.trim() || null,
        result_status: draft.resultStatus || null,
      },
    };

    setSaving(true);
    setSubmitError('');
    setSuccessMessage('');
    try {
      const nextHistory = await createRevision(componentId, request);
      setHistory(nextHistory);
      setDraft(toDraft(nextHistory.revisions[0]));
      setRequestId(createRequestId());
      setSuccessMessage(`第 ${nextHistory.revisions[0].version} 版已保存`);
      onRevised(nextHistory);
    } catch {
      setSubmitError(
        '暂时无法保存。记录可能已在其他页面修改，请关闭后重新打开再试。'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      title={
        <div className="health-revision-modal__title">
          <span className="health-revision-modal__title-icon">
            <IconHistory size={20} aria-hidden />
          </span>
          <span>
            <strong>修订正式记录</strong>
            <small>修改会生成新版本，不会覆盖历史</small>
          </span>
        </div>
      }
      classNames={{
        content: 'health-revision-modal__surface',
        header: 'health-revision-modal__header',
        body: 'health-revision-modal__body',
        close: 'health-revision-modal__close',
      }}
      overlayProps={{ backgroundOpacity: 0.42, blur: 3 }}
    >
      {loading ? (
        <div className="health-revision-modal__state" role="status">
          <IconRefresh className="is-spinning" size={24} />
          <span>正在读取版本记录…</span>
        </div>
      ) : null}

      {loadError ? (
        <div className="health-revision-modal__state is-error" role="alert">
          <IconAlertTriangle size={23} />
          <span>{loadError}</span>
        </div>
      ) : null}

      {!loading && !loadError && history && currentRevision ? (
        <div className="health-revision-modal__layout">
          <section className="health-revision-modal__summary">
            <div>
              <span>指标</span>
              <strong>{history.test_name}</strong>
            </div>
            <div>
              <span>记录日期</span>
              <strong>{history.observed_date || '日期未知'}</strong>
            </div>
            <div>
              <span>版本状态</span>
              <strong>当前为第 {currentRevision.version} 版</strong>
            </div>
          </section>

          <div className="health-revision-modal__notice">
            <IconHistory size={19} />
            <div>
              <strong>原值会永久保留</strong>
              <p>保存后，趋势和导出使用新版本；旧版本仍可在下方查看和追溯。</p>
            </div>
          </div>

          <form
            className="health-revision-modal__form"
            onSubmit={event => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="health-revision-modal__field-grid">
              <label>
                <span>结果类型</span>
                <select
                  aria-label="结果类型"
                  value={draft.resultType}
                  onChange={event =>
                    updateDraft(
                      'resultType',
                      event.target.value as RevisionDraft['resultType']
                    )
                  }
                >
                  <option value="quantitative">数值</option>
                  <option value="qualitative">定性结果</option>
                  <option value="textual">文字结果</option>
                </select>
              </label>

              {draft.resultType === 'quantitative' ? (
                <>
                  <label>
                    <span>修订后的数值</span>
                    <input
                      aria-label="修订后的数值"
                      inputMode="decimal"
                      value={draft.numericValue}
                      onChange={event =>
                        updateDraft('numericValue', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>单位</span>
                    <input
                      aria-label="单位"
                      value={draft.unit}
                      onChange={event =>
                        updateDraft('unit', event.target.value)
                      }
                    />
                  </label>
                </>
              ) : null}

              {draft.resultType === 'qualitative' ? (
                <label>
                  <span>修订后的定性结果</span>
                  <select
                    aria-label="修订后的定性结果"
                    value={draft.qualitativeValue}
                    onChange={event =>
                      updateDraft('qualitativeValue', event.target.value)
                    }
                  >
                    <option value="">请选择</option>
                    <option value="positive">阳性</option>
                    <option value="negative">阴性</option>
                    <option value="detected">检出</option>
                    <option value="undetected">未检出</option>
                  </select>
                </label>
              ) : null}

              {draft.resultType === 'textual' ? (
                <label className="is-wide">
                  <span>修订后的文字结果</span>
                  <textarea
                    aria-label="修订后的文字结果"
                    rows={4}
                    value={draft.textualValue}
                    onChange={event =>
                      updateDraft('textualValue', event.target.value)
                    }
                  />
                </label>
              ) : null}

              <label>
                <span>状态</span>
                <select
                  aria-label="状态"
                  value={draft.resultStatus}
                  onChange={event =>
                    updateDraft('resultStatus', event.target.value)
                  }
                >
                  <option value="">未标注</option>
                  <option value="normal">正常</option>
                  <option value="high">偏高</option>
                  <option value="low">偏低</option>
                  <option value="borderline">临界</option>
                  <option value="abnormal">异常</option>
                  <option value="critical">需尽快关注</option>
                </select>
              </label>

              {draft.resultType === 'quantitative' ? (
                <>
                  <label>
                    <span>参考下限（可选）</span>
                    <input
                      aria-label="参考下限"
                      inputMode="decimal"
                      value={draft.refRangeMin}
                      onChange={event =>
                        updateDraft('refRangeMin', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>参考上限（可选）</span>
                    <input
                      aria-label="参考上限"
                      inputMode="decimal"
                      value={draft.refRangeMax}
                      onChange={event =>
                        updateDraft('refRangeMax', event.target.value)
                      }
                    />
                  </label>
                </>
              ) : null}

              <label className="is-wide">
                <span>参考范围原文（可选）</span>
                <input
                  aria-label="参考范围原文"
                  value={draft.refRangeText}
                  onChange={event =>
                    updateDraft('refRangeText', event.target.value)
                  }
                />
              </label>

              <label className="is-wide">
                <span>修改原因</span>
                <textarea
                  aria-label="修改原因"
                  rows={3}
                  maxLength={500}
                  placeholder="例如：原报告为 13.2，自动识别成了 12.5"
                  value={draft.reason}
                  onChange={event =>
                    updateDraft(
                      'reason',
                      event.target.value.replace(/\r?\n/g, ' ')
                    )
                  }
                />
                <small>至少 3 个字；原因会随版本长期保存。</small>
              </label>
            </div>

            {submitError ? (
              <div
                className="health-revision-modal__message is-error"
                role="alert"
              >
                <IconAlertTriangle size={18} />
                <span>{submitError}</span>
              </div>
            ) : null}
            {successMessage ? (
              <div
                className="health-revision-modal__message is-success"
                role="status"
              >
                <IconCheck size={18} />
                <span>{successMessage}</span>
              </div>
            ) : null}

            <div className="health-revision-modal__actions">
              <button type="button" className="is-secondary" onClick={onClose}>
                关闭
              </button>
              <button
                type="submit"
                className="is-primary"
                disabled={!canSubmit}
              >
                {saving ? '正在保存…' : '保存为新版本'}
              </button>
            </div>
          </form>

          <section className="health-revision-modal__history">
            <button
              type="button"
              className="health-revision-modal__history-toggle"
              aria-expanded={historyExpanded}
              onClick={() => setHistoryExpanded(value => !value)}
            >
              <span>
                <IconHistory size={18} />
                全部版本（{history.revisions.length}）
              </span>
              <IconChevronDown
                className={historyExpanded ? 'is-expanded' : ''}
                size={18}
              />
            </button>
            {historyExpanded ? (
              <ol>
                {history.revisions.map((revision, index) => (
                  <li key={revision.id}>
                    <div>
                      <strong>
                        第 {revision.version} 版
                        {index === 0 ? <em>当前</em> : null}
                      </strong>
                      <time dateTime={revision.created_at}>
                        {new Date(revision.created_at).toLocaleString('zh-CN')}
                      </time>
                    </div>
                    <p>{displayRevisionValue(revision)}</p>
                    <small>
                      {statusLabel(revision.result_status)}
                      {revision.reason
                        ? ` · ${revision.reason}`
                        : ' · 初次入库'}
                    </small>
                  </li>
                ))}
              </ol>
            ) : null}
          </section>
        </div>
      ) : null}
    </Modal>
  );
};

export default HealthFormalMetricRevisionModal;
