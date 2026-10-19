import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Container,
  Grid,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  UnstyledButton,
} from '@mantine/core';
import {
  IconActivity,
  IconAlertTriangle,
  IconArrowsDiff,
  IconBell,
  IconBook2,
  IconCalendar,
  IconCalendarStats,
  IconChecklist,
  IconChartDots,
  IconChartLine,
  IconDatabase,
  IconFileDescription,
  IconFlask,
  IconRefresh,
  IconSearch,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components';
import HealthCoverageEvidencePanel from '../components/health/HealthCoverageEvidencePanel';
import HealthExamComparison from '../components/health/HealthExamComparison';
import HealthAlertsPanel from '../components/health/HealthAlertsPanel';
import HealthBackgroundPanel from '../components/health/HealthBackgroundPanel';
import HealthDataQualityPanel from '../components/health/HealthDataQualityPanel';
import HealthMetricDetail from '../components/health/HealthMetricDetail';
import HealthSourcesPanel from '../components/health/HealthSourcesPanel';
import HealthDateWindowControls from '../components/health/HealthDateWindowControls';
import VitalInsightsPanel from '../components/health/VitalInsightsPanel';
import HouseholdHealthOverview, {
  type HouseholdSnapshot,
} from '../components/health/HouseholdHealthOverview';
import { PatientSelector } from '../components/medical';
import {
  useCacheManager,
  useCurrentPatient,
  usePatientList,
} from '../hooks/useGlobalData';
import {
  labTestComponentApi,
  type ComponentCatalogEntry,
  type LabTestComponentForStack,
  type TrendResponse,
} from '../services/api/labTestComponentApi';
import logger from '../services/logger';
import { vitalsService } from '../services/medical/vitalsService';
import {
  buildFamilyMemberSummary,
  evaluateDataQuality,
} from '../utils/householdHealthDashboard';
import { buildCoverageEvidence } from '../utils/healthCoverageEvidence';
import healthCoverageApi from '../services/api/healthCoverageApi';
import {
  buildCatalogSummary,
  filterCatalogItems,
  isAttentionStatus,
  LONG_TERM_TREND_POINT_THRESHOLD,
} from '../utils/healthVisualization';
import { buildHealthExamComparison } from '../utils/healthExamComparison';
import {
  formatHealthDateWindowLabel,
  resolveHealthDatePreset,
  validateHealthDateWindow,
  type HealthDatePreset,
  type HealthDateWindow,
  type HealthDateWindowError,
} from '../utils/healthDateWindow';

const entryKey = (entry: ComponentCatalogEntry) =>
  `${entry.trend_test_name}::${(entry.unit || '').trim().toLowerCase()}`;

const HEALTH_INSIGHT_VIEWS = new Set([
  'metrics',
  'vitals',
  'exams',
  'coverage',
  'quality',
  'sources',
  'alerts',
  'background',
]);

const statusColor = (status?: string | null) => {
  if (status === 'critical') return 'red';
  if (isAttentionStatus(status)) return 'orange';
  if (status === 'normal') return 'teal';
  return 'gray';
};

const latestDisplayValue = (entry: ComponentCatalogEntry) => {
  if (typeof entry.latest_value === 'number') {
    const value = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 4,
    }).format(entry.latest_value);
    return `${value}${entry.unit ? ` ${entry.unit}` : ''}`;
  }
  return entry.latest_qualitative_value || entry.latest_textual_value || '—';
};

