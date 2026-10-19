import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BackupHealthOverview, {
  buildBackupHealthSummary,
} from './BackupHealthOverview';

const latestBackup = {
  id: 7,
  backup_type: 'full',
  status: 'verified',
  file_exists: true,
  created_at: '2026-07-21T12:00:00Z',
  integrity_status: 'verified',
  integrity_verified_at: '2026-07-21T12:05:00Z',
  restore_test_status: 'passed',
  restore_tested_at: '2026-07-21T12:10:00Z',
};

describe('BackupHealthOverview', () => {
  it('keeps archive verification separate from restore testing', () => {
    const summary = buildBackupHealthSummary(
      [{ ...latestBackup, restore_test_status: null }],
      { enabled: true },
      new Date('2026-07-22T12:00:00Z')
    );

    expect(summary.integrityStatus).toBe('verified');
    expect(summary.restoreStatus).toBe('not_tested');
    expect(summary.warnings).toContain('restorePending');
  });

  it('renders all five readiness dimensions', () => {
    render(
      <MantineProvider>
        <BackupHealthOverview
          backups={[latestBackup]}
          schedule={{
            enabled: true,
            next_run_at: '2026-07-23T02:00:00Z',
            replica_enabled: true,
            replica_target_label: 'Synthetic target',
          }}
          now={new Date('2026-07-22T12:00:00Z')}
          formatDateTime={value => value}
        />
      </MantineProvider>
    );

    expect(screen.getByText('Latest full backup')).toBeInTheDocument();
    expect(screen.getByText('Archive integrity')).toBeInTheDocument();
    expect(screen.getByText('Isolated restore drill')).toBeInTheDocument();
    expect(screen.getByText('Automatic schedule')).toBeInTheDocument();
    expect(screen.getByText('Configured copy target')).toBeInTheDocument();
    expect(
      screen.getByText(/only an isolated restore drill checks/i)
    ).toBeInTheDocument();
  });
});
