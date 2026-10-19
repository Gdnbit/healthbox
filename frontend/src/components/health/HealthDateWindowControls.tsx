import {
  Badge,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconCalendar, IconFilter } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import type {
  HealthDatePreset,
  HealthDateWindow,
  HealthDateWindowError,
} from '../../utils/healthDateWindow';

interface HealthDateWindowControlsProps {
  preset: HealthDatePreset;
  draft: HealthDateWindow;
  appliedLabel: string;
  error: HealthDateWindowError | null;
  loading?: boolean;
  testIdPrefix: string;
  onPresetChange: (_preset: HealthDatePreset) => void;
  onDateFromChange: (_value: string) => void;
  onDateToChange: (_value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

const HealthDateWindowControls = ({
  preset,
  draft,
  appliedLabel,
  error,
  loading = false,
  testIdPrefix,
  onPresetChange,
  onDateFromChange,
  onDateToChange,
  onApply,
  onClear,
}: HealthDateWindowControlsProps) => {
  const { t } = useTranslation('healthInsights');
  const presetOptions: Array<{ value: HealthDatePreset; label: string }> = [
    { value: 'all', label: t('visualizationContext.date.presets.all') },
    {
      value: '3months',
      label: t('visualizationContext.date.presets.3months'),
    },
    {
      value: '6months',
      label: t('visualizationContext.date.presets.6months'),
    },
    { value: 'year', label: t('visualizationContext.date.presets.year') },
    { value: '2years', label: t('visualizationContext.date.presets.2years') },
    { value: '5years', label: t('visualizationContext.date.presets.5years') },
    { value: 'custom', label: t('visualizationContext.date.presets.custom') },
  ];

  return (
    <Paper
      withBorder
      radius="md"
      p="md"
      data-testid={`${testIdPrefix}-date-window`}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconFilter size={17} />
              <Text fw={650}>{t('visualizationContext.date.title')}</Text>
            </Group>
            <Text size="sm" c="dimmed" mt={3}>
              {t('visualizationContext.date.description')}
            </Text>
          </div>
          <Badge
            variant="light"
            color="blue"
            data-testid={`${testIdPrefix}-applied-range`}
          >
            {appliedLabel}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Select
            label={t('visualizationContext.date.presetLabel')}
            value={preset}
            data={presetOptions}
            allowDeselect={false}
            leftSection={<IconCalendar size={16} />}
            onChange={value =>
              onPresetChange((value || 'all') as HealthDatePreset)
            }
            comboboxProps={{ withinPortal: true, zIndex: 3000 }}
          />
          <TextInput
            type="date"
            label={t('visualizationContext.date.from')}
            value={draft.dateFrom}
            onChange={event => onDateFromChange(event.currentTarget.value)}
            data-testid={`${testIdPrefix}-date-from`}
          />
          <TextInput
            type="date"
            label={t('visualizationContext.date.to')}
            value={draft.dateTo}
            onChange={event => onDateToChange(event.currentTarget.value)}
            data-testid={`${testIdPrefix}-date-to`}
          />
        </SimpleGrid>

        {error && (
          <Text size="sm" c="red" role="alert">
            {t(`visualizationContext.date.errors.${error}`)}
          </Text>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClear} disabled={loading}>
            {t('visualizationContext.date.clear')}
          </Button>
          <Button onClick={onApply} loading={loading}>
            {t('visualizationContext.date.apply')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
};

export default HealthDateWindowControls;
