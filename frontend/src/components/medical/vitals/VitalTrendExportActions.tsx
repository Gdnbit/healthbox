import { Button, Menu } from '@mantine/core';
import {
  IconDownload,
  IconFileSpreadsheet,
  IconFileTypeSvg,
  IconPrinter,
} from '@tabler/icons-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadBlob } from '../../../utils/downloadUtils';
import {
  VITAL_VISUAL_EXPORT_LIMIT,
  buildVitalTrendExportFilename,
  buildVitalTrendExportModel,
  renderVitalTrendCsv,
  renderVitalTrendSvg,
  type VitalTrendExportLabels,
} from '../../../utils/vitalTrendExport';
import type { VitalTrendResponse } from './types';
import type { HealthBaselineComparison } from '../../../utils/healthBaselineComparison';

interface VitalTrendExportActionsProps {
  trendData: VitalTrendResponse;
  patientLabel: string;
  timeRangeLabel: string;
  comparison?: HealthBaselineComparison;
}

const VitalTrendExportActions = ({
  trendData,
  patientLabel,
  timeRangeLabel,
  comparison,
}: VitalTrendExportActionsProps) => {
  const { t } = useTranslation(['healthInsights', 'vitals']);
  const labels = useMemo<VitalTrendExportLabels>(() => {
    const isBloodPressure = trendData.vital_type === 'blood_pressure';
    return {
      member: t('healthInsights:export.fields.member', 'Household member'),
      generatedAt: t(
        'healthInsights:export.fields.generatedAt',
        'Generated at'
      ),
      vitalType: t('healthInsights:vitalExport.fields.vitalType', 'Vital sign'),
      timeRange: t('healthInsights:vitalExport.fields.timeRange', 'Time range'),
      mode: t('healthInsights:export.fields.mode', 'Visualization mode'),
      modeLabels: {
        empty: t('healthInsights:modes.empty', 'No data'),
        snapshot: t('healthInsights:modes.snapshot', 'Latest snapshot'),
        comparison: t('healthInsights:modes.comparison', 'Discrete comparison'),
        trend: t('healthInsights:modes.trend', 'Long-term trend'),
      },
      observations: t(
        'healthInsights:export.fields.observations',
        'Recorded observations'
      ),
      date: t('healthInsights:columns.date', 'Date'),
      primaryValue: t(
        'healthInsights:vitalExport.fields.primaryValue',
        'Primary value'
      ),
      secondaryValue: t(
        'healthInsights:vitalExport.fields.secondaryValue',
        'Secondary value'
      ),
      displayValue: t('healthInsights:columns.value', 'Value'),
      unit: t('healthInsights:export.fields.unit', 'Unit'),
      context: t('healthInsights:vitalExport.fields.context', 'Context'),
      recordId: t(
        'healthInsights:vitalExport.fields.recordId',
        'Vital record ID'
      ),
      primarySeries: isBloodPressure
        ? t('vitals:systolic', 'Systolic')
        : trendData.vital_type_label,
      secondarySeries: isBloodPressure
        ? t('vitals:diastolic', 'Diastolic')
        : t('healthInsights:vitalExport.series.secondary', 'Secondary'),
      noContext: t('healthInsights:vitalExport.noContext', 'Not recorded'),
      disclaimer: t(
        'healthInsights:export.disclaimer',
        'This export organizes stored records and is not a diagnosis.'
      ),
      visualLimit: t('healthInsights:vitalExport.visualLimit', {
        defaultValue:
          'SVG and print are limited to {{limit}} observations; CSV remains complete.',
        limit: VITAL_VISUAL_EXPORT_LIMIT,
      }),
      baselineRecord: t(
        'healthInsights:visualizationContext.export.baselineRecord',
        'Baseline record'
      ),
      targetRecord: t(
        'healthInsights:visualizationContext.export.targetRecord',
        'Target record'
      ),
      absoluteChange: t(
        'healthInsights:visualizationContext.export.absoluteChange',
        'Absolute change'
      ),
    };
  }, [t, trendData.vital_type, trendData.vital_type_label]);
  const model = useMemo(
    () =>
      buildVitalTrendExportModel(trendData, {
        patientLabel,
        timeRangeLabel,
        comparison,
      }),
    [comparison, patientLabel, timeRangeLabel, trendData]
  );
  const svg = useMemo(
    () => (model.visualExportAllowed ? renderVitalTrendSvg(model, labels) : ''),
    [labels, model]
  );
  const empty = model.observations.length === 0;
  const visualDisabled = !model.visualExportAllowed;

  const downloadSvg = () => {
    if (!svg) return;
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      buildVitalTrendExportFilename(model, 'svg')
    );
  };

  const downloadCsv = () => {
    downloadBlob(
      new Blob([renderVitalTrendCsv(model, labels)], {
        type: 'text/csv;charset=utf-8',
      }),
      buildVitalTrendExportFilename(model, 'csv')
    );
  };

  const printReport = () => {
    if (visualDisabled) return;
    document.body.classList.add('vital-trend-printing');
    try {
      window.print();
    } finally {
      document.body.classList.remove('vital-trend-printing');
    }
  };

  return (
    <>
      <Menu shadow="md" position="bottom-end" withinPortal zIndex={3000}>
        <Menu.Target>
          <Button
            variant="light"
            size="compact-sm"
            leftSection={<IconDownload size={15} />}
            disabled={empty}
            aria-label={t(
              'healthInsights:export.actions.open',
              'Export and print'
            )}
          >
            {t('healthInsights:export.actions.open', 'Export and print')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>
            {t(
              'healthInsights:vitalExport.description',
              'Portable vital-sign report'
            )}
          </Menu.Label>
          {!empty && visualDisabled && (
            <Menu.Label>{labels.visualLimit}</Menu.Label>
          )}
          <Menu.Item
            leftSection={<IconFileTypeSvg size={16} />}
            onClick={downloadSvg}
            disabled={visualDisabled}
          >
            {t('healthInsights:export.actions.svg', 'Download SVG')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={downloadCsv}
          >
            {t('healthInsights:export.actions.csv', 'Download CSV')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconPrinter size={16} />}
            onClick={printReport}
            disabled={visualDisabled}
          >
            {t('healthInsights:export.actions.print', 'Print / save PDF')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <section
        className="vital-trend-print-report"
        data-testid="vital-trend-print-report"
        aria-hidden="true"
      >
        {model.visualExportAllowed && (
          <>
            <div
              className="vital-trend-print-svg"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <table>
              <caption>{labels.observations}</caption>
              <thead>
                <tr>
                  <th>{labels.date}</th>
                  <th>{labels.primaryValue}</th>
                  <th>{labels.secondaryValue}</th>
                  <th>{labels.displayValue}</th>
                  <th>{labels.unit}</th>
                  <th>{labels.context}</th>
                  <th>{labels.recordId}</th>
                </tr>
              </thead>
              <tbody>
                {model.observations.map(observation => (
                  <tr key={observation.id}>
                    <td>{observation.date}</td>
                    <td>{observation.primaryValue}</td>
                    <td>{observation.secondaryValue ?? '—'}</td>
                    <td>{observation.displayValue}</td>
                    <td>{observation.unit}</td>
                    <td>
                      {observation.context === '—'
                        ? labels.noContext
                        : observation.context}
                    </td>
                    <td>{observation.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="vital-trend-print-disclaimer">{labels.disclaimer}</p>
          </>
        )}
      </section>
    </>
  );
};

export default VitalTrendExportActions;
