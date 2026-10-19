import {
  Alert,
  Badge,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCopyCheck,
  IconDatabaseExport,
  IconRestore,
  IconShieldCheck,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

export const buildBackupHealthSummary = (
  backups,
  schedule,
  now = new Date()
) => {
  const latestFull = [...(backups || [])]
    .filter(backup => backup.backup_type === 'full')
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
    )[0];
  const createdAt = latestFull ? new Date(latestFull.created_at) : null;
  const ageHours =
    createdAt && !Number.isNaN(createdAt.getTime())
      ? Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 36e5))
      : null;
  const integrityStatus =
    latestFull?.integrity_status ||
    (latestFull?.status === 'verified' ? 'verified' : 'not_checked');
  const restoreStatus = latestFull?.restore_test_status || 'not_tested';
  const replicaStatus =
    latestFull?.replica_status ||
    (schedule?.last_backup_id === latestFull?.id
      ? schedule?.last_replica_status
      : null) ||
    (schedule?.replica_enabled ? 'not_copied' : 'not_configured');

  const warnings = [];
  if (!latestFull) warnings.push('noFullBackup');
  else if (!latestFull.file_exists) warnings.push('fileMissing');
  else if (ageHours !== null && ageHours > 24 * 7) warnings.push('backupOld');
  if (latestFull && integrityStatus !== 'verified') {
    warnings.push('integrityPending');
  }
  if (latestFull && restoreStatus !== 'passed') {
    warnings.push(
      restoreStatus === 'failed' ? 'restoreFailed' : 'restorePending'
    );
  }
  if (!schedule?.enabled) warnings.push('scheduleDisabled');
  if (!schedule?.replica_enabled) warnings.push('replicaNotConfigured');
  else if (replicaStatus !== 'copied') {
    warnings.push(
      replicaStatus === 'failed' ? 'replicaFailed' : 'replicaPending'
    );
  }

  return {
    latestFull,
    ageHours,
    integrityStatus,
    restoreStatus,
    replicaStatus,
    warnings,
  };
};

const statusColor = status => {
  if (['verified', 'passed', 'enabled', 'copied'].includes(status))
    return 'teal';
  if (['failed', 'missing', 'corrupted'].includes(status)) return 'red';
  return 'orange';
};

const BackupHealthOverview = ({ backups, schedule, formatDateTime, now }) => {
  const { t } = useTranslation('admin');
  const summary = buildBackupHealthSummary(backups, schedule, now);
  const latest = summary.latestFull;

  const cards = [
    {
      key: 'latest',
      icon: IconDatabaseExport,
      color: latest?.file_exists ? 'blue' : 'red',
      title: t('backup.healthOverview.latestFull', 'Latest full backup'),
      value: latest
        ? formatDateTime(latest.created_at)
        : t('backup.healthOverview.none', 'None'),
      detail:
        summary.ageHours === null
          ? t('backup.healthOverview.noAge', 'No backup age available')
          : t('backup.healthOverview.ageHours', '{{count}} hours old', {
              count: summary.ageHours,
            }),
    },
    {
      key: 'integrity',
      icon: IconShieldCheck,
      color: statusColor(summary.integrityStatus),
      title: t('backup.healthOverview.integrity', 'Archive integrity'),
      value: t(`backup.healthOverview.statuses.${summary.integrityStatus}`),
      detail: latest?.integrity_verified_at
        ? formatDateTime(latest.integrity_verified_at)
        : t('backup.healthOverview.neverChecked', 'Not checked yet'),
    },
    {
      key: 'restore',
      icon: IconRestore,
      color: statusColor(summary.restoreStatus),
      title: t('backup.healthOverview.restoreDrill', 'Isolated restore drill'),
      value: t(`backup.healthOverview.statuses.${summary.restoreStatus}`),
      detail: latest?.restore_tested_at
        ? formatDateTime(latest.restore_tested_at)
        : t('backup.healthOverview.neverTested', 'Not tested yet'),
    },
    {
      key: 'schedule',
      icon: IconCalendarEvent,
      color: schedule?.enabled ? 'teal' : 'orange',
      title: t('backup.healthOverview.schedule', 'Automatic schedule'),
      value: schedule?.enabled
        ? t('backup.healthOverview.statuses.enabled', 'Enabled')
        : t('backup.healthOverview.statuses.disabled', 'Disabled'),
      detail: schedule?.next_run_at
        ? t('backup.healthOverview.nextRun', 'Next: {{date}}', {
            date: formatDateTime(schedule.next_run_at),
          })
        : t('backup.healthOverview.noNextRun', 'No next run scheduled'),
    },
    {
      key: 'replica',
      icon: IconCopyCheck,
      color: statusColor(summary.replicaStatus),
      title: t('backup.healthOverview.replica', 'Configured copy target'),
      value: t(`backup.healthOverview.statuses.${summary.replicaStatus}`),
      detail: latest?.replicated_at
        ? t('backup.healthOverview.copiedAt', 'Copied: {{date}}', {
            date: formatDateTime(latest.replicated_at),
          })
        : schedule?.replica_target_label ||
          t(
            'backup.healthOverview.noReplicaTarget',
            'No copy target configured'
          ),
    },
  ];

  return (
    <Card shadow="sm" p="lg" mb="xl" withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={3}>
              {t('backup.healthOverview.title', 'Backup readiness')}
            </Title>
            <Text size="sm" c="dimmed">
              {t(
                'backup.healthOverview.description',
                'Creation, integrity verification and restore testing are separate checks.'
              )}
            </Text>
          </div>
          <Badge
            color={summary.warnings.length === 0 ? 'teal' : 'orange'}
            variant="light"
          >
            {summary.warnings.length === 0
              ? t('backup.healthOverview.ready', 'Ready')
              : t(
                  'backup.healthOverview.attention',
                  '{{count}} items to review',
                  {
                    count: summary.warnings.length,
                  }
                )}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
          {cards.map(card => {
            const Icon = card.icon;
            return (
              <Card key={card.key} withBorder radius="md" p="md">
                <Group align="flex-start" wrap="nowrap">
                  <ThemeIcon color={card.color} variant="light" size="lg">
                    <Icon size={20} />
                  </ThemeIcon>
                  <div>
                    <Text size="xs" c="dimmed">
                      {card.title}
                    </Text>
                    <Text fw={700}>{card.value}</Text>
                    <Text size="xs" c="dimmed">
                      {card.detail}
                    </Text>
                  </div>
                </Group>
              </Card>
            );
          })}
        </SimpleGrid>

        {summary.warnings.length > 0 && (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
            <Text size="sm" fw={650}>
              {t('backup.healthOverview.warningTitle', 'Readiness notes')}
            </Text>
            <Text size="sm">
              {summary.warnings
                .map(key => t(`backup.healthOverview.warnings.${key}`))
                .join(' · ')}
            </Text>
          </Alert>
        )}

        <Alert color="blue" variant="light">
          <Text size="xs">
            {t(
              'backup.healthOverview.scopeNote',
              'Integrity verification checks the archive; only an isolated restore drill checks whether its database can actually be restored. A configured copy target is not proof that the copy is on another physical device.'
            )}
          </Text>
        </Alert>
      </Stack>
    </Card>
  );
};

export default BackupHealthOverview;
