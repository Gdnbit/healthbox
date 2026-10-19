import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconCalendar,
  IconChartLine,
  IconDatabase,
  IconDroplet,
  IconHeart,
  IconRefresh,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { VitalTrendsPanel } from '../medical/vitals';
import type { VitalType } from '../medical/vitals/types';
import { useUserPreferences } from '../../contexts/UserPreferencesContext';
import { useDateFormat } from '../../hooks/useDateFormat';
import logger from '../../services/logger';
import { vitalsService } from '../../services/medical/vitalsService';
import {
  buildVitalCatalog,
  formatVitalCatalogValue,
  type UnitSystem,
  type VitalCatalogEntry,
  type VitalCatalogSummary,
  type VitalRecordLike,
} from '../../utils/vitalInsights';

interface VitalInsightsPanelProps {
  patientId: number;
  patientHeight?: number | null;
  patientLabel: string;
}

interface VitalsStatsLike {
  total_readings?: number | null;
}

const iconForType = (type: VitalCatalogEntry['type']) => {
  if (type === 'blood_pressure') return IconHeart;
  if (type === 'blood_glucose' || type === 'a1c') return IconDroplet;
  return IconActivity;
};

const emptySummary = (): VitalCatalogSummary => buildVitalCatalog([]);

const normalizeRecords = (response: unknown): VitalRecordLike[] => {
  if (Array.isArray(response)) return response as VitalRecordLike[];
  if (
    response &&
    typeof response === 'object' &&
    Array.isArray((response as { data?: unknown }).data)
  ) {
    return (response as { data: VitalRecordLike[] }).data;
  }
  return [];
};

const normalizeStats = (response: unknown): VitalsStatsLike | null => {
  if (!response || typeof response !== 'object') return null;
  const data = (response as { data?: unknown }).data;
  if (data && typeof data === 'object') return data as VitalsStatsLike;
  return response as VitalsStatsLike;
};

