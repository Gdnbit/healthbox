import {
  Alert,
  Badge,
  Box,
  Card,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconCalendar,
  IconChartLine,
  IconDatabase,
  IconChecklist,
  IconUsers,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { FamilyMemberHealthSummary } from '../../utils/householdHealthDashboard';

export interface HouseholdSnapshot {
  patient: {
    id: number;
    first_name?: string | null;
    last_name?: string | null;
  };
  summary: FamilyMemberHealthSummary | null;
  error: boolean;
}

interface HouseholdHealthOverviewProps {
  snapshots: HouseholdSnapshot[];
  loading: boolean;
  patientListLoading: boolean;
  currentPatientId?: number | null;
  onSelectPatient: (_patient: HouseholdSnapshot['patient']) => void;
}

const HouseholdHealthOverview = ({
  snapshots,
  loading,
  patientListLoading,
  currentPatientId,
  onSelectPatient,
}: HouseholdHealthOverviewProps) => {
  const { t } = useTranslation('healthInsights');

  return (
    <Card withBorder radius="md" padding="lg">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Group gap="xs">
              <IconUsers size={22} />
              <Title order={3}>
                {t('household.title', 'Household overview')}
              </Title>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {t(
                'household.description',
                'Compare record coverage and data quality across family members.'
              )}
            </Text>
          </Box>
          <Badge variant="light" color="blue">
            {t('household.memberCount', '{{count}} members', {
              count: snapshots.length,
            })}
          </Badge>
        </Group>

        {patientListLoading && snapshots.length === 0 ? (
          <Center mih={120}>
            <Loader
              aria-label={t('household.loading', 'Loading household overview')}
            />
          </Center>
        ) : snapshots.length === 0 ? (
          <Text c="dimmed">
            {t('household.empty', 'No accessible family members were found.')}
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {snapshots.map(snapshot => {
              const selected = snapshot.patient.id === currentPatientId;
              return (
                <UnstyledButton
                  key={snapshot.patient.id}
                  onClick={() => onSelectPatient(snapshot.patient)}
                  aria-pressed={selected}
                  style={theme => ({
                    border: `1px solid ${
                      selected ? theme.colors.blue[5] : theme.colors.gray[3]
                    }`,
                    background: selected
                      ? 'var(--mantine-color-blue-light)'
                      : 'var(--mantine-color-body)',
                    borderRadius: theme.radius.md,
                    padding: theme.spacing.md,
                    minHeight: 148,
                  })}
                >
                  <Stack gap="sm">
                    <Group justify="space-between" wrap="nowrap">
                      <Text fw={700} lineClamp={1}>
                        {snapshot.summary?.displayName ||
                          [
                            snapshot.patient.first_name,
                            snapshot.patient.last_name,
                          ]
                            .filter(Boolean)
                            .join(' ') ||
                          `#${snapshot.patient.id}`}
                      </Text>
                      {selected && (
                        <Badge size="sm">
                          {t('household.current', 'Current')}
                        </Badge>
                      )}
                    </Group>

                    {snapshot.error ? (
                      <Alert
                        color="red"
                        variant="light"
                        icon={<IconAlertTriangle size={16} />}
                        p="xs"
                      >
                        <Text size="xs">
                          {t(
                            'household.memberError',
                            'This member’s summary could not be loaded.'
                          )}
                        </Text>
                      </Alert>
                    ) : snapshot.summary ? (
                      <SimpleGrid cols={2} spacing="xs" verticalSpacing={6}>
                        <Group gap={5} wrap="nowrap">
                          <IconDatabase size={15} />
                          <Text size="xs">
                            {t('household.records', '{{count}} records', {
                              count: snapshot.summary.totalReadings,
                            })}
                          </Text>
                        </Group>
                        <Group gap={5} wrap="nowrap">
                          <IconChartLine size={15} />
                          <Text size="xs">
                            {t('household.metrics', '{{count}} metrics', {
                              count: snapshot.summary.totalMetrics,
                            })}
                          </Text>
                        </Group>
                        <Group gap={5} wrap="nowrap">
                          <IconActivity size={15} />
                          <Text size="xs">
                            {t(
                              'household.vitalRecords',
                              '{{count}} vital records',
                              { count: snapshot.summary.totalVitalReadings }
                            )}
                          </Text>
                        </Group>
                        <Group gap={5} wrap="nowrap">
                          <IconAlertTriangle size={15} />
                          <Text size="xs">
                            {t(
                              'household.qualityIssues',
                              '{{count}} quality issues',
                              {
                                count: snapshot.summary.qualityIssueCount,
                              }
                            )}
                          </Text>
                        </Group>
                        <Group gap={5} wrap="nowrap">
                          <IconChecklist size={15} />
                          <Text size="xs">
                            {t(
                              'coverageEvidence.householdAbsences',
                              '{{count}} explicit absence statements',
                              {
                                count: snapshot.summary.explicitAbsenceCount,
                              }
                            )}
                          </Text>
                        </Group>
                        <Group gap={5} wrap="nowrap">
                          <IconAlertTriangle size={15} />
                          <Text size="xs">
                            {t(
                              'coverageEvidence.householdReview',
                              '{{review}} to review · {{conflicts}} conflicts',
                              {
                                review:
                                  snapshot.summary.coverageNeedsReviewCount,
                                conflicts:
                                  snapshot.summary.coverageConflictCount,
                              }
                            )}
                          </Text>
                        </Group>
                        <Group gap={5} wrap="nowrap">
                          <IconCalendar size={15} />
                          <Text size="xs">
                            {snapshot.summary.latestDate || '—'}
                          </Text>
                        </Group>
                      </SimpleGrid>
                    ) : (
                      <Center mih={70}>
                        <Loader size="sm" />
                      </Center>
                    )}
                  </Stack>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
        )}

        {loading && snapshots.some(snapshot => snapshot.summary) && (
          <Text size="xs" c="dimmed">
            {t('household.refreshing', 'Refreshing household summaries…')}
          </Text>
        )}
      </Stack>
    </Card>
  );
};

export default HouseholdHealthOverview;
