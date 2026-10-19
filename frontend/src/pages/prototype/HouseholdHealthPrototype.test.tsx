import { MantineProvider } from '@mantine/core';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { HouseholdHealthExperienceModel } from '../../features/householdHealth/types';
import type {
  HealthAiAnswerSummary,
  HealthAiQuestionResponse,
} from '../../services/api/healthAiApi';
import HouseholdHealthPrototype, {
  buildDynamicSyntheticPreviewAnswerItems,
} from './HouseholdHealthPrototype';

const downloadBlobMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/downloadUtils', () => ({
  downloadBlob: downloadBlobMock,
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const passthrough = (tag: 'div' | 'article') => {
    const MotionPassthrough = ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...props
    }: HTMLAttributes<HTMLElement> & {
      children?: ReactNode;
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
    }) => React.createElement(tag, props, children);
    MotionPassthrough.displayName = `Motion${tag}`;
    return MotionPassthrough;
  };

  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: {
      div: passthrough('div'),
      article: passthrough('article'),
    },
  };
});

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="trend-chart">{children}</div>
  ),
  AreaChart: ({
    children,
    margin,
  }: {
    children: ReactNode;
    margin?: { left?: number; right?: number };
  }) => (
    <div
      data-testid="trend-area-chart"
      data-edge-inset={`${margin?.left ?? 0}:${margin?.right ?? 0}`}
    >
      {children}
    </div>
  ),
  Area: ({ type, dot }: { type?: string; dot?: unknown }) => (
    <div
      data-testid="trend-area"
      data-curve-type={type}
      data-has-static-dots={String(dot !== false)}
    />
  ),
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: ({
    dataKey,
    type,
    scale,
  }: {
    dataKey?: string;
    type?: string;
    scale?: string;
  }) => (
    <div
      data-testid="trend-x-axis"
      data-axis-key={dataKey}
      data-axis-type={type}
      data-axis-scale={scale}
    />
  ),
  YAxis: () => null,
}));

const renderPrototype = () =>
  render(
    <MantineProvider>
      <HouseholdHealthPrototype />
    </MantineProvider>
  );

const buildAuditedReadOnlyExperience = (): HouseholdHealthExperienceModel => ({
  subject: { id: 8, label: '共享成员', relationshipLabel: '管理员只读' },
  subjects: [{ id: 8, label: '共享成员', relationshipLabel: '管理员只读' }],
  snapshot: {
    subjectState: 'ready',
    metrics: [
      {
        id: 'lab:glucose:mmol/L',
        kind: 'lab',
        label: '空腹血糖',
        unit: 'mmol/L',
        latestStatus: '正常',
        points: [
          {
            id: 'glucose-1',
            date: '2026-06-18',
            value: 5.2,
            secondaryValue: null,
            sourceDocumentId: 41,
            status: '正常',
          },
        ],
      },
    ],
    reports: [
      {
        id: 'source:41',
        sourceDocumentId: 41,
        title: '年度体检报告',
        originalFilename: 'report.pdf',
        date: '2026-06-18',
        facility: '市第一医院',
        typeLabel: '体检报告',
        statusLabel: '原件已保存',
        sizeLabel: '1.0 KB',
        mimeType: 'application/pdf',
      },
    ],
    errors: [],
    loadedAt: '2026-07-27T09:00:00Z',
  },
  capabilities: {
    canUpload: false,
    canExport: true,
    canUseAi: false,
    canViewSources: true,
    canDownloadSources: true,
    canPreviewSources: true,
    canShare: true,
    canCopyForAi: false,
  },
  mode: 'live',
});

const buildConnectedOwnerExperience = (): HouseholdHealthExperienceModel => {
  const base = buildAuditedReadOnlyExperience();
  return {
    ...base,
    subject: { id: 8, label: '林晓', relationshipLabel: '我的档案' },
    subjects: [{ id: 8, label: '林晓', relationshipLabel: '我的档案' }],
    capabilities: {
      ...base.capabilities,
      canUseAi: true,
      canCopyForAi: true,
    },
  };
};

const buildAiHistorySummary = (
  overrides: Partial<HealthAiAnswerSummary> = {}
): HealthAiAnswerSummary => ({
  answer_id: 31,
  request_id: 'saved-request',
  patient_id: 8,
  question_id: 'recent_changes',
  question: '最近有哪些变化？',
  range: '5y',
  generated_at: '2026-07-28T05:00:00Z',
  data_cutoff: '2026-06-18',
  provider: 'local_openai_compatible',
  model: '家庭服务器安全整理器',
  test_mode: false,
  record_count: 1,
  ...overrides,
});

