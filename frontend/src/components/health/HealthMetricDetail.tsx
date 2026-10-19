import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconChartDots,
  IconDatabase,
  IconExternalLink,
  IconFileDescription,
  IconInfoCircle,
} from '@tabler/icons-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  TrendDataPoint,
  TrendResponse,
} from '../../services/api/labTestComponentApi';
import {
  getDistinctUnits,
  hasReferenceRangeChanges,
  isAttentionStatus,
  selectVisualizationMode,
} from '../../utils/healthVisualization';
import HealthMetricExportActions from './HealthMetricExportActions';
import HealthBaselineComparisonCard from './HealthBaselineComparisonCard';
import { buildHealthBaselineComparison } from '../../utils/healthBaselineComparison';

interface HealthMetricDetailProps {
  data?: TrendResponse | null;
  loading: boolean;
  error?: string | null;
  patientLabel: string;
  baselineId?: number | null;
  dateRangeLabel?: string;
  onBaselineChange?: (_id: number) => void;
  onOpenLabRecord?: (_id: number) => void;
  onOpenSourceDocument?: (_id: number) => void;
}

const pointDate = (point: TrendDataPoint) =>
  point.recorded_date ||
  point.lab_result.completed_date ||
  point.created_at ||
  '';

const formatNumber = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(
        value
      )
    : '—';

const formatReferenceRange = (point: TrendDataPoint) => {
  if (point.ref_range_text?.trim()) return point.ref_range_text.trim();
  if (point.ref_range_min !== null && point.ref_range_min !== undefined) {
    if (point.ref_range_max !== null && point.ref_range_max !== undefined) {
      return `${formatNumber(point.ref_range_min)}–${formatNumber(point.ref_range_max)}`;
    }
    return `≥ ${formatNumber(point.ref_range_min)}`;
  }
  if (point.ref_range_max !== null && point.ref_range_max !== undefined) {
    return `≤ ${formatNumber(point.ref_range_max)}`;
  }
  return '—';
};

const statusColor = (status?: string | null) => {
  if (status === 'critical') return 'red';
  if (isAttentionStatus(status)) return 'orange';
  if (status === 'normal') return 'teal';
  return 'gray';
};