const HealthInsights = () => {
  const { t } = useTranslation(['healthInsights', 'labresults']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { patient: currentPatient, loading: patientLoading } =
    useCurrentPatient() as {
      patient?: {
        id: number;
        first_name?: string;
        last_name?: string;
        height?: number | null;
      } | null;
      loading: boolean;
    };
  const { setCurrentPatient, invalidateAll } = useCacheManager() as {
    setCurrentPatient: (_patient: { id: number } | null) => void;
    invalidateAll: () => void;
  };
  const { patientList, loading: patientListLoading } = usePatientList() as {
    patientList: Array<{
      id: number;
      first_name?: string | null;
      last_name?: string | null;
    }>;
    loading: boolean;
  };

  const [catalog, setCatalog] = useState<ComponentCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<'catalog' | null>(null);
  const [selectedEntry, setSelectedEntry] =
    useState<ComponentCatalogEntry | null>(null);
  const [detail, setDetail] = useState<TrendResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<'detail' | null>(null);
  const [components, setComponents] = useState<LabTestComponentForStack[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [componentsError, setComponentsError] = useState(false);
  const [householdSnapshots, setHouseholdSnapshots] = useState<
    HouseholdSnapshot[]
  >([]);
  const [householdLoading, setHouseholdLoading] = useState(false);
  const requestedView = searchParams.get('view');
  const [activeView, setActiveView] = useState<string | null>(() =>
    requestedView && HEALTH_INSIGHT_VIEWS.has(requestedView)
      ? requestedView
      : 'metrics'
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [metricDatePreset, setMetricDatePreset] = useState<HealthDatePreset>(
    () =>
      searchParams.get('metric_from') || searchParams.get('metric_to')
        ? 'custom'
        : 'all'
  );
  const [metricDateDraft, setMetricDateDraft] = useState<HealthDateWindow>(
    () => {
      const fromUrl = searchParams.get('metric_from') || '';
      const toUrl = searchParams.get('metric_to') || '';
      const candidate = { dateFrom: fromUrl, dateTo: toUrl };
      return validateHealthDateWindow(candidate) === null
        ? candidate
        : { dateFrom: '', dateTo: '' };
    }
  );
  const [metricDateApplied, setMetricDateApplied] =
    useState<HealthDateWindow>(metricDateDraft);
  const [metricDateError, setMetricDateError] =
    useState<HealthDateWindowError | null>(null);
  const baselineParam = Number(searchParams.get('metric_baseline'));
  const metricBaselineId =
    Number.isInteger(baselineParam) && baselineParam > 0 ? baselineParam : null;
  const sourceParam = Number(searchParams.get('source'));
  const focusedSourceDocumentId =
    Number.isInteger(sourceParam) && sourceParam > 0 ? sourceParam : null;
  const requestedExamTarget = searchParams.get('exam_target');
  const requestedExamBaseline = searchParams.get('exam_baseline');
  const currentPatientLabel =
    [currentPatient?.first_name, currentPatient?.last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || t('labels.unknownMember', 'Unknown household member');

  useEffect(() => {
    if (
      requestedView &&
      HEALTH_INSIGHT_VIEWS.has(requestedView) &&
      requestedView !== activeView
    ) {
      setActiveView(requestedView);
    }
  }, [activeView, requestedView]);

  const handleViewChange = (value: string | null) => {
    const nextView =
      value && HEALTH_INSIGHT_VIEWS.has(value) ? value : 'metrics';
    setActiveView(nextView);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', nextView);
    setSearchParams(nextParams, { replace: true });
  };

  const updateMetricWindowParams = useCallback(
    (window: HealthDateWindow, baselineId?: number | null) => {
      const nextParams = new URLSearchParams(searchParams);
      if (window.dateFrom) nextParams.set('metric_from', window.dateFrom);
      else nextParams.delete('metric_from');
      if (window.dateTo) nextParams.set('metric_to', window.dateTo);
      else nextParams.delete('metric_to');
      if (baselineId) nextParams.set('metric_baseline', String(baselineId));
      else nextParams.delete('metric_baseline');
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const handleMetricPresetChange = (preset: HealthDatePreset) => {
    setMetricDatePreset(preset);
    setMetricDateError(null);
    if (preset === 'custom') return;
    setMetricDateDraft(resolveHealthDatePreset(preset));
  };

  const handleMetricDateApply = () => {
    const validation = validateHealthDateWindow(metricDateDraft);
    setMetricDateError(validation);
    if (validation) return;
    setMetricDateApplied(metricDateDraft);
    updateMetricWindowParams(metricDateDraft, null);
  };

  const handleMetricDateClear = () => {
    const emptyWindow = { dateFrom: '', dateTo: '' };
    setMetricDatePreset('all');
    setMetricDateDraft(emptyWindow);
    setMetricDateApplied(emptyWindow);
    setMetricDateError(null);
    updateMetricWindowParams(emptyWindow, null);
  };

  const handleMetricBaselineChange = useCallback(
    (id: number) => updateMetricWindowParams(metricDateApplied, id),
    [metricDateApplied, updateMetricWindowParams]
  );

  useEffect(() => {
    if (!currentPatient?.id) {
      setCatalog([]);
      setSelectedEntry(null);
      setCatalogLoading(false);
      return;
    }

    const controller = new AbortController();
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalog([]);
    setSelectedEntry(null);
    setDetail(null);

    labTestComponentApi
      .getComponentCatalog(currentPatient.id, { limit: 500 }, controller.signal)
      .then(response => {
        const items = response.items || [];
        setCatalog(items);
        setSelectedEntry(
          items.find(item => isAttentionStatus(item.status)) || items[0] || null
        );
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('health_insights_catalog_load_error', {
          component: 'HealthInsights',
          patientId: currentPatient.id,
          error: error instanceof Error ? error.message : String(error),
        });
        setCatalogError('catalog');
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });

    return () => controller.abort();
  }, [currentPatient?.id, reloadToken]);

  useEffect(() => {
    if (!currentPatient?.id) {
      setComponents([]);
      setComponentsLoading(false);
      setComponentsError(false);
      return;
    }

    const controller = new AbortController();
    setComponents([]);
    setComponentsLoading(true);
    setComponentsError(false);

    labTestComponentApi
      .getAllForPatient(currentPatient.id, controller.signal)
      .then(setComponents)
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('health_insights_components_load_error', {
          component: 'HealthInsights',
          patientId: currentPatient.id,
          error: error instanceof Error ? error.message : String(error),
        });
        setComponentsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setComponentsLoading(false);
      });

    return () => controller.abort();
  }, [currentPatient?.id, reloadToken]);

  useEffect(() => {
    if (patientList.length === 0) {
      setHouseholdSnapshots([]);
      setHouseholdLoading(false);
      return;
    }

    const controller = new AbortController();
    setHouseholdLoading(true);
    setHouseholdSnapshots(
      patientList.map(patient => ({ patient, summary: null, error: false }))
    );

    Promise.all(
      patientList.map(async patient => {
        try {
          const [
            memberCatalog,
            memberComponents,
            memberVitalStatsResponse,
            memberCoverageStatements,
          ] = await Promise.all([
            labTestComponentApi.getComponentCatalog(
              patient.id,
              { limit: 500 },
              controller.signal
            ),
            labTestComponentApi.getAllForPatient(patient.id, controller.signal),
            vitalsService.getPatientVitalsStats(patient.id).catch(error => {
              if (!controller.signal.aborted) {
                logger.error('household_vital_stats_load_error', {
                  component: 'HealthInsights',
                  patientId: patient.id,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
              return null;
            }),
            healthCoverageApi.list(patient.id, false, controller.signal),
          ]);
          const memberVitalStats =
            memberVitalStatsResponse &&
            typeof memberVitalStatsResponse === 'object' &&
            'data' in memberVitalStatsResponse
              ? memberVitalStatsResponse.data
              : memberVitalStatsResponse;

          return {
            patient,
            summary: buildFamilyMemberSummary(
              patient,
              memberCatalog.items || [],
              memberComponents,
              memberVitalStats as {
                total_readings?: number | null;
                latest_reading_date?: string | null;
              },
              buildCoverageEvidence(
                memberComponents,
                memberCoverageStatements,
                'date'
              ).summary
            ),
            error: false,
          } satisfies HouseholdSnapshot;
        } catch (error) {
          if (!controller.signal.aborted) {
            logger.error('household_health_summary_load_error', {
              component: 'HealthInsights',
              patientId: patient.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return {
            patient,
            summary: null,
            error: !controller.signal.aborted,
          } satisfies HouseholdSnapshot;
        }
      })
    )
      .then(snapshots => {
        if (!controller.signal.aborted) setHouseholdSnapshots(snapshots);
      })
      .finally(() => {
        if (!controller.signal.aborted) setHouseholdLoading(false);
      });

    return () => controller.abort();
  }, [patientList, reloadToken]);

  useEffect(() => {
    if (!currentPatient?.id || !selectedEntry) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);

    labTestComponentApi
      .getTrendsByPatientAndTest(
        currentPatient.id,
        selectedEntry.trend_test_name,
        {
          limit: 500,
          unit: selectedEntry.unit ?? '',
          dateFrom: metricDateApplied.dateFrom || undefined,
          dateTo: metricDateApplied.dateTo || undefined,
        },
        controller.signal
      )
      .then(setDetail)
      .catch(error => {
        if (controller.signal.aborted) return;
        logger.error('health_insights_detail_load_error', {
          component: 'HealthInsights',
          patientId: currentPatient.id,
          testName: selectedEntry.trend_test_name,
          unit: selectedEntry.unit || '',
          error: error instanceof Error ? error.message : String(error),
        });
        setDetailError('detail');
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });

    return () => controller.abort();
  }, [currentPatient?.id, metricDateApplied, selectedEntry]);

  const summary = useMemo(() => buildCatalogSummary(catalog), [catalog]);
  const categories = useMemo(
    () =>
      Array.from(
        new Set(catalog.map(item => item.category).filter(Boolean) as string[])
      )
        .sort()
        .map(category => ({
          value: category,
          label: t(`labresults:testComponents.categories.${category}`, {
            defaultValue: category,
          }),
        })),
    [catalog, t]
  );
  const filteredCatalog = useMemo(
    () =>
      filterCatalogItems(catalog, {
        search,
        status: statusFilter,
        category: categoryFilter,
      }),
    [catalog, categoryFilter, search, statusFilter]
  );
  const examComparison = useMemo(
    () =>
      buildHealthExamComparison(
        components,
        requestedExamTarget,
        requestedExamBaseline
      ),
    [components, requestedExamBaseline, requestedExamTarget]
  );
  const qualityIssues = useMemo(
    () => evaluateDataQuality(components),
    [components]
  );

  const handlePatientChange = (patient: { id: number } | null) => {
    setCurrentPatient(patient);
    invalidateAll();
  };

  const handleHouseholdPatientChange = (patient: { id: number }) => {
    handlePatientChange(patient);
  };

  const handleExamSelectionChange = (
    targetKey: string,
    baselineKey: string
  ) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', 'exams');
    nextParams.set('exam_target', targetKey);
    nextParams.set('exam_baseline', baselineKey);
    setSearchParams(nextParams, { replace: true });
  };

  const summaryCards = [
    {
      label: t('summary.metrics', 'Metrics'),
      value: summary.totalMetrics,
      icon: IconFlask,
      color: 'blue',
    },
    {
      label: t('summary.observations', 'Observations'),
      value: summary.totalReadings,
      icon: IconDatabase,
      color: 'indigo',
    },
    {
      label: t('summary.attention', 'Latest records to review'),
      value: summary.attentionCount,
      icon: IconAlertTriangle,
      color: 'orange',
    },
    {
      label: t('summary.longTerm', 'Long-term trends available'),
      value: summary.longTermTrendCount,
      icon: IconChartLine,
      color: 'cyan',
    },
    {
      label: t('summary.latestDate', 'Most recent record'),
      value: summary.latestDate || '—',
      icon: IconCalendar,
      color: 'gray',
    },
  ];
  const metricDateRangeLabel = formatHealthDateWindowLabel(metricDateApplied, {
    all: t('visualizationContext.date.applied.all'),
    both: (dateFrom, dateTo) =>
      t('visualizationContext.date.applied.both', { dateFrom, dateTo }),
    from: dateFrom => t('visualizationContext.date.applied.from', { dateFrom }),
    to: dateTo => t('visualizationContext.date.applied.to', { dateTo }),
  });

  return (
    <Container size="xl" py="md">
      <PageHeader
        title={t('title', 'Health insights')}
        icon="📊"
        showBackButton
        onBackClick={undefined}
        actions={undefined}
      />

      <Stack gap="lg" mt="md">
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" align="flex-start">
            <Box>
              <Title order={2}>{t('heading', 'Health data overview')}</Title>
              <Text c="dimmed" size="sm" mt={4} maw={760}>
                {t(
                  'description',
                  'Review stored measurements, compare checkups and trace every value back to its source record.'
                )}
              </Text>
            </Box>
            <PatientSelector
              compact
              currentPatientId={currentPatient?.id}
              loading={patientLoading}
              onPatientChange={handlePatientChange}
            />
          </Group>
        </Paper>

        <Alert color="blue" icon={<IconChartDots size={18} />}>
          {t(
            'safetyNotice',
            'This page organizes records and source-report flags only. It does not provide a diagnosis or treatment advice.'
          )}
        </Alert>

        <HouseholdHealthOverview
          snapshots={householdSnapshots}
          loading={householdLoading}
          patientListLoading={patientListLoading}
          currentPatientId={currentPatient?.id}
          onSelectPatient={handleHouseholdPatientChange}
        />

        {activeView !== 'vitals' && (
          <SimpleGrid cols={{ base: 1, xs: 2, md: 5 }}>
            {summaryCards.map(card => (
              <Card key={card.label} withBorder radius="md" padding="md">
                <Group wrap="nowrap" align="flex-start">
                  <ThemeIcon
                    color={card.color}
                    variant="light"
                    size="lg"
                    radius="md"
                  >
                    <card.icon size={20} />
                  </ThemeIcon>
                  <Box>
                    <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                      {card.label}
                    </Text>
                    <Text size="xl" fw={700} mt={2}>
                      {card.value}
                    </Text>
                  </Box>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        )}

        {!currentPatient && !patientLoading ? (
          <Paper withBorder radius="md" p="xl">
            <Center>
              <Text c="dimmed">
                {t(
                  'empty.noPatient',
                  'Select a family member to view health data.'
                )}
              </Text>
            </Center>
          </Paper>
        ) : (
          <Tabs
            value={activeView}
            onChange={handleViewChange}
            keepMounted={false}
          >
            <Tabs.List mb="md" style={{ flexWrap: 'wrap' }}>
              <Tabs.Tab
                value="metrics"
                leftSection={<IconChartLine size={17} />}
              >
                {t('views.metrics', 'Metrics and trends')}
              </Tabs.Tab>
              <Tabs.Tab value="vitals" leftSection={<IconActivity size={17} />}>
                {t('views.vitals', 'Vital signs')}
              </Tabs.Tab>
              <Tabs.Tab
                value="coverage"
                leftSection={<IconCalendarStats size={17} />}
              >
                {t('views.coverage', 'Checkup coverage')}
              </Tabs.Tab>
              <Tabs.Tab
                value="exams"
                leftSection={<IconArrowsDiff size={17} />}
              >
                {t('views.exams', 'Exam comparison')}
              </Tabs.Tab>
              <Tabs.Tab
                value="quality"
                leftSection={<IconChecklist size={17} />}
              >
                {t('views.quality', 'Data quality')}
                {qualityIssues.length > 0 && (
                  <Badge color="orange" size="xs" ml={6} variant="light">
                    {qualityIssues.length}
                  </Badge>
                )}
              </Tabs.Tab>
              <Tabs.Tab
                value="sources"
                leftSection={<IconFileDescription size={17} />}
              >
                {t('views.sources', 'Sources and review')}
              </Tabs.Tab>
              <Tabs.Tab value="alerts" leftSection={<IconBell size={17} />}>
                {t('views.alerts', 'Rule-based alerts')}
              </Tabs.Tab>
              <Tabs.Tab
                value="background"
                leftSection={<IconBook2 size={17} />}
              >
                {t('views.background', 'Health background')}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="metrics">
              <Stack gap="lg">
                <HealthDateWindowControls
                  preset={metricDatePreset}
                  draft={metricDateDraft}
                  appliedLabel={metricDateRangeLabel}
                  error={metricDateError}
                  loading={detailLoading}
                  testIdPrefix="health-metric"
                  onPresetChange={handleMetricPresetChange}
                  onDateFromChange={value => {
                    setMetricDatePreset('custom');
                    setMetricDateError(null);
                    setMetricDateDraft(current => ({
                      ...current,
                      dateFrom: value,
                    }));
                  }}
                  onDateToChange={value => {
                    setMetricDatePreset('custom');
                    setMetricDateError(null);
                    setMetricDateDraft(current => ({
                      ...current,
                      dateTo: value,
                    }));
                  }}
                  onApply={handleMetricDateApply}
                  onClear={handleMetricDateClear}
                />
                <Grid gutter="lg" align="flex-start">
                  <Grid.Col span={{ base: 12, lg: 4 }}>
                    <Paper withBorder radius="md" p="md">
                      <Stack gap="md">
                        <Group justify="space-between">
                          <Box>
                            <Title order={3}>
                              {t('catalog.title', 'Metric catalog')}
                            </Title>
                            <Text size="sm" c="dimmed">
                              {t(
                                'catalog.count',
                                '{{count}} matching metrics',
                                {
                                  count: filteredCatalog.length,
                                }
                              )}
                            </Text>
                          </Box>
                          <Button
                            variant="subtle"
                            size="compact-sm"
                            leftSection={<IconRefresh size={15} />}
                            onClick={() => setReloadToken(value => value + 1)}
                          >
                            {t('actions.refresh', 'Refresh')}
                          </Button>
                        </Group>

                        <TextInput
                          value={search}
                          onChange={event =>
                            setSearch(event.currentTarget.value)
                          }
                          leftSection={<IconSearch size={16} />}
                          label={t('filters.searchLabel', 'Search metrics')}
                          placeholder={t(
                            'filters.searchPlaceholder',
                            'Name or abbreviation'
                          )}
                        />
                        <SimpleGrid cols={2}>
                          <Select
                            label={t('filters.status', 'Latest status')}
                            value={statusFilter}
                            onChange={value => setStatusFilter(value || 'all')}
                            data={[
                              { value: 'all', label: t('filters.all', 'All') },
                              {
                                value: 'attention',
                                label: t('filters.attention', 'Needs review'),
                              },
                              {
                                value: 'normal',
                                label: t('statuses.normal', 'Normal'),
                              },
                            ]}
                            allowDeselect={false}
                          />
                          <Select
                            label={t('filters.category', 'Category')}
                            value={categoryFilter}
                            onChange={value =>
                              setCategoryFilter(value || 'all')
                            }
                            data={[
                              { value: 'all', label: t('filters.all', 'All') },
                              ...categories,
                            ]}
                            searchable
                            allowDeselect={false}
                          />
                        </SimpleGrid>

                        {catalogError && (
                          <Alert
                            color="red"
                            icon={<IconAlertTriangle size={18} />}
                          >
                            <Stack gap="xs">
                              <Text size="sm">
                                {t(
                                  'errors.catalog',
                                  'Unable to load the health metric catalog.'
                                )}
                              </Text>
                              <Button
                                variant="light"
                                color="red"
                                size="xs"
                                onClick={() =>
                                  setReloadToken(value => value + 1)
                                }
                              >
                                {t('actions.retry', 'Try again')}
                              </Button>
                            </Stack>
                          </Alert>
                        )}

                        {catalogLoading ? (
                          <Center mih={240}>
                            <Loader
                              aria-label={t(
                                'catalog.loading',
                                'Loading metric catalog'
                              )}
                            />
                          </Center>
                        ) : filteredCatalog.length === 0 ? (
                          <Center mih={240}>
                            <Stack align="center" gap="xs">
                              <IconFlask
                                size={36}
                                color="var(--mantine-color-dimmed)"
                              />
                              <Text ta="center" c="dimmed">
                                {catalog.length === 0
                                  ? t(
                                      'empty.noData',
                                      'No structured lab measurements have been stored yet.'
                                    )
                                  : t(
                                      'empty.noMatches',
                                      'No metrics match the current filters.'
                                    )}
                              </Text>
                              {catalog.length === 0 && (
                                <Button
                                  variant="light"
                                  onClick={() => navigate('/lab-results')}
                                >
                                  {t(
                                    'actions.openLabResults',
                                    'Open lab records'
                                  )}
                                </Button>
                              )}
                            </Stack>
                          </Center>
                        ) : (
                          <ScrollArea.Autosize
                            mah={720}
                            type="auto"
                            offsetScrollbars
                          >
                            <Stack gap="xs">
                              {filteredCatalog.map(entry => {
                                const active =
                                  selectedEntry &&
                                  entryKey(selectedEntry) === entryKey(entry);
                                const viewLabel =
                                  entry.result_type &&
                                  entry.result_type !== 'quantitative'
                                    ? t('modes.qualitative', 'Result sequence')
                                    : entry.reading_count >=
                                        LONG_TERM_TREND_POINT_THRESHOLD
                                      ? t('modes.trend', 'Long-term trend')
                                      : entry.reading_count >= 2
                                        ? t(
                                            'modes.comparison',
                                            'Discrete comparison'
                                          )
                                        : t(
                                            'modes.snapshot',
                                            'Latest snapshot'
                                          );

                                return (
                                  <UnstyledButton
                                    key={entryKey(entry)}
                                    onClick={() => setSelectedEntry(entry)}
                                    aria-pressed={Boolean(active)}
                                    style={theme => ({
                                      border: `1px solid ${
                                        active
                                          ? theme.colors.blue[5]
                                          : theme.colors.gray[3]
                                      }`,
                                      background: active
                                        ? 'var(--mantine-color-blue-light)'
                                        : 'var(--mantine-color-body)',
                                      borderRadius: theme.radius.md,
                                      padding: theme.spacing.sm,
                                    })}
                                  >
                                    <Stack gap={5}>
                                      <Group
                                        justify="space-between"
                                        wrap="nowrap"
                                      >
                                        <Text fw={650} lineClamp={1}>
                                          {entry.test_name}
                                        </Text>
                                        <Badge
                                          color={statusColor(entry.status)}
                                          variant="light"
                                          size="sm"
                                        >
                                          {t(
                                            `statuses.${entry.status || 'unknown'}`,
                                            {
                                              defaultValue:
                                                entry.status || 'Unknown',
                                            }
                                          )}
                                        </Badge>
                                      </Group>
                                      <Text size="lg" fw={700}>
                                        {latestDisplayValue(entry)}
                                      </Text>
                                      <Group justify="space-between" gap="xs">
                                        <Text size="xs" c="dimmed">
                                          {t(
                                            'catalog.readings',
                                            '{{count}} records',
                                            {
                                              count: entry.reading_count,
                                            }
                                          )}
                                          {entry.latest_date
                                            ? ` · ${entry.latest_date}`
                                            : ''}
                                        </Text>
                                        <Text size="xs" c="blue" fw={600}>
                                          {viewLabel}
                                        </Text>
                                      </Group>
                                    </Stack>
                                  </UnstyledButton>
                                );
                              })}
                            </Stack>
                          </ScrollArea.Autosize>
                        )}
                      </Stack>
                    </Paper>
                  </Grid.Col>

                  <Grid.Col span={{ base: 12, lg: 8 }}>
                    <Paper withBorder radius="md" p="md">
                      <HealthMetricDetail
                        data={detail}
                        loading={detailLoading}
                        patientLabel={currentPatientLabel}
                        baselineId={metricBaselineId}
                        dateRangeLabel={metricDateRangeLabel}
                        onBaselineChange={handleMetricBaselineChange}
                        onOpenLabRecord={labResultId =>
                          navigate(`/lab-results?view=${labResultId}`)
                        }
                        onOpenSourceDocument={sourceDocumentId =>
                          navigate(
                            `/health-insights?view=sources&source=${sourceDocumentId}`
                          )
                        }
                        error={
                          detailError
                            ? t(
                                'errors.detail',
                                'Unable to load this metric’s recorded values.'
                              )
                            : null
                        }
                      />
                    </Paper>
                  </Grid.Col>
                </Grid>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="coverage">
              {currentPatient?.id && (
                <HealthCoverageEvidencePanel
                  patientId={currentPatient.id}
                  components={components}
                  componentsLoading={componentsLoading}
                  componentsError={componentsError}
                  onChanged={() => setReloadToken(value => value + 1)}
                  onOpenLabRecord={labResultId =>
                    navigate(`/lab-results?view=${labResultId}`)
                  }
                  onOpenSourceDocument={sourceDocumentId =>
                    navigate(
                      `/health-insights?view=sources&source=${sourceDocumentId}`
                    )
                  }
                />
              )}
            </Tabs.Panel>

            <Tabs.Panel value="exams">
              <HealthExamComparison
                comparison={examComparison}
                loading={componentsLoading}
                error={componentsError}
                partial={components.length >= 2000}
                onSelectionChange={handleExamSelectionChange}
                onOpenLabRecord={labResultId =>
                  navigate(`/lab-results?view=${labResultId}`)
                }
                onOpenSourceDocument={sourceDocumentId =>
                  navigate(
                    `/health-insights?view=sources&source=${sourceDocumentId}`
                  )
                }
              />
            </Tabs.Panel>

            <Tabs.Panel value="vitals">
              {currentPatient?.id && (
                <VitalInsightsPanel
                  patientId={currentPatient.id}
                  patientHeight={currentPatient.height}
                  patientLabel={currentPatientLabel}
                />
              )}
            </Tabs.Panel>

            <Tabs.Panel value="quality">
              <HealthDataQualityPanel
                issues={qualityIssues}
                loading={componentsLoading}
                error={componentsError}
                onOpenSource={labResultId =>
                  navigate(`/lab-results?view=${labResultId}`)
                }
              />
            </Tabs.Panel>

            <Tabs.Panel value="sources">
              {currentPatient?.id && (
                <HealthSourcesPanel
                  patientId={currentPatient.id}
                  focusedSourceDocumentId={focusedSourceDocumentId}
                />
              )}
            </Tabs.Panel>

            <Tabs.Panel value="alerts">
              {currentPatient?.id && (
                <HealthAlertsPanel patientId={currentPatient.id} />
              )}
            </Tabs.Panel>

            <Tabs.Panel value="background">
              {currentPatient?.id && (
                <HealthBackgroundPanel patientId={currentPatient.id} />
              )}
            </Tabs.Panel>
          </Tabs>
        )}
      </Stack>
    </Container>
  );
};

export default HealthInsights;
