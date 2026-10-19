import {
  Alert,
  ActionIcon,
  Badge,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarStats,
  IconExternalLink,
} from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CoverageMatrix } from '../../utils/householdHealthDashboard';
import type {
  CoverageEvidenceMatrix,
  CoverageEvidenceState,
} from '../../utils/healthCoverageEvidence';

interface HealthCoverageMatrixProps {
  matrix?: CoverageMatrix;
  annualMatrix?: CoverageMatrix;
  evidenceMatrix?: CoverageEvidenceMatrix;
  annualEvidenceMatrix?: CoverageEvidenceMatrix;
  loading: boolean;
  error: boolean;
  onOpenLabRecord?: (_labResultId: number) => void;
  onOpenSourceDocument?: (_sourceDocumentId: number) => void;
}

const evidenceColor = (state: CoverageEvidenceState) => {
  if (state === 'conflict') return 'red';
  if (state === 'recorded') return 'teal';
  if (state === 'needs-review' || state === 'questionable') return 'orange';
  if (state === 'not-performed') return 'grape';
  if (state === 'not-applicable') return 'gray';
  return 'blue';
};

const HealthCoverageMatrix = ({
  matrix,
  annualMatrix,
  evidenceMatrix,
  annualEvidenceMatrix,
  loading,
  error,
  onOpenLabRecord,
  onOpenSourceDocument,
}: HealthCoverageMatrixProps) => {
  const { t } = useTranslation('healthInsights');
  const [periodMode, setPeriodMode] = useState<'date' | 'year'>('date');
  const activeMatrix = periodMode === 'year' ? annualMatrix : matrix;
  const activeEvidence =
    periodMode === 'year' ? annualEvidenceMatrix : evidenceMatrix;
  const periods = activeEvidence?.periods || activeMatrix?.dates || [];
  const rowCount =
    activeEvidence?.rows.length || activeMatrix?.rows.length || 0;

  if (loading) {
    return (
      <Paper withBorder radius="md" p="xl">
        <Center mih={280}>
          <Loader
            aria-label={t('coverage.loading', 'Loading checkup coverage')}
          />
        </Center>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
        {t('coverage.error', 'Unable to load checkup coverage.')}
      </Alert>
    );
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconCalendarStats size={22} />
              <Title order={3}>{t('coverage.title', 'Checkup coverage')}</Title>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {t(
                'coverage.description',
                'A blank cell means no formal record is stored for that date. It does not prove the test was not performed.'
              )}
            </Text>
          </div>
          <Stack gap="xs" align="flex-end">
            <SegmentedControl
              size="xs"
              value={periodMode}
              onChange={value => setPeriodMode(value as 'date' | 'year')}
              aria-label={t('coverage.periodMode', 'Coverage period grouping')}
              data={[
                { value: 'date', label: t('coverage.byDate', 'By date') },
                { value: 'year', label: t('coverage.byYear', 'By year') },
              ]}
            />
            <Badge variant="light">
              {periodMode === 'year'
                ? t('coverage.yearCount', '{{count}} years', {
                    count: periods.length,
                  })
                : t('coverage.dateCount', '{{count}} dates', {
                    count: periods.length,
                  })}
            </Badge>
          </Stack>
        </Group>

        {(activeMatrix?.excludedWithoutDate || 0) > 0 && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
            {t(
              'coverage.excludedWithoutDate',
              '{{count}} records without a clinical date are excluded from this matrix.',
              { count: activeMatrix?.excludedWithoutDate || 0 }
            )}
          </Alert>
        )}

        {rowCount === 0 || periods.length === 0 ? (
          <Center mih={260}>
            <Text c="dimmed">
              {t(
                'coverage.empty',
                'No dated structured measurements are available for a coverage matrix.'
              )}
            </Text>
          </Center>
        ) : (
          <ScrollArea type="auto" offsetScrollbars>
            <Table
              striped
              highlightOnHover
              withTableBorder
              withColumnBorders
              miw={760}
            >
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('coverage.metric', 'Metric')}</Table.Th>
                  {periods.map(date => (
                    <Table.Th key={date} style={{ whiteSpace: 'nowrap' }}>
                      {date}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {activeEvidence?.rows.map(row => (
                  <Table.Tr key={row.metricKey}>
                    <Table.Th style={{ minWidth: 180 }}>
                      {row.metricName}
                    </Table.Th>
                    {periods.map(period => {
                      const cell = row.cells[period];
                      if (!cell) {
                        return (
                          <Table.Td
                            key={period}
                            ta="center"
                            c="dimmed"
                            aria-label={t(
                              'coverage.noStoredRecord',
                              'No formal evidence is stored for this period'
                            )}
                          >
                            —
                          </Table.Td>
                        );
                      }
                      return (
                        <Table.Td key={period} ta="center">
                          <Stack gap={5} align="center">
                            <Group gap={4} justify="center">
                              {cell.states.map(state => (
                                <Badge
                                  key={state}
                                  color={evidenceColor(state)}
                                  variant="light"
                                  size="xs"
                                >
                                  {t(`coverageEvidence.states.${state}`)}
                                </Badge>
                              ))}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {t('coverageEvidence.cellCounts', {
                                observations: cell.observationCount,
                                statements: cell.statementCount,
                              })}
                            </Text>
                            {(cell.labResultIds.length > 0 ||
                              cell.sourceDocumentIds.length > 0) && (
                              <Group gap={2} justify="center">
                                {cell.labResultIds.map(id => (
                                  <Tooltip
                                    key={`lab-${id}`}
                                    label={t('coverageEvidence.openLabRecord', {
                                      id,
                                    })}
                                  >
                                    <ActionIcon
                                      variant="subtle"
                                      size="sm"
                                      aria-label={`${t(
                                        'coverageEvidence.openLabRecord'
                                      )} ${id}`}
                                      onClick={() => onOpenLabRecord?.(id)}
                                    >
                                      <IconExternalLink size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                ))}
                                {cell.sourceDocumentIds.map(id => (
                                  <Tooltip
                                    key={`source-${id}`}
                                    label={t('coverageEvidence.openSource', {
                                      id,
                                    })}
                                  >
                                    <ActionIcon
                                      variant="subtle"
                                      size="sm"
                                      aria-label={`${t(
                                        'coverageEvidence.openSource'
                                      )} ${id}`}
                                      onClick={() => onOpenSourceDocument?.(id)}
                                    >
                                      <IconExternalLink size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                ))}
                              </Group>
                            )}
                          </Stack>
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
                {activeMatrix?.rows.map(row => (
                  <Table.Tr key={row.key}>
                    <Table.Th style={{ minWidth: 180 }}>
                      {row.metricName}
                    </Table.Th>
                    {periods.map(date => {
                      const cell = row.cells[date];
                      if (!cell) {
                        return (
                          <Table.Td
                            key={date}
                            ta="center"
                            c="dimmed"
                            aria-label={t(
                              'coverage.noStoredRecord',
                              'No formal structured record is stored for this period'
                            )}
                          >
                            —
                          </Table.Td>
                        );
                      }

                      const needsAttention = cell.statuses.some(
                        status => status !== 'normal'
                      );
                      return (
                        <Table.Td key={date} ta="center">
                          <Stack gap={3} align="center">
                            <Badge
                              color={needsAttention ? 'orange' : 'teal'}
                              variant="light"
                              size="sm"
                            >
                              {cell.count}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              {cell.units.join(', ') ||
                                t('coverage.noUnit', 'No unit')}
                            </Text>
                          </Stack>
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Paper>
  );
};

export default HealthCoverageMatrix;
