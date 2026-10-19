import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowsDiff,
  IconExternalLink,
  IconFileDescription,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type {
  HealthExamComparison as HealthExamComparisonModel,
  HealthExamEpisode,
} from '../../utils/healthExamComparison';

interface HealthExamComparisonProps {
  comparison: HealthExamComparisonModel;
  loading: boolean;
  error: boolean;
  partial: boolean;
  onSelectionChange: (_targetKey: string, _baselineKey: string) => void;
  onOpenSourceDocument: (_sourceDocumentId: number) => void;
  onOpenLabRecord: (_labResultId: number) => void;
}

const HealthExamComparison = ({
  comparison,
  loading,
  error,
  partial,
  onSelectionChange,
  onOpenSourceDocument,
  onOpenLabRecord,
}: HealthExamComparisonProps) => {
  const { t } = useTranslation('healthInsights');
  const formatEpisodeLabel = (episode: HealthExamEpisode) => {
    const identity =
      episode.kind === 'source_document'
        ? t('examComparison.episode.source', 'Source document #{{id}}', {
            id: episode.numericId,
          })
        : t('examComparison.episode.lab', 'Lab record #{{id}}', {
            id: episode.numericId,
          });
    return `${episode.displayDate || '—'} · ${identity}`;
  };

  if (loading) {
    return (
      <Paper withBorder radius="md" p="xl">
        <Center mih={280}>
          <Loader
            aria-label={t('examComparison.loading', 'Loading exam comparison')}
          />
        </Center>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
        {t('examComparison.error', 'Unable to load exam comparison.')}
      </Alert>
    );
  }

  const datedEpisodes = comparison.episodes.filter(
    episode => episode.displayDate
  );
  const baselineOptions = comparison.target?.displayDate
    ? datedEpisodes.filter(
        episode => episode.displayDate! < comparison.target!.displayDate!
      )
    : [];
  const episodeOptions = datedEpisodes.map(episode => ({
    value: episode.key,
    label: formatEpisodeLabel(episode),
  }));

  const handleTargetChange = (targetKey: string | null) => {
    if (!targetKey) return;
    const requestedTarget = datedEpisodes.find(
      episode => episode.key === targetKey
    );
    const nextBaseline = requestedTarget?.displayDate
      ? datedEpisodes.find(
          episode => episode.displayDate! < requestedTarget.displayDate!
        )
      : null;
    if (nextBaseline) onSelectionChange(targetKey, nextBaseline.key);
  };

  const handleBaselineChange = (baselineKey: string | null) => {
    if (comparison.target && baselineKey) {
      onSelectionChange(comparison.target.key, baselineKey);
    }
  };

  const openEpisode = (episode: HealthExamEpisode) => {
    if (episode.sourceDocumentId) {
      onOpenSourceDocument(episode.sourceDocumentId);
      return;
    }
    if (episode.labResultIds[0]) onOpenLabRecord(episode.labResultIds[0]);
  };

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconArrowsDiff size={22} />
              <Title order={3}>
                {t('examComparison.title', 'Exam comparison')}
              </Title>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {t(
                'examComparison.description',
                'Compare two stored exam episodes using source documents first and lab records as a fallback.'
              )}
            </Text>
          </div>
          <Badge variant="light">
            {t('examComparison.episodeCount', '{{count}} episodes', {
              count: datedEpisodes.length,
            })}
          </Badge>
        </Group>

        <Alert color="blue" icon={<IconFileDescription size={18} />}>
          {t(
            'examComparison.missingBoundary',
            'A missing metric means no formal structured record is stored for that episode. It does not prove the test was not performed.'
          )}
        </Alert>

        {partial && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
            {t(
              'examComparison.partial',
              'Only the latest {{limit}} components are loaded, so older episodes may be incomplete.',
              { limit: 2000 }
            )}
          </Alert>
        )}

        {comparison.episodes.length > datedEpisodes.length && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
            {t(
              'examComparison.undatedExcluded',
              '{{count}} episodes without a clinical date are excluded from comparison.',
              { count: comparison.episodes.length - datedEpisodes.length }
            )}
          </Alert>
        )}

        {comparison.selectionError && (
          <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
            {t(`examComparison.selectionErrors.${comparison.selectionError}`, {
              defaultValue:
                'The requested episode selection is invalid; the newest compatible pair is shown.',
            })}
          </Alert>
        )}

        {datedEpisodes.length < 2 ||
        !comparison.target ||
        !comparison.baseline ? (
          <Center mih={220}>
            <Text c="dimmed" ta="center">
              {t(
                'examComparison.empty',
                'At least two dated exam episodes are required for comparison.'
              )}
            </Text>
          </Center>
        ) : (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label={t('examComparison.target', 'Target exam')}
                value={comparison.target.key}
                data={episodeOptions.filter(option => {
                  const episode = datedEpisodes.find(
                    candidate => candidate.key === option.value
                  );
                  return datedEpisodes.some(
                    candidate =>
                      episode?.displayDate &&
                      candidate.displayDate! < episode.displayDate
                  );
                })}
                onChange={handleTargetChange}
                allowDeselect={false}
              />
              <Select
                label={t('examComparison.baseline', 'Earlier baseline exam')}
                value={comparison.baseline.key}
                data={baselineOptions.map(episode => ({
                  value: episode.key,
                  label: formatEpisodeLabel(episode),
                }))}
                onChange={handleBaselineChange}
                allowDeselect={false}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              {[comparison.baseline, comparison.target].map(
                (episode, index) => (
                  <Paper withBorder p="sm" radius="sm" key={episode.key}>
                    <Stack gap={5}>
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        {index === 0
                          ? t(
                              'examComparison.baseline',
                              'Earlier baseline exam'
                            )
                          : t('examComparison.target', 'Target exam')}
                      </Text>
                      <Text fw={650}>{formatEpisodeLabel(episode)}</Text>
                      <Text size="xs" c="dimmed">
                        {t(
                          'examComparison.episode.records',
                          '{{components}} components · {{records}} lab records',
                          {
                            components: episode.componentIds.length,
                            records: episode.labResultIds.length,
                          }
                        )}
                      </Text>
                      {episode.hasDateConflict && (
                        <Text size="xs" c="orange">
                          {t(
                            'examComparison.episode.dateConflict',
                            'This episode contains multiple clinical dates: {{dates}}',
                            { dates: episode.recordDates.join(', ') }
                          )}
                        </Text>
                      )}
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        leftSection={<IconExternalLink size={14} />}
                        onClick={() => openEpisode(episode)}
                        aria-label={
                          episode.sourceDocumentId
                            ? t(
                                'examComparison.openSourceAria',
                                'Open source document {{id}}',
                                { id: episode.sourceDocumentId }
                              )
                            : t(
                                'examComparison.openEpisodeRecordAria',
                                'Open episode lab record {{id}}',
                                { id: episode.labResultIds[0] }
                              )
                        }
                      >
                        {episode.sourceDocumentId
                          ? t(
                              'examComparison.openSource',
                              'Open source document'
                            )
                          : t('examComparison.openRecord', 'Open lab record')}
                      </Button>
                    </Stack>
                  </Paper>
                )
              )}
            </SimpleGrid>

            <ScrollArea type="auto" offsetScrollbars>
              <Table
                striped
                highlightOnHover
                withTableBorder
                withColumnBorders
                miw={820}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('coverage.metric', 'Metric')}</Table.Th>
                    <Table.Th>
                      {t('examComparison.baseline', 'Earlier baseline exam')}
                    </Table.Th>
                    <Table.Th>
                      {t('examComparison.target', 'Target exam')}
                    </Table.Th>
                    <Table.Th>
                      {t('examComparison.change', 'Comparison')}
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {comparison.rows.map(row => (
                    <Table.Tr key={row.metricKey}>
                      <Table.Th style={{ minWidth: 180 }}>
                        {row.metricName}
                      </Table.Th>
                      {[row.baseline, row.target].map((value, index) => (
                        <Table.Td key={index}>
                          <Stack gap={3}>
                            <Text>
                              {value.displayValue ||
                                t(
                                  'examComparison.noStructuredRecord',
                                  'No structured record'
                                )}
                              {value.displayValue && value.unit
                                ? ` ${value.unit}`
                                : ''}
                            </Text>
                            {value.components.length > 0 && (
                              <Group gap={4}>
                                {Array.from(
                                  new Set(
                                    value.components.map(
                                      component => component.lab_result_id
                                    )
                                  )
                                ).map(labResultId => (
                                  <Button
                                    key={labResultId}
                                    variant="subtle"
                                    size="compact-xs"
                                    onClick={() => onOpenLabRecord(labResultId)}
                                    aria-label={t(
                                      'examComparison.openRecordAria',
                                      'Open lab record {{id}}',
                                      { id: labResultId }
                                    )}
                                  >
                                    #{labResultId}
                                  </Button>
                                ))}
                              </Group>
                            )}
                          </Stack>
                        </Table.Td>
                      ))}
                      <Table.Td>
                        {row.state === 'comparable_numeric' ? (
                          <Stack gap={2}>
                            <Text fw={700}>
                              {row.absoluteDelta !== null &&
                              row.absoluteDelta > 0
                                ? '+'
                                : ''}
                              {row.absoluteDelta}
                              {row.target.unit ? ` ${row.target.unit}` : ''}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {t(
                                'examComparison.noInterpretation',
                                'Absolute difference only; no clinical direction is inferred.'
                              )}
                            </Text>
                          </Stack>
                        ) : row.state === 'comparable_text' ? (
                          <Text>
                            {row.baseline.displayValue} →{' '}
                            {row.target.displayValue}
                          </Text>
                        ) : (
                          <Badge color="gray" variant="light">
                            {t(`examComparison.states.${row.state}`, {
                              defaultValue: row.state,
                            })}
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </>
        )}
      </Stack>
    </Paper>
  );
};

export default HealthExamComparison;