const HealthMetricDetail = ({
  data,
  loading,
  error,
  patientLabel,
  baselineId,
  dateRangeLabel,
  onBaselineChange,
  onOpenLabRecord,
  onOpenSourceDocument,
}: HealthMetricDetailProps) => {
  const { t } = useTranslation(['healthInsights', 'labresults']);

  const sortedPoints = useMemo(
    () =>
      [...(data?.data_points || [])].sort((a, b) =>
        pointDate(a).localeCompare(pointDate(b))
      ),
    [data?.data_points]
  );
  const mode = selectVisualizationMode(
    sortedPoints,
    data?.result_type || data?.statistics.result_type
  );
  const unitMismatch = getDistinctUnits(sortedPoints).length > 1;
  const referenceChanged = hasReferenceRangeChanges(sortedPoints);
  const quantitativePoints = sortedPoints.filter(
    point => typeof point.value === 'number' && Number.isFinite(point.value)
  );
  const stableReference =
    !referenceChanged && quantitativePoints.length > 0
      ? {
          min: quantitativePoints[0].ref_range_min,
          max: quantitativePoints[0].ref_range_max,
        }
      : null;
  const chartData = quantitativePoints.map(point => ({
    date: pointDate(point),
    value: point.value,
    status: point.status,
    source: point.lab_result.test_name,
    reference: formatReferenceRange(point),
  }));
  const comparablePoints = useMemo(
    () =>
      sortedPoints.map(point => ({
        id: point.id,
        date: pointDate(point),
        primaryValue: point.value,
        displayValue:
          point.result_type === 'quantitative'
            ? formatNumber(point.value)
            : point.qualitative_value || point.textual_value || null,
        unit: point.unit,
        kind:
          point.result_type === 'quantitative' ||
          (!point.result_type && typeof point.value === 'number')
            ? ('quantitative' as const)
            : ('qualitative' as const),
      })),
    [sortedPoints]
  );
  const requestedComparison = useMemo(
    () => buildHealthBaselineComparison(comparablePoints, baselineId),
    [baselineId, comparablePoints]
  );
  const defaultComparison = useMemo(
    () => buildHealthBaselineComparison(comparablePoints),
    [comparablePoints]
  );
  const baselineComparison =
    requestedComparison.reason === 'invalid_baseline' &&
    defaultComparison.reason === null
      ? defaultComparison
      : requestedComparison;

  if (loading) {
    return (
      <Center mih={260}>
        <Loader aria-label={t('detail.loading', 'Loading metric details')} />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
        {t('detail.loadError', 'Unable to load metric details.')}
      </Alert>
    );
  }

  if (!data) {
    return (
      <Center mih={260}>
        <Stack align="center" gap="xs">
          <IconChartDots size={36} color="var(--mantine-color-dimmed)" />
          <Text c="dimmed">
            {t(
              'detail.selectMetric',
              'Select a metric to inspect its records.'
            )}
          </Text>
        </Stack>
      </Center>
    );
  }

  const modeLabel = t(`modes.${mode}`, {
    defaultValue:
      mode === 'snapshot'
        ? 'Latest snapshot'
        : mode === 'comparison'
          ? 'Discrete comparison'
          : mode === 'trend'
            ? 'Long-term trend'
            : mode === 'qualitative'
              ? 'Result sequence'
              : 'No data',
  });

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={3}>{data.test_name}</Title>
          <Text size="sm" c="dimmed">
            {data.category
              ? t(`labresults:testComponents.categories.${data.category}`, {
                  defaultValue: data.category,
                })
              : t('labels.uncategorized', 'Uncategorized')}
            {data.unit ? ` · ${data.unit}` : ''}
          </Text>
        </Box>
        <Group gap="xs" justify="flex-end">
          <Badge
            variant="light"
            color="blue"
            leftSection={<IconChartDots size={13} />}
          >
            {modeLabel}
          </Badge>
          <HealthMetricExportActions
            data={data}
            patientLabel={patientLabel}
            dateRangeLabel={dateRangeLabel}
            comparison={baselineComparison}
          />
        </Group>
      </Group>

      {unitMismatch && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {t(
            'detail.unitMismatch',
            'Multiple units were returned. Values are not shown as one comparable series.'
          )}
        </Alert>
      )}
      {referenceChanged && (
        <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
          {t(
            'detail.referenceChanged',
            'Reference ranges changed between records.'
          )}
        </Alert>
      )}
      {sortedPoints.length >= 500 && (
        <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
          {t('visualizationContext.limitReached', { limit: 500 })}
        </Alert>
      )}

      <HealthBaselineComparisonCard
        comparison={baselineComparison}
        onBaselineChange={id => onBaselineChange?.(id)}
        testIdPrefix="health-metric"
      />

      <Card
        withBorder
        radius="md"
        data-testid="health-metric-visualization"
        data-visualization-mode={mode}
      >
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>{modeLabel}</Text>
            <Text size="sm" c="dimmed">
              {t('detail.observationCount', '{{count}} observations', {
                count: sortedPoints.length,
              })}
            </Text>
          </Group>

          {mode === 'empty' && (
            <Center mih={180}>
              <Text c="dimmed">
                {t(
                  'detail.noObservations',
                  'No observations available for this metric.'
                )}
              </Text>
            </Center>
          )}

          {mode === 'snapshot' && quantitativePoints[0] && (
            <Center mih={180}>
              <Stack align="center" gap={4}>
                <Text size="2.5rem" fw={700} c="blue">
                  {formatNumber(quantitativePoints[0].value)}
                </Text>
                <Text fw={500}>
                  {quantitativePoints[0].unit || data.unit || '—'}
                </Text>
                <Badge
                  color={statusColor(quantitativePoints[0].status)}
                  variant="light"
                >
                  {t(`statuses.${quantitativePoints[0].status || 'unknown'}`, {
                    defaultValue: quantitativePoints[0].status || 'Unknown',
                  })}
                </Badge>
              </Stack>
            </Center>
          )}

          {mode === 'comparison' && !unitMismatch && (
            <Box
              h={280}
              role="img"
              aria-label={t(
                'detail.comparisonAria',
                'Discrete comparison of recorded values by date'
              )}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 12, right: 16, left: 0, bottom: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={56} />
                  <Tooltip />
                  {stableReference?.min !== null &&
                    stableReference?.min !== undefined &&
                    stableReference?.max !== null &&
                    stableReference?.max !== undefined && (
                      <ReferenceArea
                        y1={stableReference.min}
                        y2={stableReference.max}
                        fill="#dbeafe"
                        fillOpacity={0.45}
                      />
                    )}
                  <Bar dataKey="value" radius={[5, 5, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`${entry.date}-${index}`}
                        fill={
                          isAttentionStatus(entry.status)
                            ? '#f08c00'
                            : '#228be6'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          )}

          {mode === 'trend' && !unitMismatch && (
            <Box
              h={280}
              role="img"
              aria-label={t(
                'detail.trendAria',
                'Long-term line chart of recorded values by date'
              )}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 12, right: 16, left: 0, bottom: 12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} width={56} />
                  <Tooltip />
                  {stableReference?.min !== null &&
                    stableReference?.min !== undefined &&
                    stableReference?.max !== null &&
                    stableReference?.max !== undefined && (
                      <ReferenceArea
                        y1={stableReference.min}
                        y2={stableReference.max}
                        fill="#dbeafe"
                        fillOpacity={0.45}
                      />
                    )}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#228be6"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#228be6' }}
                    activeDot={{ r: 6 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}

          {mode === 'qualitative' && (
            <Stack gap="xs" py="sm">
              {sortedPoints.map(point => (
                <Group key={point.id} justify="space-between" wrap="nowrap">
                  <Text size="sm">{pointDate(point) || '—'}</Text>
                  <Text fw={600}>
                    {point.qualitative_value || point.textual_value || '—'}
                  </Text>
                  <Badge color={statusColor(point.status)} variant="light">
                    {t(`statuses.${point.status || 'unknown'}`, {
                      defaultValue: point.status || 'Unknown',
                    })}
                  </Badge>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      {sortedPoints.length > 0 && (
        <Card withBorder radius="md">
          <Group mb="sm">
            <IconDatabase size={18} />
            <Text fw={600}>
              {t('detail.sourceTable', 'Recorded values and sources')}
            </Text>
          </Group>
          <ScrollArea>
            <Table striped highlightOnHover miw={720}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('columns.date', 'Date')}</Table.Th>
                  <Table.Th>{t('columns.value', 'Value')}</Table.Th>
                  <Table.Th>{t('columns.status', 'Status')}</Table.Th>
                  <Table.Th>
                    {t('columns.reference', 'Reference range')}
                  </Table.Th>
                  <Table.Th>{t('columns.source', 'Source record')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...sortedPoints].reverse().map(point => (
                  <Table.Tr key={point.id}>
                    <Table.Td>{pointDate(point) || '—'}</Table.Td>
                    <Table.Td fw={600}>
                      {point.result_type === 'quantitative'
                        ? `${formatNumber(point.value)}${point.unit ? ` ${point.unit}` : ''}`
                        : point.qualitative_value || point.textual_value || '—'}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusColor(point.status)} variant="light">
                        {t(`statuses.${point.status || 'unknown'}`, {
                          defaultValue: point.status || 'Unknown',
                        })}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{formatReferenceRange(point)}</Table.Td>
                    <Table.Td>
                      <Stack gap={4} align="flex-start">
                        <Text size="sm">{point.lab_result.test_name}</Text>
                        {point.source_document_id && (
                          <Text size="xs" c="dimmed">
                            {t('visualizationContext.source.location', {
                              document: point.source_document_id,
                              page: point.source_page || '—',
                            })}
                            {point.source_locator
                              ? ` · ${point.source_locator}`
                              : ''}
                          </Text>
                        )}
                        <Group gap="xs" wrap="wrap">
                          {onOpenLabRecord && (
                            <Button
                              size="compact-xs"
                              variant="light"
                              leftSection={<IconExternalLink size={13} />}
                              onClick={() =>
                                onOpenLabRecord(point.lab_result.id)
                              }
                            >
                              {t('visualizationContext.source.openRecord')}
                            </Button>
                          )}
                          {point.source_document_id && onOpenSourceDocument && (
                            <Button
                              size="compact-xs"
                              variant="outline"
                              leftSection={<IconFileDescription size={13} />}
                              onClick={() =>
                                onOpenSourceDocument(point.source_document_id!)
                              }
                            >
                              {t('visualizationContext.source.openSource')}
                            </Button>
                          )}
                        </Group>
                      </Stack>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Card>
      )}
    </Stack>
  );
};

export default HealthMetricDetail;
