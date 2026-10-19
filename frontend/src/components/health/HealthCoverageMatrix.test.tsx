import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HealthCoverageMatrix from './HealthCoverageMatrix';

const exact = {
  dates: ['2025-01-10', '2026-01-10'],
  rows: [
    {
      key: 'synthetic-a',
      metricName: 'Synthetic metric A',
      cells: {
        '2025-01-10': {
          count: 1,
          statuses: ['normal'],
          units: ['u/L'],
          labResultIds: [101],
        },
        '2026-01-10': {
          count: 1,
          statuses: ['high'],
          units: ['u/L'],
          labResultIds: [102],
        },
      },
    },
  ],
  excludedWithoutDate: 0,
};

const annual = {
  ...exact,
  dates: ['2025', '2026'],
  rows: [
    {
      ...exact.rows[0],
      cells: {
        '2025': exact.rows[0].cells['2025-01-10'],
        '2026': exact.rows[0].cells['2026-01-10'],
      },
    },
  ],
};

describe('HealthCoverageMatrix', () => {
  it('switches between exact-date and annual evidence without changing meaning', () => {
    render(
      <MantineProvider>
        <HealthCoverageMatrix
          matrix={exact}
          annualMatrix={annual}
          loading={false}
          error={false}
        />
      </MantineProvider>
    );

    expect(screen.getByText('2025-01-10')).toBeInTheDocument();
    fireEvent.click(screen.getByText('By year'));
    expect(screen.getByText('2 years')).toBeInTheDocument();
    expect(screen.getByText('2025')).toBeInTheDocument();
    expect(screen.queryByText('2025-01-10')).not.toBeInTheDocument();
  });
});
