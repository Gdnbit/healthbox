/* eslint-disable i18next/no-literal-string -- Chinese-first household privacy page */
import { useCallback, useEffect, useState } from 'react';
import {
  IconArrowLeft,
  IconClock,
  IconEye,
  IconLock,
  IconShieldCheck,
  IconUsers,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import privacyAccessApi, {
  type PrivacyAccessEvent,
  type PrivacyAccessRecord,
} from '../services/api/privacyAccessApi';
import './PrivacyAccessPage.css';

const PAGE_SIZE = 20;

export const SYNTHETIC_PRIVACY_ACCESS_PREVIEW: PrivacyAccessRecord = {
  subject: { display_name: '林晓（虚构）' },
  visibility: {
    administrator: {
      label: '系统管理员',
      can_read_all_server_data: true,
    },
    reciprocal_viewers: [
      {
        display_name: '王芳（虚构）',
        scope: 'structured_dashboard',
        scope_label: '结构化指标与趋势',
      },
      {
        display_name: '林建国（虚构）',
        scope: 'structured_dashboard',
        scope_label: '结构化指标与趋势',
      },
    ],
    not_shared_by_default: [
      '报告原件',
      '报告文字描述',
      '编辑权限',
      '导出权限',
      'AI 分析权限',
    ],
  },
  events: [
    {
      actor: { kind: 'member', label: '王芳（虚构）' },
      action: 'viewed',
      action_label: '查看',
      resource: { kind: 'dashboard', label: '结构化面板' },
      authorization: {
        basis: 'archive_circle',
        label: '相互可见关系',
      },
      result: 'allowed',
      occurred_at: '2026-07-28T08:30:00+08:00',
    },
    {
      actor: { kind: 'administrator', label: '系统管理员' },
      action: 'updated',
      action_label: '修改',
      resource: { kind: 'formal_metric', label: '结构化指标' },
      authorization: {
        basis: 'owner_global_read',
        label: '管理员全局读取',
      },
      result: 'completed',
      occurred_at: '2026-07-26T20:10:00+08:00',
    },
    {
      actor: { kind: 'self', label: '我' },
      action: 'exported',
      action_label: '导出',
      resource: { kind: 'complete_archive', label: '完整档案导出' },
      authorization: { basis: 'owner', label: '本人操作' },
      result: 'completed',
      occurred_at: '2026-07-20T14:20:00+08:00',
    },
  ],
  total: 3,
  offset: 0,
  limit: PAGE_SIZE,
  generated_at: '2026-07-28T09:00:00+08:00',
  history_notice:
    '这里只显示系统现有审计记录能够确认的访问和操作；早期未记录的行为不会被补写。',
};

const formatOccurredAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
};

const eventSentence = (event: PrivacyAccessEvent): string =>
  `${event.actor.label}${event.action_label}了${event.resource.label}`;

interface PrivacyAccessPageProps {
  previewRecord?: PrivacyAccessRecord;
  onBack?: () => void;
}