describe('HouseholdHealthPrototype', () => {
  it('does not occupy the member page with a development prototype banner', () => {
    renderPrototype();

    expect(
      screen.queryByText('交互原型 · 仅虚构数据 · 不连接数据库/模型')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('开发验收模拟 · 仅虚构数据 · 不连接数据库/真实模型')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '最近的变化' })
    ).toBeInTheDocument();
  });

  it('opens the member privacy access page from more', () => {
    const onOpenPrivacyAccess = vi.fn();
    render(
      <MantineProvider>
        <HouseholdHealthPrototype onOpenPrivacyAccess={onOpenPrivacyAccess} />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: /关系与隐私/ }));

    expect(onOpenPrivacyAccess).toHaveBeenCalledTimes(1);
  });

  it('shows only wired actions in more and opens account settings', () => {
    const onOpenAccountSettings = vi.fn();
    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          onOpenAccountSettings={onOpenAccountSettings}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(
      screen.queryByRole('button', { name: /关系与隐私/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('更多健康记录')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /账号与设备/ }));
    expect(onOpenAccountSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /可查看的档案/ }));
    expect(
      screen.getByRole('heading', { name: '最近的变化' })
    ).toBeInTheDocument();
  });

  it('opens the education-only body and screening navigator from more', () => {
    render(<HouseholdHealthPrototype />);

    const moreNavigation = screen.getByRole('button', { name: '更多' });
    fireEvent.click(moreNavigation);
    fireEvent.click(screen.getByRole('button', { name: /身体与筛查资料/ }));

    expect(
      screen.getByRole('heading', { name: '身体与筛查资料' })
    ).toBeInTheDocument();
    expect(moreNavigation).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('当前未启用个性化筛查计划')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回更多' }));
    expect(screen.getByRole('heading', { name: '我的' })).toBeInTheDocument();
  });

  it('supports the primary desktop navigation and merged health archive', async () => {
    renderPrototype();

    expect(
      screen.getByRole('heading', { name: '最近的变化' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    expect(
      await screen.findByRole('heading', { name: '健康档案' })
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '报告原件' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '指标与趋势' })).toBeInTheDocument();
  });

  it('searches, filters and clears the report archive with a visible result summary', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));

    const search = await screen.findByRole('searchbox', {
      name: '搜索报告',
    });
    fireEvent.change(search, { target: { value: '市第一医院' } });

    expect(screen.getByText('血常规与生化检查')).toBeInTheDocument();
    expect(screen.queryByText('年度体检报告')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('显示 1 / 3 份报告');

    fireEvent.click(screen.getByRole('button', { name: '筛选报告' }));
    expect(
      screen.getByRole('group', { name: '报告筛选条件' })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '报告状态' }), {
      target: { value: '原件已保存' },
    });
    expect(screen.getByText('没有找到报告原件')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除全部条件' }));
    expect(screen.getByText('年度体检报告')).toBeInTheDocument();
    expect(screen.getByText('血常规与生化检查')).toBeInTheDocument();
    expect(screen.getByText('基础状态记录')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('共 3 份报告');
  });

  it('switches the archive trend and exposes an equivalent detail table', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(await screen.findByRole('tab', { name: '指标与趋势' }));

    const weightButton = screen.getByRole('button', {
      name: '查看体重趋势',
    });
    expect(weightButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(weightButton);

    expect(weightButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('体重趋势图')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看体重详细数据' }));

    const detailTable = screen.getByRole('table', {
      name: '体重详细数据',
    });
    expect(within(detailTable).getByText('2026-06-18')).toBeInTheDocument();
    expect(within(detailTable).getByText('68.1 kg')).toBeInTheDocument();
  });

  it('opens an owner-only immutable revision flow from one formal metric row', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(await screen.findByRole('tab', { name: '指标与趋势' }));
    fireEvent.click(screen.getByRole('button', { name: '查看空腹血糖趋势' }));
    fireEvent.click(
      screen.getByRole('button', { name: '查看空腹血糖详细数据' })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: '修订空腹血糖 2026 的正式记录',
      })
    );

    expect(await screen.findByText('修订正式记录')).toBeInTheDocument();
    expect(screen.getByText('当前为第 1 版')).toBeInTheDocument();
    expect(screen.getByText('原值会永久保留')).toBeInTheDocument();
  });

  it('keeps one or two chosen trends on the home page without storing health values', () => {
    renderPrototype();

    expect(screen.getByLabelText('血压趋势图')).toBeInTheDocument();
    expect(screen.getByLabelText('体重趋势图')).toBeInTheDocument();
    expect(screen.queryByLabelText('空腹血糖趋势图')).not.toBeInTheDocument();
    screen.getAllByTestId('trend-area-chart').forEach(chart => {
      expect(chart).toHaveAttribute('data-edge-inset', '40:40');
    });
    screen.getAllByTestId('trend-x-axis').forEach(axis => {
      expect(axis).toHaveAttribute('data-axis-key', 'timestamp');
      expect(axis).toHaveAttribute('data-axis-type', 'number');
      expect(axis).toHaveAttribute('data-axis-scale', 'time');
    });
    screen.getAllByTestId('trend-area').forEach(area => {
      expect(area).toHaveAttribute('data-curve-type', 'monotoneX');
    });

    fireEvent.click(screen.getByRole('button', { name: '管理常看指标' }));
    const dialog = screen.getByRole('dialog', { name: '管理常看指标' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '体重' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '空腹血糖' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));

    expect(screen.getByLabelText('血压趋势图')).toBeInTheDocument();
    expect(screen.queryByLabelText('体重趋势图')).not.toBeInTheDocument();
    expect(screen.getByLabelText('空腹血糖趋势图')).toBeInTheDocument();
  });

  it('emits a complete controlled dashboard preference after a range change', () => {
    const onDashboardPreferencesChange = vi.fn();
    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          dashboardPreferences={{
            pinnedMetricIds: ['demo:blood-pressure'],
            rangesByMetricId: { 'demo:blood-pressure': '2y' },
          }}
          onDashboardPreferencesChange={onDashboardPreferencesChange}
        />
      </MantineProvider>
    );

    fireEvent.change(screen.getByRole('combobox', { name: '血压时间范围' }), {
      target: { value: '5y' },
    });

    expect(onDashboardPreferencesChange).toHaveBeenCalledWith({
      pinnedMetricIds: ['demo:blood-pressure'],
      rangesByMetricId: { 'demo:blood-pressure': '5y' },
    });
  });

  it('uses one filtered point set for an archive chart and its detail table', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(await screen.findByRole('tab', { name: '指标与趋势' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '查看体重趋势',
      })
    );
    fireEvent.change(screen.getByRole('combobox', { name: '时间范围' }), {
      target: { value: '2y' },
    });
    fireEvent.click(screen.getByRole('button', { name: '查看体重详细数据' }));

    const detailTable = screen.getByRole('table', {
      name: '体重详细数据',
    });
    expect(within(detailTable).getByText('2025-01-15')).toBeInTheDocument();
    expect(within(detailTable).getByText('2025-09-10')).toBeInTheDocument();
    expect(within(detailTable).getByText('2026-06-18')).toBeInTheDocument();
    expect(
      within(detailTable).queryByText('2024-03-06')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('2025-01-15—2026-06-18 · 3 条记录')
    ).toBeInTheDocument();
  });

  it('opens the matching archive metric from a home trend card', async () => {
    renderPrototype();

    const weightCard = screen
      .getByRole('heading', { name: '体重趋势' })
      .closest('article');
    expect(weightCard).not.toBeNull();
    fireEvent.click(
      within(weightCard as HTMLElement).getByRole('button', {
        name: '查看详细数据',
      })
    );

    expect(
      await screen.findByRole('tab', {
        name: '指标与趋势',
        selected: true,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '查看体重趋势',
        pressed: true,
      })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('体重趋势图')).toBeInTheDocument();
  });

  it('opens the unified copy preview instead of exposing duplicate actions', () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '复制 / 分享' }));
    expect(
      screen.getByRole('dialog', { name: '复制 / 分享' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '通用数据' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '适合发给 AI' })
    ).toBeInTheDocument();
  });

  it('opens a clean multi-file original-preservation flow from the prominent upload action', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '上传新报告' }));
    expect(
      screen.getByRole('dialog', { name: '上传新报告' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '最多 30 个 · 图片 20 MB/张 · PDF 50 MB/个 · 合计 300 MB'
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText('选择报告文件')).toHaveAttribute('multiple');
    expect(
      screen.getByRole('checkbox', {
        name: '保存后自动开始本地解析',
      })
    ).toBeChecked();
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 50));
    });
    expect(
      screen.queryByRole('region', { name: '发现 1 组图片需要确认' })
    ).not.toBeInTheDocument();
  });

  it('demonstrates local parsing before opening candidate review', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(await screen.findByRole('button', { name: '本地解析' }));

    expect(
      await screen.findByText('sourceParse.successNotice')
    ).toBeInTheDocument();
    expect(screen.getByText('sourceParse.readiness.title')).toBeInTheDocument();
    expect(
      screen.getByText('sourceParse.readiness.worker.running')
    ).toBeInTheDocument();
    expect(
      screen.getByText('sourceParse.summary.formal_write_count')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'sourceParse.openReview' })
    );
    expect(
      await screen.findByText('空腹血糖 5.2 mmol/L 3.9-6.1 正常')
    ).toBeInTheDocument();
    expect(screen.getByText('sourceReview.notice')).toBeInTheDocument();
    expect(
      screen.getByText('sourceReview.subjectMismatchWarningTitle')
    ).toBeInTheDocument();
  });

  it('shows the real report workflow state and resumes the correct step', async () => {
    const onParseReport = vi.fn();
    const experience = buildAuditedReadOnlyExperience();
    experience.capabilities.canUpload = true;
    experience.snapshot.reports[0] = {
      ...experience.snapshot.reports[0],
      statusLabel: '待确认入库',
      processingState: 'ready_to_commit',
      processingHint: '复核已完成，确认后写入正式指标',
      processingAction: 'review_batch',
      processingActionLabel: '确认入库',
      parseTaskId: 51,
      importBatchId: 61,
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={experience}
          onParseReport={onParseReport}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));

    expect(await screen.findByText('待确认入库')).toBeInTheDocument();
    expect(
      screen.getByText('复核已完成，确认后写入正式指标')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认入库' }));
    expect(onParseReport).toHaveBeenCalledWith(41);
  });

  it('keeps a committed report inside the merged metric archive', async () => {
    const onOpenDetails = vi.fn();
    const experience = buildAuditedReadOnlyExperience();
    experience.capabilities.canUpload = true;
    experience.snapshot.reports[0] = {
      ...experience.snapshot.reports[0],
      statusLabel: '已入库',
      processingState: 'committed',
      processingHint: '已写入正式指标，可在趋势面板中查看',
      processingAction: 'view_metrics',
      processingActionLabel: '查看指标',
      parseTaskId: 51,
      importBatchId: 61,
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={experience}
          onOpenDetails={onOpenDetails}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(await screen.findByRole('button', { name: '查看指标' }));

    expect(
      await screen.findByRole('tab', { name: '指标与趋势', selected: true })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '选择一个指标查看趋势' })
    ).toBeInTheDocument();
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('lets a read-only archive download an original without exposing parsing', async () => {
    const onDownloadReport = vi.fn();
    const readOnlyExperience: HouseholdHealthExperienceModel = {
      subject: { id: 8, label: '共享成员', relationshipLabel: '管理员只读' },
      subjects: [{ id: 8, label: '共享成员', relationshipLabel: '管理员只读' }],
      snapshot: {
        subjectState: 'ready',
        metrics: [],
        reports: [
          {
            id: 'source:41',
            sourceDocumentId: 41,
            title: '年度体检报告',
            originalFilename: 'report.pdf',
            date: '2026-06-18',
            facility: '市第一医院',
            typeLabel: '体检报告',
            statusLabel: '原件已保存',
            sizeLabel: '1.0 KB',
            mimeType: 'application/pdf',
          },
        ],
        errors: [],
        loadedAt: '2026-07-27T09:00:00Z',
      },
      capabilities: {
        canUpload: false,
        canExport: false,
        canUseAi: false,
        canViewSources: true,
        canDownloadSources: true,
        canShare: false,
      },
      mode: 'live',
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={readOnlyExperience}
          onDownloadReport={onDownloadReport}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: '下载年度体检报告原件',
      })
    );

    expect(onDownloadReport).toHaveBeenCalledWith(41);
    expect(
      screen.queryByRole('button', { name: '本地解析' })
    ).not.toBeInTheDocument();
  });

  it('previews a supported original and releases its temporary browser URL', async () => {
    const reportBlob = new Blob(['synthetic report'], {
      type: 'application/pdf',
    });
    const onPreviewReport = vi.fn().mockResolvedValue(reportBlob);
    const createObjectURL = vi.fn().mockReturnValue('blob:synthetic-preview');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildAuditedReadOnlyExperience()}
          onPreviewReport={onPreviewReport}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: '预览年度体检报告原件',
      })
    );

    expect(
      await screen.findByRole('dialog', {
        name: '年度体检报告原件预览',
      })
    ).toBeInTheDocument();
    expect(onPreviewReport).toHaveBeenCalledWith(41);
    const previewFrame = await screen.findByTitle('年度体检报告 PDF 原件预览');
    expect(previewFrame).toHaveAttribute('src', 'blob:synthetic-preview');
    expect(previewFrame).toHaveAttribute('sandbox', '');
    expect(previewFrame).toHaveAttribute('referrerpolicy', 'no-referrer');

    fireEvent.click(
      screen.getByRole('button', {
        name: '关闭年度体检报告原件预览',
      })
    );
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-preview');
    });

    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  it('requires the server handoff before an administrator CSV download', async () => {
    downloadBlobMock.mockReset();
    const onPrepareHandoff = vi.fn().mockResolvedValue(undefined);

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildAuditedReadOnlyExperience()}
          onPrepareHandoff={onPrepareHandoff}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 / 打印' }));
    fireEvent.click(await screen.findByRole('button', { name: '下载 CSV' }));

    await waitFor(() => {
      expect(onPrepareHandoff).toHaveBeenCalledWith({
        kind: 'csv',
        scope: 'recent-five-years',
        includeReports: true,
        metricCount: 1,
        reportCount: 1,
      });
      expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    });
  });

  it('audits ordinary clipboard copy and hides the AI-transfer format', async () => {
    const onPrepareHandoff = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildAuditedReadOnlyExperience()}
          onPrepareHandoff={onPrepareHandoff}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '复制 / 分享' }));
    expect(
      screen.queryByRole('button', { name: '适合发给 AI' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认复制' }));

    await waitFor(() => {
      expect(onPrepareHandoff).toHaveBeenCalledWith({
        kind: 'clipboard',
        scope: 'all-loaded',
        includeReports: false,
        metricCount: 1,
        reportCount: 1,
      });
      expect(writeText).toHaveBeenCalledTimes(1);
    });
  });

  it('does not create a local export when handoff authorization fails', async () => {
    downloadBlobMock.mockReset();
    const onPrepareHandoff = vi
      .fn()
      .mockRejectedValue(new Error('audit unavailable'));

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildAuditedReadOnlyExperience()}
          onPrepareHandoff={onPrepareHandoff}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 / 打印' }));
    fireEvent.click(await screen.findByRole('button', { name: '下载 CSV' }));

    expect(
      await screen.findByText('未能记录本次数据交接，已停止导出。')
    ).toBeInTheDocument();
    expect(downloadBlobMock).not.toHaveBeenCalled();
  });

  it('builds the lightweight CSV from the selected loaded dashboard data', async () => {
    downloadBlobMock.mockReset();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '导出 / 打印' }));
    expect(
      await screen.findByRole('heading', { name: '导出与打印' })
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /最近 5 年摘要/ })).toBeChecked();
    expect(
      screen.getByRole('table', { name: '所选指标记录' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载 CSV' }));
    await waitFor(() => {
      expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    });
    expect(downloadBlobMock.mock.calls[0][1]).toMatch(
      /^household-health-summary-\d{4}-\d{2}-\d{2}\.csv$/
    );
    expect(downloadBlobMock.mock.calls[0][1]).not.toContain('林晓');

    fireEvent.click(screen.getByRole('button', { name: '打印 / 保存 PDF' }));
    await waitFor(() => {
      expect(printSpy).toHaveBeenCalledTimes(1);
    });
    printSpy.mockRestore();
  });

  it('opens the internal summary before offering the formal complete-archive export', async () => {
    const openFullExport = vi.fn();
    const liveExperience: HouseholdHealthExperienceModel = {
      subject: { id: 1, label: '本人', relationshipLabel: '我的档案' },
      subjects: [{ id: 1, label: '本人', relationshipLabel: '我的档案' }],
      snapshot: {
        subjectState: 'ready',
        metrics: [
          {
            id: 'vital:weight',
            kind: 'vital',
            label: '体重',
            unit: 'kg',
            latestStatus: null,
            points: [
              {
                id: 'weight-1',
                date: '2025-01-01',
                value: 65,
                secondaryValue: null,
                sourceDocumentId: null,
                status: null,
              },
              {
                id: 'weight-2',
                date: '2026-01-01',
                value: 64,
                secondaryValue: null,
                sourceDocumentId: null,
                status: null,
              },
            ],
          },
        ],
        reports: [],
        errors: [],
        loadedAt: '2026-01-01T00:00:00Z',
      },
      capabilities: {
        canUpload: true,
        canExport: true,
        canUseAi: false,
        canViewSources: true,
      },
      mode: 'live',
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={liveExperience}
          onExport={openFullExport}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '导出 / 打印' }));
    expect(
      await screen.findByRole('heading', { name: '导出与打印' })
    ).toBeInTheDocument();
    expect(openFullExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '打开完整档案导出' }));
    expect(openFullExport).toHaveBeenCalledTimes(1);
  });

  it('does not fabricate an AI answer when the server provider is unavailable', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(
      await screen.findByRole('heading', { name: 'AI 提问' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('准备生成资料包的问题')).toHaveAttribute(
      'maxlength',
      '1000'
    );
    expect(screen.getByText('站内模型尚未配置')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '哪些检查可能需要安排？' })
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '生成提问资料' }));
    expect(
      screen.getByRole('heading', { name: '提问资料预览' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /整理结果|动态测试结果/ })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('使用的来源')).not.toBeInTheDocument();
  });

  it('changes the AI handoff scope without exposing report originals', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(
      await screen.findByRole('heading', { name: 'AI 提问' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /调整范围/ }));
    expect(
      screen.getByRole('dialog', { name: '选择进入资料包的记录' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('报告原件、文件名和正文固定排除')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: /允许读取报告原件/ })
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('时间范围'), {
      target: { value: '3y' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存范围' }));
    expect(
      screen.getByRole('button', { name: /最近 3 年/ })
    ).toBeInTheDocument();
  });

  it('builds dynamic synthetic preview text from citation values and order', () => {
    const first = {
      citation_id: 'R2',
      record_id: 'glucose-2026',
      metric_id: 'lab:glucose:mmol/L',
      label: '空腹血糖',
      date: '2026-06-18',
      value: 5.4,
      secondary_value: null,
      unit: 'mmol/L',
      status: '正常',
      available: true,
    };
    const second = {
      ...first,
      citation_id: 'R1',
      record_id: 'glucose-2025',
      date: '2025-06-18',
      value: 5.1,
    };

    expect(buildDynamicSyntheticPreviewAnswerItems([first, second])).toEqual([
      {
        text: expect.stringContaining(
          '从 2025-06-18 的 5.1 mmol/L（正常）变化到 2026-06-18 的 5.4 mmol/L（正常）'
        ),
        citation_ids: ['R1', 'R2'],
      },
    ]);
    expect(
      buildDynamicSyntheticPreviewAnswerItems([
        {
          ...first,
          value: 6.1,
        },
        second,
      ])[0].text
    ).toContain('6.1 mmol/L');
  });

  it('labels the connected development provider as a non-model dynamic test', async () => {
    window.history.pushState(
      {},
      '',
      '/prototype/household-health?view=ai-connected'
    );
    renderPrototype();

    expect(
      screen.queryByText('开发验收模拟 · 仅虚构数据 · 不连接数据库/真实模型')
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(
      await screen.findByText('虚构数据动态测试已开启')
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/虚构数据动态测试·非模型回答/).length
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '生成提问资料' }));
    fireEvent.click(
      screen.getByRole('button', { name: '运行虚构数据动态测试' })
    );

    expect(
      await screen.findByRole('heading', { name: '虚构数据动态测试结果' })
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/这里只复述所选记录/).length
    ).toBeGreaterThanOrEqual(1);
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 50));
    });
    expect(
      screen.getByRole('heading', { name: '虚构数据动态测试结果' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    ).toHaveTextContent('1 / 1 条');

    window.history.replaceState({}, '', '/');
  });

  it('builds a cited local AI handoff for an owned live archive without faking an answer', async () => {
    const onPrepareHandoff = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const liveOwnerExperience: HouseholdHealthExperienceModel = {
      ...buildAuditedReadOnlyExperience(),
      subject: { id: 8, label: '林晓', relationshipLabel: '我的档案' },
      subjects: [{ id: 8, label: '林晓', relationshipLabel: '我的档案' }],
      capabilities: {
        ...buildAuditedReadOnlyExperience().capabilities,
        canUseAi: true,
        canCopyForAi: true,
      },
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={liveOwnerExperience}
          onPrepareHandoff={onPrepareHandoff}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(
      await screen.findByRole('heading', { name: 'AI 提问' })
    ).toBeInTheDocument();
    expect(screen.getByText('站内模型尚未配置')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '哪些检查可能需要安排？' })
    ).toBeDisabled();
    expect(
      screen.getByText(/必须先有已发布指南和确定性筛查状态/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '最近有哪些变化？' }));
    fireEvent.click(screen.getByRole('button', { name: '生成提问资料' }));

    expect(
      screen.getByRole('heading', { name: '提问资料预览' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/已记录的几项长期指标整体波动不大/)
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制提问资料' }));
    await waitFor(() => {
      expect(onPrepareHandoff).toHaveBeenCalledWith({
        kind: 'clipboard',
        scope: 'recent-five-years',
        includeReports: false,
        metricCount: 1,
        reportCount: 0,
      });
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('主体：当前本人档案');
    expect(copied).toContain('正式记录：glucose-1');
    expect(copied).not.toContain('林晓');
    expect(copied).not.toContain('report.pdf');
    expect(copied).not.toContain('市第一医院');
  });

  it('submits only selected record ids to a connected local model and renders cited sections', async () => {
    const connectedExperience: HouseholdHealthExperienceModel = {
      ...buildAuditedReadOnlyExperience(),
      subject: { id: 8, label: '林晓', relationshipLabel: '我的档案' },
      subjects: [{ id: 8, label: '林晓', relationshipLabel: '我的档案' }],
      snapshot: {
        ...buildAuditedReadOnlyExperience().snapshot,
        metrics: [
          {
            ...buildAuditedReadOnlyExperience().snapshot.metrics[0],
            points: [
              {
                ...buildAuditedReadOnlyExperience().snapshot.metrics[0]
                  .points[0],
                id: 'lab:9',
              },
            ],
          },
        ],
      },
      capabilities: {
        ...buildAuditedReadOnlyExperience().capabilities,
        canUseAi: true,
        canCopyForAi: true,
      },
    };
    const response: HealthAiQuestionResponse = {
      status: 'answered',
      answer_id: 21,
      request_id: 'fixture-request',
      patient_id: 8,
      question_id: 'recent_changes',
      question: '最近有哪些变化？',
      generated_at: '2026-07-28T04:00:00Z',
      scope: {
        range: '5y',
        record_count: 1,
        metric_count: 1,
        data_cutoff: '2026-06-18',
        includes_originals: false,
        includes_narrative_background: false,
        includes_guidance: false,
        includes_screening_state: false,
      },
      processing: {
        provider: 'local_openai_compatible',
        model: 'fixture-local-model',
        processing_location: '家庭服务器处理',
        test_mode: false,
        processing_mode: 'local',
        template_version: 'household-ai-answer@1.0.0',
      },
      answer_items: [
        {
          text: '当前所选记录只能说明一次空腹血糖结果。',
          citation_ids: ['R1'],
        },
      ],
      general_explanations: ['单次结果不能用于判断长期趋势。'],
      citations: [
        {
          citation_id: 'R1',
          record_id: 'lab:9',
          metric_id: connectedExperience.snapshot.metrics[0].id,
          label: '空腹血糖',
          date: '2026-06-18',
          value: 5.2,
          secondary_value: null,
          unit: 'mmol/L',
          status: '正常',
          available: true,
        },
      ],
      limitations: ['当前只有一条所选记录。'],
      next_steps: ['可以在就医时询问是否需要按同一方法复查。'],
      disclaimer: '仅用于资料整理，不构成诊断或治疗建议。',
    };
    const onAskAi = vi.fn().mockResolvedValue(response);

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={connectedExperience}
          aiCapability={{
            available: true,
            provider: 'local_openai_compatible',
            model: 'fixture-local-model',
            processing_location: '家庭服务器处理',
            reason_code: null,
            test_mode: false,
            processing_mode: 'local',
            local_handoff_available: true,
            supported_question_ids: ['recent_changes'],
            screening_question_available: false,
          }}
          onAskAi={onAskAi}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(
      await screen.findByText('家庭服务器安全整理配置已通过门禁')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成提问资料' }));
    fireEvent.click(
      screen.getByRole('button', { name: '家庭服务器安全整理最近变化' })
    );

    await waitFor(() => {
      expect(onAskAi).toHaveBeenCalledWith({
        question_id: 'recent_changes',
        question: '最近有哪些变化？',
        range: '5y',
        record_ids: ['lab:9'],
      });
    });
    expect(
      await screen.findByRole('heading', {
        name: '家庭服务器安全整理结果',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText('当前所选记录只能说明一次空腹血糖结果。')
    ).toBeInTheDocument();
    expect(screen.getAllByText('[R1]')).toHaveLength(2);
    expect(screen.getByText(/2026-06-18 · 空腹血糖/)).toBeInTheDocument();
    expect(
      screen.getByText('仅用于资料整理，不构成诊断或治疗建议。')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    );
    expect(
      screen.getByRole('button', {
        name: '打开回答：最近有哪些变化？',
      })
    ).toBeInTheDocument();
  });

  it('keeps non-recent questions as copy-only handoffs even when the server is connected', async () => {
    const onAskAi = vi.fn();
    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildConnectedOwnerExperience()}
          aiCapability={{
            available: true,
            provider: 'local_openai_compatible',
            model: 'fixture-local-model',
            processing_location: '家庭服务器处理',
            reason_code: null,
            test_mode: false,
            processing_mode: 'local',
            local_handoff_available: true,
            supported_question_ids: ['recent_changes'],
            screening_question_available: false,
          }}
          onAskAi={onAskAi}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: '帮我整理就医前问题',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: '生成提问资料' }));

    expect(
      screen.getByRole('button', { name: '复制提问资料' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: '家庭服务器安全整理最近变化',
      })
    ).not.toBeInTheDocument();
    expect(onAskAi).not.toHaveBeenCalled();
  });

  it('offers scope recovery when the server rejects an oversized AI handoff', async () => {
    const onAskAi = vi.fn().mockRejectedValue(
      Object.assign(new Error('Too many records'), {
        code: 'health_ai_input_too_large',
      })
    );
    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildConnectedOwnerExperience()}
          aiCapability={{
            available: true,
            provider: 'local_openai_compatible',
            model: 'fixture-local-model',
            processing_location: '家庭服务器处理',
            reason_code: null,
            test_mode: false,
            processing_mode: 'local',
            local_handoff_available: true,
            supported_question_ids: ['recent_changes'],
            screening_question_available: false,
          }}
          onAskAi={onAskAi}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '生成提问资料' })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: '家庭服务器安全整理最近变化',
      })
    );

    expect(
      await screen.findByText(
        /所选记录超过家庭服务器上限，请缩短时间范围或减少指标后重试/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '复制提问资料' })
    ).toBeInTheDocument();
  });

  it('labels saved synthetic history from its own metadata, not the current capability', async () => {
    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildConnectedOwnerExperience()}
          aiHistory={[
            {
              answer_id: 41,
              request_id: 'synthetic-history',
              patient_id: 8,
              question_id: 'recent_changes',
              question: '虚构历史记录',
              range: '5y',
              generated_at: '2026-07-28T05:00:00Z',
              data_cutoff: '2026-06-18',
              provider: 'dynamic_test',
              model: 'deterministic-test',
              test_mode: true,
              record_count: 2,
            },
          ]}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    );

    expect(screen.getByText(/虚构测试·非模型/)).toBeInTheDocument();
  });

  it('shows a history load failure with retry instead of claiming there is no history', () => {
    const onRetryAiHistory = vi.fn().mockResolvedValue(undefined);

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildConnectedOwnerExperience()}
          aiHistory={[]}
          aiHistoryTotal={0}
          aiHistoryError="暂时无法读取整理结果，请稍后重试。"
          onRetryAiHistory={onRetryAiHistory}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    );

    expect(
      screen.getByText('暂时无法读取整理结果，请稍后重试。')
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        '还没有保存的结果。完成一次家庭服务器安全整理后会显示在这里。'
      )
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试读取历史回答' }));
    expect(onRetryAiHistory).toHaveBeenCalledTimes(1);
  });

  it('shows the retained total and loads more history without hiding the first page', () => {
    const onLoadMoreAiHistory = vi.fn().mockResolvedValue(undefined);

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={buildConnectedOwnerExperience()}
          aiHistory={[buildAiHistorySummary()]}
          aiHistoryTotal={2}
          onLoadMoreAiHistory={onLoadMoreAiHistory}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    );

    expect(
      screen.getByRole('button', { name: '打开回答：最近有哪些变化？' })
    ).toBeInTheDocument();
    expect(screen.getByText('已显示 1 / 共 2 条')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史回答' }));
    expect(onLoadMoreAiHistory).toHaveBeenCalledTimes(1);
  });

  it('opens a saved answer, follows its exact formal-record citation, and supports deletion', async () => {
    const base = buildAuditedReadOnlyExperience();
    const metric = {
      ...base.snapshot.metrics[0],
      points: [
        {
          ...base.snapshot.metrics[0].points[0],
          id: 'lab:9',
          date: '2026-06-18',
          value: 5.2,
        },
        {
          ...base.snapshot.metrics[0].points[0],
          id: 'lab:10',
          date: '2025-06-18',
          value: 5.0,
        },
      ],
    };
    const experience = {
      ...base,
      mode: 'live' as const,
      snapshot: {
        ...base.snapshot,
        metrics: [metric],
      },
      capabilities: {
        ...base.capabilities,
        canUseAi: true,
        canCopyForAi: true,
      },
    };
    const saved: HealthAiQuestionResponse = {
      status: 'answered',
      answer_id: 31,
      request_id: 'saved-request',
      patient_id: experience.subject?.id ?? 8,
      question_id: 'recent_changes',
      question: '最近有哪些变化？',
      generated_at: '2026-07-28T05:00:00Z',
      scope: {
        range: '5y',
        record_count: 1,
        metric_count: 1,
        data_cutoff: '2026-06-18',
        includes_originals: false,
        includes_narrative_background: false,
        includes_guidance: false,
        includes_screening_state: false,
      },
      processing: {
        provider: 'local_openai_compatible',
        model: 'fixture-local-model',
        processing_location: '家庭服务器处理',
        test_mode: false,
        processing_mode: 'local',
        template_version: 'household-ai-answer@1.0.0',
      },
      answer_items: [
        {
          text: '这是一条已经保存的回答。',
          citation_ids: ['R1'],
        },
      ],
      general_explanations: [],
      citations: [
        {
          citation_id: 'R1',
          record_id: 'lab:9',
          metric_id: metric.id,
          label: metric.label,
          date: '2026-06-18',
          value: 5.2,
          secondary_value: null,
          unit: metric.unit,
          status: '正常',
          available: true,
        },
      ],
      limitations: ['仅使用所选记录。'],
      next_steps: [],
      disclaimer: '仅用于资料整理，不构成诊断或治疗建议。',
    };
    const onOpenAiHistory = vi.fn().mockResolvedValue(saved);
    const onDeleteAiHistory = vi.fn().mockResolvedValue(undefined);

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          experience={experience}
          aiHistory={[
            {
              answer_id: 31,
              request_id: 'saved-request',
              patient_id: saved.patient_id,
              question_id: 'recent_changes',
              question: '最近有哪些变化？',
              range: '5y',
              generated_at: '2026-07-28T05:00:00Z',
              data_cutoff: '2026-06-18',
              provider: 'local_openai_compatible',
              model: 'fixture-local-model',
              test_mode: false,
              record_count: 1,
            },
          ]}
          onOpenAiHistory={onOpenAiHistory}
          onDeleteAiHistory={onDeleteAiHistory}
        />
      </MantineProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    );
    fireEvent.click(
      screen.getByRole('button', { name: '打开回答：最近有哪些变化？' })
    );
    expect(onOpenAiHistory).toHaveBeenCalledWith(31);
    expect(
      await screen.findByText('这是一条已经保存的回答。')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: `打开 R1：${metric.label}正式记录`,
      })
    );
    expect(
      await screen.findByRole('heading', { name: '健康档案' })
    ).toBeInTheDocument();
    const targetRow = screen.getByRole('row', {
      name: new RegExp(`2026-06-18.*5.2.*${metric.unit}`),
    });
    expect(targetRow).toHaveClass('is-citation-target');

    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: '查看最近的家庭服务器整理结果',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: '删除历史回答：最近有哪些变化？',
      })
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: '确认删除历史回答：最近有哪些变化？',
      })
    );
    await waitFor(() => expect(onDeleteAiHistory).toHaveBeenCalledWith(31));
    expect(
      screen.queryByRole('button', { name: '打开回答：最近有哪些变化？' })
    ).not.toBeInTheDocument();
  }, 15_000);

  it('keeps the synthetic shared-subject demo inside the structured-dashboard boundary', async () => {
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '我的档案 · 林晓' }));
    fireEvent.click(screen.getByRole('button', { name: '可查看的档案王芳' }));

    expect(
      await screen.findByRole('heading', { name: '最近的变化' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/共享档案只展示结构化指标与趋势/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '上传新报告' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '复制 / 分享' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '导出 / 打印' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'AI 助手' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('最近报告')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    fireEvent.click(await screen.findByRole('tab', { name: '指标与趋势' }));
    fireEvent.click(screen.getByRole('button', { name: '查看空腹血糖趋势' }));
    fireEvent.click(
      screen.getByRole('button', { name: '查看空腹血糖详细数据' })
    );
    expect(
      screen.queryByRole('button', {
        name: '修订空腹血糖 2026 的正式记录',
      })
    ).not.toBeInTheDocument();
  });

  it('closes the subject switcher when navigation continues outside it', () => {
    renderPrototype();

    const subjectSwitcher = screen.getByRole('button', {
      name: '我的档案 · 林晓',
    });
    fireEvent.click(subjectSwitcher);
    expect(subjectSwitcher).toHaveAttribute('aria-expanded', 'true');

    const assistantNavigation = screen.getByRole('button', {
      name: 'AI 助手',
    });
    fireEvent.pointerDown(assistantNavigation);
    fireEvent.click(assistantNavigation);

    expect(subjectSwitcher).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: '可查看的档案王芳' })
    ).not.toBeInTheDocument();
    expect(assistantNavigation).toHaveAttribute('aria-current', 'page');
  });

  it('shows a truthful empty state and hides owner-only actions for a shared live archive', () => {
    const sharedExperience: HouseholdHealthExperienceModel = {
      subject: { id: 8, label: '共享成员', relationshipLabel: '可查看的档案' },
      subjects: [
        { id: 8, label: '共享成员', relationshipLabel: '可查看的档案' },
      ],
      snapshot: {
        subjectState: 'ready',
        metrics: [],
        reports: [],
        errors: [],
        loadedAt: '2026-07-27T09:00:00Z',
      },
      capabilities: {
        canUpload: false,
        canExport: false,
        canUseAi: false,
        canViewSources: false,
      },
      mode: 'live',
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype experience={sharedExperience} />
      </MantineProvider>
    );

    expect(screen.getByText('还没有可绘制的长期趋势')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '上传新报告' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '导出 / 打印' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'AI 助手' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('最近报告')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /复制一份去标识化资料摘要/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '健康档案' }));
    expect(screen.getByRole('tab', { name: '指标与趋势' })).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: '报告原件' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: '体检对比' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: '数据质量' })
    ).not.toBeInTheDocument();
  });

  it('rejects a direct assistant page request for a shared archive', async () => {
    const onPageChange = vi.fn();

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          page="assistant"
          experience={buildAuditedReadOnlyExperience()}
          onPageChange={onPageChange}
        />
      </MantineProvider>
    );

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith('home'));
    expect(
      screen.queryByRole('heading', { name: 'AI 提问' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '生成提问资料' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '复制提问资料' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'AI 助手' })
    ).not.toBeInTheDocument();
  });

  it('rejects a direct export page request for an archive without export access', async () => {
    const onPageChange = vi.fn();
    const base = buildAuditedReadOnlyExperience();
    const sharedExperience: HouseholdHealthExperienceModel = {
      ...base,
      capabilities: {
        ...base.capabilities,
        canExport: false,
        canShare: false,
        canCopyForAi: false,
      },
    };

    render(
      <MantineProvider>
        <HouseholdHealthPrototype
          page="export"
          experience={sharedExperience}
          onPageChange={onPageChange}
        />
      </MantineProvider>
    );

    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith('home'));
    expect(
      screen.queryByRole('heading', { name: '导出与打印' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '下载 CSV' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '复制所选摘要' })
    ).not.toBeInTheDocument();
  });

  it('closes a share preview before switching from the owner to a shared archive', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderPrototype();

    fireEvent.click(screen.getByRole('button', { name: '复制 / 分享' }));
    expect(
      screen.getByRole('dialog', { name: '复制 / 分享' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '我的档案 · 林晓' }));
    fireEvent.click(screen.getByRole('button', { name: '可查看的档案王芳' }));

    expect(
      await screen.findByText(/共享档案只展示结构化指标与趋势/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: '复制 / 分享' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '确认复制' })
    ).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});
