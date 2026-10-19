import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LabTestComponentForStack } from '../../services/api/labTestComponentApi';
import { buildHealthExamComparison } from '../../utils/healthExamComparison';
import HealthExamComparison from './HealthExamComparison';

const component = (
  id: number,
  overrides: Partial<LabTestComponentForStack> = {}
): LabTestComponentForStack => ({
  id,
  lab_result_id: 1000 + id,
  test_name: 'Synthetic metric A',
  canonical_test_name: 'synthetic-a',
  value: 10,
  unit: 'u/L',
  result_type: 'quantitative',
  completed_date: '2025-01-10',
  source_document_id: 101,
  ...overrides,
});

const renderComparison = (
  overrides: Partial<ComponentProps<typeof HealthExamComparison>> = {}
) => {
  const comparison = buildHealthExamComparison([
    component(1),
    component(2, {
      source_document_id: 102,
      completed_date: '2026-01-10',
      value: 12,
    }),
  ]);
  const props = {
    comparison,
    loading: false,
    error: false,
    partial: false,
    onSelectionChange: vi.fn(),
    onOpenSourceDocument: vi.fn(),
    onOpenLabRecord: vi.fn(),
    ...overrides,
  };

  render(
    <MantineProvider>
      <HealthExamComparison {...props} />
    </MantineProvider>
  );
  return props;
};

describe('HealthExamComparison', () => {
  it('renders an evidence-backed absolute comparison and source links', () => {
    const props = renderComparison();

    expect(screen.getByText('Exam comparison')).toBeInTheDocument();
    expect(
      screen.getByText(/does not prove the test was not performed/i)
    ).toBeInTheDocument();
    expect(screen.getByText('+2 u/L')).toBeInTheDocument();
    expect(screen.getByText(/Absolute difference only/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open lab record 1001' })
    ).toHaveTextContent('#1001');

    fireEvent.click(
      screen.getByRole('button', { name: 'Open source document 102' })
    );
    expect(props.onOpenSourceDocument).toHaveBeenCalledWith(102);
  });

  it('shows the partial coverage warning without claiming completeness', () => {
    renderComparison({ partial: true });

    expect(
      screen.getByText(/Only the latest 2000 components are loaded/i)
    ).toBeInTheDocument();
  });

  it('shows an explicit empty state with fewer than two dated episodes', () => {
    renderComparison({
      comparison: buildHealthExamComparison([component(1)]),
    });

    expect(
      screen.getByText(/At least two dated exam episodes/i)
    ).toBeInTheDocument();
  });
});