const PrivacyAccessPage = ({
  previewRecord,
  onBack,
}: PrivacyAccessPageProps = {}) => {
  const navigate = useNavigate();
  const [record, setRecord] = useState<PrivacyAccessRecord | null>(
    previewRecord ?? null
  );
  const [isLoading, setIsLoading] = useState(!previewRecord);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setRecord(
        await privacyAccessApi.getMine({
          limit: PAGE_SIZE,
          offset: 0,
        })
      );
    } catch {
      setRecord(null);
      setError('暂时无法读取访问记录');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (previewRecord) return;
    void load();
  }, [load, previewRecord]);

  const loadMore = async () => {
    if (!record || isLoadingMore || record.events.length >= record.total)
      return;
    setIsLoadingMore(true);
    try {
      const next = await privacyAccessApi.getMine({
        limit: PAGE_SIZE,
        offset: record.events.length,
      });
      setRecord(current =>
        current
          ? {
              ...next,
              events: [...current.events, ...next.events],
              offset: 0,
            }
          : next
      );
    } catch {
      setError('更多记录暂时无法载入，请稍后重试。');
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <main className="privacy-access-page">
      <div className="privacy-access-shell">
        <header className="privacy-access-header">
          <button
            type="button"
            className="privacy-access-back"
            aria-label="返回家庭健康首页"
            onClick={() => {
              if (onBack) onBack();
              else navigate('/family-health');
            }}
          >
            <IconArrowLeft size={22} />
          </button>
          <div>
            <p>账号、关系和访问记录</p>
            <h1>数据与隐私</h1>
          </div>
        </header>

        {isLoading ? (
          <section className="privacy-access-status" aria-live="polite">
            <span className="privacy-access-spinner" aria-hidden="true" />
            <p>正在读取你的隐私设置…</p>
          </section>
        ) : null}

        {!isLoading && !record ? (
          <section className="privacy-access-status" role="alert">
            <IconLock size={34} />
            <h2>{error || '暂时无法读取访问记录'}</h2>
            <p>你的健康数据不会因此开放给其他人。</p>
            <button type="button" onClick={() => void load()}>
              重新加载
            </button>
          </section>
        ) : null}

        {!isLoading && record ? (
          <>
            <section
              className="privacy-access-section"
              aria-labelledby="privacy-visibility-title"
            >
              <div className="privacy-access-section-heading">
                <div className="privacy-access-section-icon">
                  <IconUsers size={22} />
                </div>
                <div>
                  <p>{record.subject.display_name}的档案</p>
                  <h2 id="privacy-visibility-title">谁可以查看我的档案</h2>
                </div>
              </div>

              <div className="privacy-access-visibility-grid">
                <article className="privacy-access-card">
                  <IconShieldCheck size={24} />
                  <div>
                    <strong>{record.visibility.administrator.label}</strong>
                    <p>
                      作为唯一运营管理员，可以读取服务器中的全部健康资料；相关操作会尽可能留痕。
                    </p>
                  </div>
                </article>

                <article className="privacy-access-card">
                  <IconEye size={24} />
                  <div>
                    <strong>相互可见的成员</strong>
                    {record.visibility.reciprocal_viewers.length ? (
                      <div className="privacy-access-viewers">
                        {record.visibility.reciprocal_viewers.map(viewer => (
                          <span key={viewer.display_name}>
                            <b>{viewer.display_name}</b>
                            <small>{viewer.scope_label}</small>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p>当前没有其他成员可以查看你的结构化面板。</p>
                    )}
                  </div>
                </article>
              </div>

              <div className="privacy-access-exclusions" role="note">
                <strong>默认不会共享</strong>
                <div>
                  {record.visibility.not_shared_by_default.map(item => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </div>
            </section>

            <section
              className="privacy-access-section"
              aria-labelledby="privacy-history-title"
            >
              <div className="privacy-access-section-heading">
                <div className="privacy-access-section-icon">
                  <IconClock size={22} />
                </div>
                <div>
                  <p>共 {record.total} 条可确认记录</p>
                  <h2 id="privacy-history-title">最近访问记录</h2>
                </div>
              </div>

              {error ? (
                <p className="privacy-access-inline-error" role="alert">
                  {error}
                </p>
              ) : null}

              {record.events.length ? (
                <ol className="privacy-access-events">
                  {record.events.map((event, index) => (
                    <li
                      key={`${event.occurred_at}-${event.actor.kind}-${event.action}-${index}`}
                    >
                      <span
                        className={`privacy-access-actor privacy-access-actor--${event.actor.kind}`}
                        aria-hidden="true"
                      >
                        {event.actor.label.slice(0, 1)}
                      </span>
                      <div>
                        <strong>{eventSentence(event)}</strong>
                        <p>
                          <time dateTime={event.occurred_at}>
                            {formatOccurredAt(event.occurred_at)}
                          </time>
                          <span>{event.authorization.label}</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="privacy-access-empty">
                  <IconEye size={28} />
                  <p>暂时没有可展示的访问或操作记录。</p>
                </div>
              )}

              {record.events.length < record.total ? (
                <button
                  type="button"
                  className="privacy-access-load-more"
                  disabled={isLoadingMore}
                  onClick={() => void loadMore()}
                >
                  {isLoadingMore ? '正在加载…' : '查看更多记录'}
                </button>
              ) : null}

              <p className="privacy-access-history-notice">
                {record.history_notice}
              </p>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
};

export default PrivacyAccessPage;
