import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthBackgroundPanel from './HealthBackgroundPanel';

const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revise: vi.fn(),
  void: vi.fn(),
}));

vi.mock('../../services/api/healthBackgroundApi', () => ({
  default: apiMocks,
}));

vi.mock('../../services/api/healthImportApi', () => ({
  default: {
    listSourceDocuments: vi.fn().mockResolvedValue([]),
  },
}));

const entry = {
  id: 5,
  patient_id: 7,
  created_by_user_id: 2,
  record_key: 'synthetic-record-key',
  version_number: 2,
  supersedes_entry_id: 4,
  category: 'lifestyle' as const,
  title: 'Synthetic daily routine',
  narrative: 'Synthetic timeline narrative.',
  effective_date: '2026-02-01',
  verification_status: 'confirmed' as const,
  source_document_id: 11,
  source_page: 3,
  source_locator: 'Synthetic section',
  status: 'active' as const,
  is_current: true,
  change_note: 'Synthetic correction',
  created_at: '2026-02-02T00:00:00Z',
};

describe('HealthBackgroundPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.list.mockResolvedValue([entry]);
  });

  it('shows the current version, provenance and revision controls', async () => {
    render(
      <MantineProvider>
        <Notifications />
        <HealthBackgroundPanel patientId={7} />
      </MantineProvider>
    );

    expect(
      await screen.findByText('Synthetic daily routine')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Synthetic timeline narrative.')
    ).toBeInTheDocument();
    expect(screen.getByText(/Synthetic section/)).toBeInTheDocument();
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /healthBackground.revise/ })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(apiMocks.list).toHaveBeenCalledWith(
        7,
        false,
        expect.any(AbortSignal)
      )
    );
  });

  it('reloads complete history when the history switch is enabled', async () => {
    render(
      <MantineProvider>
        <Notifications />
        <HealthBackgroundPanel patientId={7} />
      </MantineProvider>
    );
    const history = await screen.findByRole('switch', {
      name: 'healthBackground.showHistory',
    });
    fireEvent.click(history);
    await waitFor(() =>
      expect(apiMocks.list).toHaveBeenLastCalledWith(
        7,
        true,
        expect.any(AbortSignal)
      )
    );
  });
});
