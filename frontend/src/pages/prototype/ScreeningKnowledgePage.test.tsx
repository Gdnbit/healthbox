import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ScreeningKnowledgePage from './ScreeningKnowledgePage';

describe('ScreeningKnowledgePage', () => {
  it('renders a non-personal education navigator with the medical review gate', () => {
    render(<ScreeningKnowledgePage onBack={vi.fn()} />);

    expect(
      screen.getByText('人体图仅用于查找资料，不代表患病风险')
    ).toBeInTheDocument();
    expect(screen.getByText('当前未启用个性化筛查计划')).toBeInTheDocument();
    expect(
      screen.getByText(/筛查不是诊断，正常或未到期也不代表没有疾病/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/你已到期|你的风险|建议每.*年/)
    ).not.toBeInTheDocument();
  });

  it('switches female, male, shared and systemic topic lists without inferring eligibility', () => {
    render(<ScreeningKnowledgePage onBack={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /打开主题：宫颈筛查资料/ })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '男性' }));
    expect(
      screen.getByRole('button', { name: /打开主题：前列腺筛查资料/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /打开主题：宫颈筛查资料/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全身' }));
    expect(
      screen.getByRole('button', { name: /打开主题：骨骼健康筛查资料/ })
    ).toBeInTheDocument();
  });

  it('opens a topic from the keyboard-equivalent list and exposes the official source', () => {
    render(<ScreeningKnowledgePage onBack={vi.fn()} />);

    fireEvent.click(
      screen.getByRole('button', { name: /打开主题：乳腺筛查资料/ })
    );

    expect(
      screen.getByRole('heading', { name: '乳腺筛查资料' })
    ).toBeInTheDocument();
    const sourceLink = screen.getByRole('link', {
      name: /查看国家卫生健康委员会原文/,
    });
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByText('资料导航 · 待医学复核')).toBeInTheDocument();
  });

  it('supports keyboard activation of body hotspots and returns to more', () => {
    const onBack = vi.fn();
    render(<ScreeningKnowledgePage onBack={onBack} />);

    const hotspot = screen.getByRole('button', {
      name: /人体图主题：乳腺筛查资料/,
    });
    fireEvent.keyDown(hotspot, { key: 'Enter' });
    expect(
      screen.getByRole('heading', { name: '乳腺筛查资料' })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回更多' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