const VitalInsightsPanel = ({
  patientId,
  patientHeight,
  patientLabel,
}: VitalInsightsPanelProps) => {
  const { t } = useTranslation('healthInsights');
  const navigate = useNavigate();
  const { unitSystem } = useUserPreferences() as {
    unitSystem: UnitSystem;
  };
  const { formatDate } = useDateFormat() as {
    formatDate: (_value: string) => string;
  };
  const [summary, setSummary] = useState<VitalCatalogSummary>(emptySummary);
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const [statsUnavailable, setStatsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedType, setSelectedType] = useState<VitalType | null>(null);
  const [trendsOpened, setTrendsOpened] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setStatsUnavailable(false);
    setServerTotal(null);
    setSummary(emptySummary());
    setSelectedType(null);
    setTrendsOpened(false);

    Promise.allSettled([
      vitalsService.getPatientVitals(patientId),
      vitalsService.getPatientVitalsStats(patientId),
    ])
      .then(([recordsResult, statsResult]) => {
        if (cancelled) return;
        if (recordsResult.status === 'rejected') {
          logger.error('vital_insights_records_load_error', {
            component: 'VitalInsightsPanel',
            patientId,
            error:
              recordsResult.reason instanceof Error
                ? recordsResult.reason.message
                : String(recordsResult.reason),
          });
          setError(true);
          return;
        }

        const records = normalizeRecords(recordsResult.value);
        setSummary(buildVitalCatalog(records));

        if (statsResult.status === 'fulfilled') {
          const stats = normalizeStats(statsResult.value);
          const total = Number(stats?.total_readings);
          setServerTotal(Number.isFinite(total) && total >= 0 ? total : null);
          setStatsUnavailable(false);
        } else {
          logger.error('vital_insights_stats_load_error', {
            component: 'VitalInsightsPanel',
            patientId,
            error:
              statsResult.reason instanceof Error
                ? statsResult.reason.message
                : String(statsResult.reason),
          });
          setStatsUnavailable(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [patientId, reloadToken]);

  const partialCoverage =
    serverTotal !== null && serverTotal > summary.loadedRecordCount;
  const displayedTotal = serverTotal ?? summary.loadedRecordCount;

  const cards = useMemo(
    () =>
      summary.entries.map(entry => ({
        entry,
        display: formatVitalCatalogValue(entry, unitSystem),
      })),
    [summary.entries, unitSystem]
  );

  const openTrend = (type: VitalType) => {
    setSelectedType(type);
    setTrendsOpened(true);
  };

  if (loading) {
    return (
      <Paper withBorder radius="md" p="xl">
        <Center mih={220}>
          <Loader aria-label={t('vitals.loading', 'Loading vital signs')} />
        </Center>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
        <Stack gap="sm" align="flex-start">
          <Text>{t('vitals.loadError', 'Unable to load vital signs.')}</Text>
          <Button
            variant="light"
            color="red"
            size="xs"
            onClick={() => setReloadToken(value => value + 1)}
          >
            {t('actions.retry', 'Try again')}
          </Button>
        </Stack>
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Card withBorder radius="md" padding="lg">
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Title order={3}>{t('vitals.title', 'Vital signs')}</Title>
              <Text size="sm" c="dimmed" mt={4} maw={720}>
                {t(
                  'vitals.description',
                  'Review stored vital-sign coverage and open the existing chart and data table for each measurement type.'
                )}
              </Text>
            </Box>
            <Group gap="xs">
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<IconRefresh size={15} />}
                onClick={() => setReloadToken(value => value + 1)}
              >
                {t('actions.refresh', 'Refresh')}
              </Button>
              <Button size="compact-sm" onClick={() => navigate('/vitals')}>
                {t('vitals.manage', 'Manage vital signs')}
              </Button>
            </Group>
          </Group>

          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            <Card withBorder padding="md">
              <Group wrap="nowrap">
                <ThemeIcon variant="light" color="blue">
                  <IconActivity size={18} />
                </ThemeIcon>
                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals.summary.types', 'Types with data')}
                  </Text>
                  <Text fw={700} size="xl">
                    {summary.availableTypeCount}
                  </Text>
                </Box>
              </Group>
            </Card>
            <Card withBorder padding="md">
              <Group wrap="nowrap">
                <ThemeIcon variant="light" color="indigo">
                  <IconDatabase size={18} />
                </ThemeIcon>
                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals.summary.records', 'Stored records')}
                  </Text>
                  <Text fw={700} size="xl">
                    {displayedTotal}
                  </Text>
                </Box>
              </Group>
            </Card>
            <Card withBorder padding="md">
              <Group wrap="nowrap">
                <ThemeIcon variant="light" color="cyan">
                  <IconChartLine size={18} />
                </ThemeIcon>
                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals.summary.trends', 'Types with history')}
                  </Text>
                  <Text fw={700} size="xl">
                    {summary.trendTypeCount}
                  </Text>
                </Box>
              </Group>
            </Card>
            <Card withBorder padding="md">
              <Group wrap="nowrap">
                <ThemeIcon variant="light" color="gray">
                  <IconCalendar size={18} />
                </ThemeIcon>
                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals.summary.latest', 'Most recent record')}
                  </Text>
                  <Text fw={700}>
                    {summary.latestDate ? formatDate(summary.latestDate) : '—'}
                  </Text>
                </Box>
              </Group>
            </Card>
          </SimpleGrid>
        </Stack>
      </Card>

      {(partialCoverage || statsUnavailable) && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          {partialCoverage
            ? t(
                'vitals.partialCoverage',
                'The server contains {{total}} records, but this directory loaded {{loaded}}. Counts by type are partial.',
                { total: serverTotal, loaded: summary.loadedRecordCount }
              )
            : t(
                'vitals.coverageUnknown',
                'The total-count check is unavailable. The directory is based on the records loaded in this view.'
              )}
        </Alert>
      )}

      {cards.length === 0 ? (
        <Paper withBorder radius="md" p="xl">
          <Center mih={180}>
            <Stack align="center" gap="sm">
              <IconActivity size={38} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed" ta="center">
                {t(
                  'vitals.empty',
                  'No structured vital-sign measurements have been stored for this family member.'
                )}
              </Text>
              <Button variant="light" onClick={() => navigate('/vitals')}>
                {t('vitals.addFirst', 'Add a vital-sign record')}
              </Button>
            </Stack>
          </Center>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
          {cards.map(({ entry, display }) => {
            const Icon = iconForType(entry.type);
            return (
              <UnstyledButton
                key={entry.type}
                onClick={() => openTrend(entry.type)}
                aria-label={t(
                  'vitals.openTrend',
                  'Open {{type}} trend and data table',
                  { type: t(`vitals.types.${entry.type}`, entry.type) }
                )}
                style={theme => ({
                  border: `1px solid ${theme.colors.gray[3]}`,
                  borderRadius: theme.radius.md,
                  background: 'var(--mantine-color-body)',
                  padding: theme.spacing.md,
                })}
              >
                <Stack gap="sm">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                      <ThemeIcon variant="light" color="blue">
                        <Icon size={18} />
                      </ThemeIcon>
                      <Text fw={650} lineClamp={1}>
                        {t(`vitals.types.${entry.type}`, entry.type)}
                      </Text>
                    </Group>
                    <IconChartLine
                      size={16}
                      color="var(--mantine-color-dimmed)"
                    />
                  </Group>
                  <Group gap="xs" align="baseline">
                    <Text size="xl" fw={700}>
                      {display.value}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {display.unit}
                    </Text>
                  </Group>
                  <Group justify="space-between" gap="xs">
                    <Badge variant="light">
                      {t('vitals.recordCount', '{{count}} records', {
                        count: entry.count,
                      })}
                    </Badge>
                    <Text size="xs" c="dimmed">
                      {formatDate(entry.latestDate)}
                    </Text>
                  </Group>
                </Stack>
              </UnstyledButton>
            );
          })}
        </SimpleGrid>
      )}

      <VitalTrendsPanel
        opened={trendsOpened}
        onClose={() => setTrendsOpened(false)}
        vitalType={selectedType}
        patientId={patientId}
        patientHeight={patientHeight}
        patientLabel={patientLabel}
        onOpenRecord={recordId => navigate(`/vitals?view=${recordId}`)}
      />
    </Stack>
  );
};

export default VitalInsightsPanel;
