// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
/**
 * VitalTrendsPanel component
 * Slide-out drawer that displays historical trend data for a specific vital type
 * Shows chart, statistics, and historical data table
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Drawer,
  Stack,
  Group,
  Text,
  Title,
  Tabs,
  Alert,
  Paper,
  Badge,
  LoadingOverlay,
  Divider,
  Box,
  Skeleton,
  ActionIcon,
  Tooltip,
  Select,
} from '@mantine/core';
import {
  IconChartLine,
  IconTable,
  IconAlertCircle,
  IconRefresh,
  IconFilter,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import logger from '../../../services/logger';
import VitalTrendChart from './VitalTrendChart';
import VitalTrendTable from './VitalTrendTable';
import {
  VitalType,
  VitalTrendResponse,
  VitalDataPoint,
  VITAL_TYPE_CONFIGS,
  AggregationPeriod,
} from './types';
import { vitalsService } from '../../../services/medical/vitalsService';
import { useUserPreferences } from '../../../contexts/UserPreferencesContext';
import { convertForDisplay, unitLabels } from '../../../utils/unitConversion';
import {
  smartAggregateVitalData,
  getAggregationDescription,
  AggregatedDataPoint,
} from '../../../utils/vitalDataAggregation';
import VitalTrendExportActions from './VitalTrendExportActions';
import HealthDateWindowControls from '../../health/HealthDateWindowControls';
import HealthBaselineComparisonCard from '../../health/HealthBaselineComparisonCard';
import {
  formatHealthDateWindowLabel,
  resolveHealthDatePreset,
  toLocalCalendarUtcBounds,
  validateHealthDateWindow,
  type HealthDatePreset,
  type HealthDateWindow,
  type HealthDateWindowError,
} from '../../../utils/healthDateWindow';
import { buildHealthBaselineComparison } from '../../../utils/healthBaselineComparison';

// Maps vital types to their corresponding measurement types for unit conversion
const CONVERTIBLE_VITAL_TYPES: Partial<
  Record<VitalType, 'weight' | 'temperature'>
> = {
  weight: 'weight',
  temperature: 'temperature',
};

interface VitalTrendsPanelProps {
  opened: boolean;
  onClose: () => void;
  vitalType: VitalType | null;
  patientId: number;
  patientHeight?: number | null;
  patientLabel?: string;
  onOpenRecord?: (_id: number) => void;
}

// Raw data structure before unit conversion (stored in imperial units)
interface RawTrendData {
  vital_type: VitalType;
  vital_type_label: string;
  base_unit: string;
  data_points: VitalDataPoint[];
  reference_range: VitalTrendResponse['reference_range'];
}

// Safety limit to prevent runaway pagination loops
const MAX_PAGINATION_RECORDS = 50000;
const PAGE_SIZE = 500;

const VitalTrendsPanel: React.FC<VitalTrendsPanelProps> = ({
  opened,
  onClose,
  vitalType,
  patientId,
  patientHeight,
  patientLabel,
  onOpenRecord,
}) => {
  const { t } = useTranslation(['common', 'shared', 'healthInsights']);
  const { unitSystem } = useUserPreferences();
  // Store raw data in imperial units - conversion happens in useMemo
  const [rawTrendData, setRawTrendData] = useState<RawTrendData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('chart');
  const [timeRange, setTimeRange] = useState<HealthDatePreset>('all');
  const [dateDraft, setDateDraft] = useState<HealthDateWindow>({
    dateFrom: '',
    dateTo: '',
  });
  const [appliedDateWindow, setAppliedDateWindow] = useState<HealthDateWindow>({
    dateFrom: '',
    dateTo: '',
  });
  const [dateError, setDateError] = useState<HealthDateWindowError | null>(
    null
  );
  const [selectedBaselineId, setSelectedBaselineId] = useState<number | null>(
    null
  );
  const [glucoseContextFilter, setGlucoseContextFilter] =
    useState<string>('all');
  // Aggregation state
  const [aggregationPeriod, setAggregationPeriod] =
    useState<AggregationPeriod | null>(null);
  const [aggregatedDataPoints, setAggregatedDataPoints] = useState<
    AggregatedDataPoint[]
  >([]);

  /**
   * Fetch all vitals for a specific type using pagination
   * This ensures we get complete historical data even for users with 1000+ records
   */
  const fetchAllVitalsForType = useCallback(
    async (
      targetPatientId: number,
      targetVitalType: VitalType,
      dateRange?: { startDate?: string; endDate?: string }
    ): Promise<any[]> => {
      const allRecords: any[] = [];
      const seenIds = new Set<number>();
      let skip = 0;
      let hasMore = true;

      // Map vital type to backend field name for filtering
      // BMI requires fetching weight records
      const backendVitalType =
        targetVitalType === 'bmi' ? 'weight' : targetVitalType;

      while (hasMore && allRecords.length < MAX_PAGINATION_RECORDS) {
        const params: Record<string, any> = {
          skip: String(skip),
          limit: String(PAGE_SIZE),
          vital_type: backendVitalType,
        };

        // Add glucose context filter for blood glucose queries
        if (
          glucoseContextFilter &&
          glucoseContextFilter !== 'all' &&
          backendVitalType === 'blood_glucose'
        ) {
          params.glucose_context = glucoseContextFilter;
        }

        let records: unknown;
        if (dateRange?.startDate || dateRange?.endDate) {
          records = await vitalsService.getPatientVitalsDateRange(
            targetPatientId,
            dateRange.startDate,
            dateRange.endDate,
            params
          );
        } else {
          records = await vitalsService.getPatientVitals(
            targetPatientId,
            params
          );
        }

        const responseData =
          records && typeof records === 'object' && 'data' in records
            ? (records as { data?: unknown }).data
            : undefined;
        const recordsArray: any[] = Array.isArray(records)
          ? records
          : Array.isArray(responseData)
            ? responseData
            : [];

        // Check for duplicates to detect pagination issues
        let newRecordsCount = 0;
        for (const record of recordsArray) {
          if (!seenIds.has(record.id)) {
            seenIds.add(record.id);
            allRecords.push(record);
            newRecordsCount++;
          }
        }

        // Stop if we got fewer records than requested (no more pages)
        // or if all records were duplicates (pagination issue)
        if (recordsArray.length < PAGE_SIZE || newRecordsCount === 0) {
          hasMore = false;
        } else {
          skip += PAGE_SIZE;
        }
      }

      return allRecords;
    },
    [glucoseContextFilter]
  );

  const loadTrendData = useCallback(async () => {
    if (!vitalType || !patientId) return;

    // For BMI, we need patient height
    if (vitalType === 'bmi' && !patientHeight) {
      setError(
        t(
          'vitals:trends.noHeightForBMI',
          'Patient height is required to calculate BMI trends. Please update the patient profile with their height.'
        )
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setAggregationPeriod(null);
    setAggregatedDataPoints([]);

    try {
      const dateRange = toLocalCalendarUtcBounds(appliedDateWindow);
      const config = VITAL_TYPE_CONFIGS[vitalType];

      // Fetch ALL vitals for this type using pagination
      const vitalsData = await fetchAllVitalsForType(
        patientId,
        vitalType,
        dateRange
      );

      // Helper function to calculate BMI from weight (lbs) and height (inches)
      const calculateBMI = (
        weightLbs: number,
        heightInches: number
      ): number => {
        const bmi = (weightLbs / (heightInches * heightInches)) * 703;
        return Math.round(bmi * 10) / 10; // Round to 1 decimal place
      };

      // For BMI, we need to calculate from weight records using patient height
      const isBMI = vitalType === 'bmi';

      // Filter and transform data points - store raw values in imperial units
      const dataPoints: VitalDataPoint[] = vitalsData
        .filter((vital: any) => {
          if (isBMI) {
            // For BMI, we need weight and patient height
            return (
              vital.weight !== null &&
              vital.weight !== undefined &&
              patientHeight
            );
          }
          return (
            config.getValue(vital) !== null &&
            config.getValue(vital) !== undefined
          );
        })
        .map((vital: any) => {
          let value: number;
          if (isBMI && patientHeight) {
            // Calculate BMI from weight and patient height
            value = calculateBMI(vital.weight, patientHeight);
          } else {
            const configuredValue = config.getValue(vital);
            if (configuredValue === null || configuredValue === undefined) {
              throw new Error('Filtered vital is missing its configured value');
            }
            value = configuredValue;
          }
          const secondaryValue = config.getSecondaryValue
            ? config.getSecondaryValue(vital)
            : null;

          // Store raw values - conversion happens in useMemo based on unitSystem
          return {
            id: vital.id,
            value: value,
            secondary_value: secondaryValue,
            recorded_date: vital.recorded_date,
            glucose_context: vital.glucose_context || null,
          };
        })
        .sort(
          (a: VitalDataPoint, b: VitalDataPoint) =>
            new Date(b.recorded_date).getTime() -
            new Date(a.recorded_date).getTime()
        );

      // Apply smart aggregation for large datasets
      const aggregationResult = smartAggregateVitalData(dataPoints);
      setAggregationPeriod(aggregationResult.period);
      setAggregatedDataPoints(aggregationResult.aggregatedPoints);

      // Store raw data - unit conversion and statistics calculated in useMemo
      const rawData: RawTrendData = {
        vital_type: vitalType,
        vital_type_label: config.label,
        base_unit: config.unit,
        data_points: dataPoints,
        reference_range: config.referenceRange,
      };

      setRawTrendData(rawData);

      logger.info('vital_trends_loaded', {
        message: 'Vital trends loaded successfully',
        vitalType,
        patientId,
        dateFrom: appliedDateWindow.dateFrom || null,
        dateTo: appliedDateWindow.dateTo || null,
        dataPointCount: dataPoints.length,
        aggregationPeriod: aggregationResult.period,
        aggregatedPointCount: aggregationResult.aggregatedPoints.length,
        component: 'VitalTrendsPanel',
      });
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to load trend data';
      setError(errorMessage);

      logger.error('vital_trends_error', {
        message: 'Error loading vital trends',
        vitalType,
        patientId,
        error: errorMessage,
        component: 'VitalTrendsPanel',
      });

      notifications.show({
        title: t('shared:labels.error', 'Error'),
        message: errorMessage,
        color: 'red',
        autoClose: 5000,
      });
    } finally {
      setLoading(false);
    }
  }, [
    vitalType,
    patientId,
    appliedDateWindow,
    patientHeight,
    t,
    fetchAllVitalsForType,
  ]);

  useEffect(() => {
    if (opened && vitalType) {
      const timeoutId = setTimeout(() => {
        loadTrendData();
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [opened, vitalType, loadTrendData]);

  // Reset state when panel closes
  useEffect(() => {
    if (!opened) {
      setRawTrendData(null);
      setError(null);
      setActiveTab('chart');
      setAggregationPeriod(null);
      setAggregatedDataPoints([]);
      setGlucoseContextFilter('all');
      setSelectedBaselineId(null);
    }
  }, [opened]);

  // Get measurement type for the current vital (for unit conversion)
  const measurementType = useMemo(
    () =>
      rawTrendData
        ? CONVERTIBLE_VITAL_TYPES[rawTrendData.vital_type]
        : undefined,
    [rawTrendData]
  );

  // Convert aggregated data points based on unit system
  // This ensures chart displays values in the user's preferred unit
  const convertedAggregatedDataPoints = useMemo((): AggregatedDataPoint[] => {
    if (!measurementType || aggregatedDataPoints.length === 0) {
      return aggregatedDataPoints;
    }

    // Helper to convert a value, falling back to original if conversion returns null
    const convert = (value: number): number =>
      convertForDisplay(value, measurementType, unitSystem) ?? value;

    // Helper for optional values (returns undefined if input is null/undefined)
    const convertOptional = (
      value: number | null | undefined
    ): number | null | undefined => (value != null ? convert(value) : value);

    return aggregatedDataPoints.map(point => ({
      ...point,
      average: convert(point.average),
      min: convert(point.min),
      max: convert(point.max),
      secondaryAverage: convertOptional(point.secondaryAverage),
      secondaryMin: convertOptional(point.secondaryMin),
      secondaryMax: convertOptional(point.secondaryMax),
    }));
  }, [aggregatedDataPoints, measurementType, unitSystem]);

  // Derive converted trend data from raw data based on unit system
  // This allows unit changes to update display without refetching from API
  const trendData = useMemo((): VitalTrendResponse | null => {
    if (!rawTrendData) return null;

    // Convert data points if this vital type needs unit conversion
    const convertedDataPoints = rawTrendData.data_points.map(point => ({
      ...point,
      value: measurementType
        ? (convertForDisplay(point.value, measurementType, unitSystem) ??
          point.value)
        : point.value,
    }));

    // Determine display unit based on user preference
    const displayUnitSystem: keyof typeof unitLabels =
      unitSystem === 'metric' ? 'metric' : 'imperial';
    const displayUnit = measurementType
      ? unitLabels[displayUnitSystem][measurementType]
      : rawTrendData.base_unit;

    // Calculate statistics from converted values
    const values = convertedDataPoints.map(p => p.value);
    const secondaryValues = convertedDataPoints
      .map(p => p.secondary_value)
      .filter((v): v is number => v !== null && v !== undefined);

    // Calculate standard deviation for primary values
    let stdDev: number | null = null;
    if (values.length > 1) {
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const squareDiffs = values.map(v => Math.pow(v - mean, 2));
      stdDev = Math.sqrt(
        squareDiffs.reduce((a, b) => a + b, 0) / values.length
      );
    }

    // Calculate secondary statistics (for blood pressure diastolic)
    let secondaryStdDev: number | null = null;
    if (secondaryValues.length > 1) {
      const mean =
        secondaryValues.reduce((a, b) => a + b, 0) / secondaryValues.length;
      const squareDiffs = secondaryValues.map(v => Math.pow(v - mean, 2));
      secondaryStdDev = Math.sqrt(
        squareDiffs.reduce((a, b) => a + b, 0) / secondaryValues.length
      );
    }

    return {
      vital_type: rawTrendData.vital_type,
      vital_type_label: rawTrendData.vital_type_label,
      unit: displayUnit,
      data_points: convertedDataPoints,
      statistics: {
        count: convertedDataPoints.length,
        latest: values.length > 0 ? values[0] : null,
        average:
          values.length > 0
            ? values.reduce((a, b) => a + b, 0) / values.length
            : null,
        min: values.length > 0 ? Math.min(...values) : null,
        max: values.length > 0 ? Math.max(...values) : null,
        std_dev: stdDev,
        secondary_latest:
          secondaryValues.length > 0 ? secondaryValues[0] : null,
        secondary_average:
          secondaryValues.length > 0
            ? secondaryValues.reduce((a, b) => a + b, 0) /
              secondaryValues.length
            : null,
        secondary_min:
          secondaryValues.length > 0 ? Math.min(...secondaryValues) : null,
        secondary_max:
          secondaryValues.length > 0 ? Math.max(...secondaryValues) : null,
        secondary_std_dev: secondaryStdDev,
      },
      reference_range: rawTrendData.reference_range,
    };
  }, [rawTrendData, unitSystem, measurementType]);

  const dateRangeLabel = formatHealthDateWindowLabel(appliedDateWindow, {
    all: t('healthInsights:visualizationContext.date.applied.all'),
    both: (dateFrom, dateTo) =>
      t('healthInsights:visualizationContext.date.applied.both', {
        dateFrom,
        dateTo,
      }),
    from: dateFrom =>
      t('healthInsights:visualizationContext.date.applied.from', { dateFrom }),
    to: dateTo =>
      t('healthInsights:visualizationContext.date.applied.to', { dateTo }),
  });
  const vitalComparablePoints = useMemo(
    () =>
      (trendData?.data_points || []).map(point => ({
        id: point.id,
        date: point.recorded_date,
        primaryValue: point.value,
        secondaryValue: point.secondary_value,
        displayValue:
          point.secondary_value === null || point.secondary_value === undefined
            ? String(point.value)
            : `${point.value}/${point.secondary_value}`,
        unit: trendData?.unit,
        kind: 'quantitative' as const,
      })),
    [trendData]
  );
  const requestedVitalComparison = useMemo(
    () =>
      buildHealthBaselineComparison(vitalComparablePoints, selectedBaselineId),
    [selectedBaselineId, vitalComparablePoints]
  );
  const defaultVitalComparison = useMemo(
    () => buildHealthBaselineComparison(vitalComparablePoints),
    [vitalComparablePoints]
  );
  const vitalComparison =
    requestedVitalComparison.reason === 'invalid_baseline' &&
    defaultVitalComparison.reason === null
      ? defaultVitalComparison
      : requestedVitalComparison;

  useEffect(() => {
    const resolvedId = vitalComparison.baseline?.id;
    if (
      resolvedId &&
      vitalComparison.reason === null &&
      resolvedId !== selectedBaselineId
    ) {
      setSelectedBaselineId(resolvedId);
    }
  }, [selectedBaselineId, vitalComparison]);

  const handleDatePresetChange = (preset: HealthDatePreset) => {
    setTimeRange(preset);
    setDateError(null);
    if (preset !== 'custom') setDateDraft(resolveHealthDatePreset(preset));
  };

  const applyDateWindow = () => {
    const validation = validateHealthDateWindow(dateDraft);
    setDateError(validation);
    if (validation) return;
    setSelectedBaselineId(null);
    setAppliedDateWindow(dateDraft);
  };

  const clearDateWindow = () => {
    const emptyWindow = { dateFrom: '', dateTo: '' };
    setTimeRange('all');
    setDateDraft(emptyWindow);
    setAppliedDateWindow(emptyWindow);
    setSelectedBaselineId(null);
    setDateError(null);
  };

  const vitalConfig = vitalType ? VITAL_TYPE_CONFIGS[vitalType] : null;

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="xl"
      title={
        <Group gap="sm">
          <IconChartLine size={24} />
          <div>
            <Text fw={600} size="lg">
              {t('vitals:trends.title', 'Trend Analysis')}
            </Text>
            {vitalConfig && (
              <Text size="sm" c="dimmed">
                {vitalConfig.label}
              </Text>
            )}
          </div>
        </Group>
      }
      overlayProps={{ opacity: 0.5, blur: 4 }}
      zIndex={2500}
    >
      <Stack gap="md" style={{ position: 'relative', minHeight: '100%' }}>
        <LoadingOverlay visible={loading} overlayProps={{ blur: 2 }} />

        {/* Error State */}
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            title={t('shared:labels.error', 'Error')}
            color="red"
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}

        {/* Time Range Filter */}
        {!loading && (
          <Stack gap="md">
            <HealthDateWindowControls
              preset={timeRange}
              draft={dateDraft}
              appliedLabel={dateRangeLabel}
              error={dateError}
              loading={loading}
              testIdPrefix="vital-trend"
              onPresetChange={handleDatePresetChange}
              onDateFromChange={value => {
                setTimeRange('custom');
                setDateError(null);
                setDateDraft(current => ({ ...current, dateFrom: value }));
              }}
              onDateToChange={value => {
                setTimeRange('custom');
                setDateError(null);
                setDateDraft(current => ({ ...current, dateTo: value }));
              }}
              onApply={applyDateWindow}
              onClear={clearDateWindow}
            />

            <Paper withBorder p="md" radius="md" bg="var(--color-bg-secondary)">
              {vitalType === 'blood_glucose' && (
                <Select
                  label={t(
                    'vitals:trends.glucoseContextFilter',
                    'Blood Sugar Type'
                  )}
                  placeholder={t('vitals:trends.allContexts', 'All Types')}
                  value={glucoseContextFilter}
                  onChange={value => setGlucoseContextFilter(value || 'all')}
                  data={[
                    {
                      value: 'all',
                      label: t('vitals:trends.allContexts', 'All Types'),
                    },
                    {
                      value: 'fasting',
                      label: t('vitals:glucoseContext.fasting', 'Fasting'),
                    },
                    {
                      value: 'before_meal',
                      label: t(
                        'vitals:glucoseContext.before_meal',
                        'Before Meal'
                      ),
                    },
                    {
                      value: 'after_meal',
                      label: t(
                        'vitals:glucoseContext.after_meal',
                        'After Meal'
                      ),
                    },
                    {
                      value: 'random',
                      label: t('vitals:glucoseContext.random', 'Random'),
                    },
                  ]}
                  leftSection={<IconFilter size={16} />}
                  size="md"
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true, zIndex: 3000 }}
                />
              )}
            </Paper>
          </Stack>
        )}

        {/* Statistics Summary */}
        {trendData && !loading && (
          <Paper withBorder p="md" radius="md">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Text fw={600} size="sm">
                  {t('vitals:trends.summaryStatistics', 'Summary Statistics')}
                </Text>
                <Group gap="xs">
                  <Tooltip label={t('buttons.refresh', 'Refresh')}>
                    <ActionIcon
                      variant="subtle"
                      onClick={loadTrendData}
                      size="sm"
                    >
                      <IconRefresh size={16} />
                    </ActionIcon>
                  </Tooltip>
                  {trendData.vital_type !== 'bmi' && (
                    <VitalTrendExportActions
                      trendData={trendData}
                      patientLabel={
                        patientLabel?.trim() ||
                        t(
                          'healthInsights:labels.unknownMember',
                          'Unknown household member'
                        )
                      }
                      timeRangeLabel={dateRangeLabel}
                      comparison={vitalComparison}
                    />
                  )}
                </Group>
              </Group>

              <Divider />

              <Group gap="xl">
                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals:trends.latest', 'Latest')}
                  </Text>
                  <Group gap="xs" align="baseline">
                    <Text fw={700} size="xl">
                      {trendData.statistics.latest?.toFixed(0) ?? 'N/A'}
                      {trendData.statistics.secondary_latest != null && (
                        <Text span c="dimmed">
                          /{trendData.statistics.secondary_latest.toFixed(0)}
                        </Text>
                      )}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {trendData.unit}
                    </Text>
                  </Group>
                </Box>

                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals:trends.average', 'Average')}
                  </Text>
                  <Group gap="xs" align="baseline">
                    <Text fw={600} size="lg">
                      {trendData.statistics.average?.toFixed(0) ?? 'N/A'}
                      {trendData.statistics.secondary_average != null && (
                        <Text span c="dimmed">
                          /{trendData.statistics.secondary_average.toFixed(0)}
                        </Text>
                      )}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {trendData.unit}
                    </Text>
                  </Group>
                </Box>

                <Box>
                  <Text size="xs" c="dimmed">
                    {t('vitals:trends.range', 'Range')}
                  </Text>
                  <Group gap="xs" align="baseline">
                    {trendData.statistics.min != null &&
                    trendData.statistics.max != null ? (
                      <>
                        <Text fw={600} size="sm">
                          {trendData.statistics.min.toFixed(0)}
                          {trendData.statistics.secondary_min != null && (
                            <Text span c="dimmed">
                              /{trendData.statistics.secondary_min.toFixed(0)}
                            </Text>
                          )}
                          {' - '}
                          {trendData.statistics.max.toFixed(0)}
                          {trendData.statistics.secondary_max != null && (
                            <Text span c="dimmed">
                              /{trendData.statistics.secondary_max.toFixed(0)}
                            </Text>
                          )}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {trendData.unit}
                        </Text>
                      </>
                    ) : (
                      <Text fw={600} size="sm">
                        {t('labels.notAvailable', 'N/A')}
                      </Text>
                    )}
                  </Group>
                </Box>
              </Group>

              <Group gap="md">
                <Badge variant="light" color="blue" size="lg">
                  {aggregationPeriod
                    ? getAggregationDescription(
                        aggregationPeriod,
                        trendData.statistics.count,
                        aggregatedDataPoints.length
                      )
                    : `${trendData.statistics.count} ${t('vitals:trends.dataPoints', 'data points')}`}
                </Badge>

                {trendData.statistics.std_dev !== null && (
                  <Badge variant="light" color="gray" size="lg">
                    {t('vitals:trends.stdDev', 'Std Dev')}:{' '}
                    {trendData.statistics.std_dev.toFixed(1)}
                    {trendData.statistics.secondary_std_dev != null && (
                      <Text span>
                        /{trendData.statistics.secondary_std_dev.toFixed(1)}
                      </Text>
                    )}
                  </Badge>
                )}
              </Group>
            </Stack>
          </Paper>
        )}

        {trendData && !loading && (
          <HealthBaselineComparisonCard
            comparison={vitalComparison}
            onBaselineChange={setSelectedBaselineId}
            primaryLabel={
              vitalType === 'blood_pressure'
                ? t('healthInsights:visualizationContext.baseline.systolic')
                : undefined
            }
            secondaryLabel={
              vitalType === 'blood_pressure'
                ? t('healthInsights:visualizationContext.baseline.diastolic')
                : undefined
            }
            testIdPrefix="vital-trend"
          />
        )}

        {/* Tabs for Chart and Table Views */}
        {trendData && !loading && (
          <Tabs
            value={activeTab}
            onChange={value => setActiveTab(value || 'chart')}
          >
            <Tabs.List>
              <Tabs.Tab value="chart" leftSection={<IconChartLine size={16} />}>
                {t('vitals:trends.chart', 'Chart')}
              </Tabs.Tab>
              <Tabs.Tab value="table" leftSection={<IconTable size={16} />}>
                {t('vitals:trends.dataTable', 'Data Table')}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="chart" pt="md">
              <VitalTrendChart
                trendData={trendData}
                aggregatedDataPoints={convertedAggregatedDataPoints}
                aggregationPeriod={aggregationPeriod}
                glucoseContextFilter={glucoseContextFilter}
              />
            </Tabs.Panel>

            <Tabs.Panel value="table" pt="md">
              <VitalTrendTable
                trendData={trendData}
                onOpenRecord={onOpenRecord}
              />
            </Tabs.Panel>
          </Tabs>
        )}

        {/* Empty State */}
        {trendData && trendData.data_points.length === 0 && !loading && (
          <Paper withBorder p="xl" radius="md" bg="var(--color-bg-secondary)">
            <Stack align="center" gap="md">
              <IconChartLine size={48} color="var(--mantine-color-gray-5)" />
              <Title order={3} c="dimmed">
                {t('vitals:trends.noData', 'No trend data available')}
              </Title>
              <Text size="sm" c="dimmed" ta="center">
                {t(
                  'vitals:trends.noDataDesc',
                  'There are no historical data points for this vital sign.'
                )}
              </Text>
            </Stack>
          </Paper>
        )}

        {/* Loading Skeleton */}
        {loading && !trendData && (
          <Stack gap="md">
            <Skeleton height={150} radius="md" />
            <Skeleton height={300} radius="md" />
          </Stack>
        )}
      </Stack>
    </Drawer>
  );
};

export default VitalTrendsPanel;
