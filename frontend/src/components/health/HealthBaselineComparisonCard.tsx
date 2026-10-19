import {
  Alert,
  Card,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { IconArrowsDiff, IconInfoCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type { HealthBaselineComparison } from '../../utils/healthBaselineComparison';

interface HealthBaselineComparisonCardProps {
  comparison: HealthBaselineComparison;
  onBaselineChange: (_id: number) => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  testIdPrefix: string;
}

const formatNumber = (value: number | null) =>
  value === null
    ? '—'
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 4,
        signDisplay: 'always',
      }).format(value);

const pointValue = (point: NonNullable<HealthBaselineComparison['target']>) => {
  if (point.kind === 'qualitative') return point.displayValue || '—';
  if (point.displayValue) return point.displayValue;
  if (typeof point.primaryValue !== 'number') return '—';
  const primary = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 4,
  }).format(point.primaryValue);
  return point.secondaryValue === null || point.secondaryValue === undefined
    ? primary
    : `${primary}/${new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 4,
      }).format(point.secondaryValue)}`;
};

const HealthBaselineComparisonCard = ({
  comparison,
  onBaselineChange,
  primaryLabel,
  secondaryLabel,
  testIdPrefix,
}: HealthBaselineComparisonCardProps) => {
  const { t } = useTranslation('healthInsights');
  const baselineOptions = [...comparison.candidates].reverse().map(point => ({
    value: String(point.id),
    label: `${point.date} · ${pointValue(point)}${point.unit ? ` ${point.unit}` : ''} · #${point.id}`,
  }));

  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      data-testid={`${testIdPrefix}-baseline-comparison`}
    >
      <Stack gap="md">
        <Group gap="xs">
          <IconArrowsDiff size={18} />
          <div>
            <Text fw={650}>{t('visualizationContext.baseline.title')}</Text>
            <Text size="sm" c="dimmed">
              {t('visualizationContext.baseline.description')}
            </Text>
          </div>
        </Group>

        <Select
          label={t('visualizationContext.baseline.select')}
          placeholder={t('visualizationContext.baseline.selectPlaceholder')}
          data={baselineOptions}
          value={comparison.baseline ? String(comparison.baseline.id) : null}
          disabled={baselineOptions.length === 0}
          allowDeselect={false}
          onChange={value => {
            const id = Number(value);
            if (Number.isInteger(id) && id > 0) onBaselineChange(id);
          }}
          comboboxProps={{ withinPortal: true, zIndex: 3000 }}
          data-testid={`${testIdPrefix}-baseline-select`}
        />

        {comparison.reason ? (
          <Alert color="yellow" icon={<IconInfoCircle size={18} />}>
            {t(`visualizationContext.baseline.reasons.${comparison.reason}`)}
          </Alert>
        ) : (
          comparison.baseline &&
          comparison.target && (
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">
                  {t('visualizationContext.baseline.baseline')}
                </Text>
                <Text fw={700}>{pointValue(comparison.baseline)}</Text>
                <Text size="xs" c="dimmed">
                  {t('visualizationContext.baseline.recordMeta', {
                    date: comparison.baseline.date,
                    id: comparison.baseline.id,
                  })}
                </Text>
              </Card>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">
                  {t('visualizationContext.baseline.target')}
                </Text>
                <Text fw={700}>{pointValue(comparison.target)}</Text>
                <Text size="xs" c="dimmed">
                  {t('visualizationContext.baseline.recordMeta', {
                    date: comparison.target.date,
                    id: comparison.target.id,
                  })}
                </Text>
              </Card>
              <Card withBorder padding="sm">
                <Text size="xs" c="dimmed">
                  {t('visualizationContext.baseline.absoluteChange')}
                </Text>
                {comparison.kind === 'qualitative' ? (
                  <Text fw={700}>
                    {pointValue(comparison.baseline)} →{' '}
                    {pointValue(comparison.target)}
                  </Text>
                ) : (
                  <Stack gap={2}>
                    <Text
                      fw={700}
                      data-testid={`${testIdPrefix}-primary-delta`}
                    >
                      {primaryLabel
                        ? `${primaryLabel}: ${formatNumber(comparison.primaryDelta)}`
                        : formatNumber(comparison.primaryDelta)}
                      {comparison.target.unit
                        ? ` ${comparison.target.unit}`
                        : ''}
                    </Text>
                    {comparison.secondaryDelta !== null && (
                      <Text
                        fw={700}
                        data-testid={`${testIdPrefix}-secondary-delta`}
                      >
                        {secondaryLabel
                          ? `${secondaryLabel}: ${formatNumber(comparison.secondaryDelta)}`
                          : formatNumber(comparison.secondaryDelta)}
                        {comparison.target.unit
                          ? ` ${comparison.target.unit}`
                          : ''}
                      </Text>
                    )}
                  </Stack>
                )}
                <Text size="xs" c="dimmed" mt={3}>
                  {t('visualizationContext.baseline.noInterpretation')}
                </Text>
              </Card>
            </SimpleGrid>
          )
        )}
      </Stack>
    </Paper>
  );
};

export default HealthBaselineComparisonCard;
