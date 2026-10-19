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
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconChecklist } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  DataQualityIssue,
  DataQualityRuleId,
} from '../../utils/householdHealthDashboard';

interface HealthDataQualityPanelProps {
  issues: DataQualityIssue[];
  loading: boolean;
  error: boolean;
  onOpenSource: (_labResultId: number) => void;
}

const ruleOrder: DataQualityRuleId[] = [
  'missing_date',
  'missing_unit',
  'missing_result',
  'missing_reference',
  'missing_category',
  'uncanonicalized_name',
  'possible_duplicate',
];

const HealthDataQualityPanel = ({
  issues,
  loading,
  error,
  onOpenSource,
}: HealthDataQualityPanelProps) => {
  const { t } = useTranslation('healthInsights');
  const [ruleFilter, setRuleFilter] = useState('all');
  const filteredIssues = useMemo(
    () =>
      ruleFilter === 'all'
        ? issues
        : issues.filter(issue => issue.ruleId === ruleFilter),
    [issues, ruleFilter]
  );
  const ruleCounts = useMemo(
    () =>
      ruleOrder.reduce<Record<string, number>>((result, ruleId) => {
        result[ruleId] = issues.filter(issue => issue.ruleId === ruleId).length;
        return result;
      }, {}),
    [issues]
  );

  if (loading) {
    return (
      <Paper withBorder radius="md" p="xl">
        <Center mih={280}>
          <Loader aria-label={t('quality.loading', 'Loading data quality')} />
        </Center>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={18} />}>
        {t('quality.error', 'Unable to evaluate data quality.')}
      </Alert>
    );
  }

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs">
              <IconChecklist size={22} />
              <Title order={3}>{t('quality.title', 'Data quality')}</Title>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              {t(
                'quality.description',
                'These checks identify records to review. They never edit or delete health data automatically.'
              )}
            </Text>
          </div>
          <Badge color={issues.length ? 'orange' : 'teal'} variant="light">
            {t('quality.issueCount', '{{count}} issues', {
              count: issues.length,
            })}
          </Badge>
        </Group>

        <Select
          label={t('quality.filter', 'Issue type')}
          value={ruleFilter}
          onChange={value => setRuleFilter(value || 'all')}
          allowDeselect={false}
          maw={360}
          data={[
            { value: 'all', label: t('filters.all', 'All') },
            ...ruleOrder.map(ruleId => ({
              value: ruleId,
              label: `${t(`quality.rules.${ruleId}`, ruleId)} (${ruleCounts[ruleId]})`,
            })),
          ]}
        />

        {filteredIssues.length === 0 ? (
          <Center mih={240}>
            <Stack align="center" gap="xs">
              <IconChecklist size={38} color="var(--mantine-color-teal-6)" />
              <Text c="dimmed">
                {issues.length === 0
                  ? t(
                      'quality.empty',
                      'No issues were found by the current deterministic checks.'
                    )
                  : t('quality.noMatches', 'No issues match this filter.')}
              </Text>
            </Stack>
          </Center>
        ) : (
          <ScrollArea type="auto" offsetScrollbars>
            <Table striped highlightOnHover withTableBorder miw={720}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('quality.issue', 'Issue')}</Table.Th>
                  <Table.Th>{t('coverage.metric', 'Metric')}</Table.Th>
                  <Table.Th>{t('columns.date', 'Date')}</Table.Th>
                  <Table.Th>{t('columns.source', 'Source record')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredIssues.map((qualityIssue, index) => (
                  <Table.Tr
                    key={`${qualityIssue.ruleId}-${qualityIssue.componentId}-${index}`}
                  >
                    <Table.Td>
                      <Badge
                        color={
                          qualityIssue.severity === 'warning'
                            ? 'orange'
                            : 'blue'
                        }
                        variant="light"
                      >
                        {t(
                          `quality.rules.${qualityIssue.ruleId}`,
                          qualityIssue.ruleId
                        )}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{qualityIssue.metricName}</Table.Td>
                    <Table.Td>{qualityIssue.date || '—'}</Table.Td>
                    <Table.Td>
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        onClick={() => onOpenSource(qualityIssue.labResultId)}
                      >
                        #{qualityIssue.labResultId}
                      </Button>
                    </Table.Td>
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

export default HealthDataQualityPanel;
