import { Button, Menu } from '@mantine/core';
import {
  IconDownload,
  IconFileSpreadsheet,
  IconFileTypeSvg,
  IconPrinter,
} from '@tabler/icons-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrendResponse } from '../../services/api/labTestComponentApi';
import type { HealthBaselineComparison } from '../../utils/healthBaselineComparison';
import { downloadBlob } from '../../utils/downloadUtils';
import {
  buildHealthMetricExportModel,
  buildHealthMetricFilename,
  renderHealthMetricCsv,
  renderHealthMetricSvg,
  type HealthMetricExportLabels,
} from '../../utils/healthMetricExport';

interface HealthMetricExportActionsProps {
  data: TrendResponse;
  patientLabel: string;
  dateRangeLabel?: string;
  comparison?: HealthBaselineComparison;
}

const HealthMetricExportActions = ({
  data,
  patientLabel,
  dateRangeLabel,
  comparison,
}: HealthMetricExportActionsProps) => {
  const { t } = useTranslation('healthInsights');
  const labels = useMemo<HealthMetricExportLabels>(
    () => ({
      metric: t('export.fields.metric', 'Metric'),
      member: t('export.fields.member', 'Household member'),
      generatedAt: t('export.fields.generatedAt', 'Generated at'),
      mode: t('export.fields.mode', 'Visualization mode'),
      category: t('export.fields.category', 'Category'),
      dateRange: t('visualizationContext.export.dateRange', 'Date range'),
      baselineRecord: t(
        'visualizationContext.export.baselineRecord',
        'Baseline record'
      ),
      targetRecord: t(
        'visualizationContext.export.targetRecord',
        'Target record'
      ),
      absoluteChange: t(
        'visualizationContext.export.absoluteChange',
        'Absolute change'
      ),
      modeLabels: {
        empty: t('modes.empty', 'No data'),
        snapshot: t('modes.snapshot', 'Latest snapshot'),
        comparison: t('modes.comparison', 'Discrete comparison'),
        trend: t('modes.trend', 'Long-term trend'),
        qualitative: t('modes.qualitative', 'Result sequence'),
      },
      observations: t('export.fields.observations', 'Recorded observations'),
      date: t('columns.date', 'Date'),
      value: t('columns.value', 'Value'),
      unit: t('export.fields.unit', 'Unit'),
      status: t('columns.status', 'Status'),
      referenceRange: t('columns.reference', 'Reference range'),
      sourceRecord: t('columns.source', 'Source record'),
      sourceId: t('export.fields.sourceId', 'Source record ID'),
      noData: t('export.noData', 'No observations are available to export.'),
      unitMismatch: t(
        'export.unitMismatch',
        'Multiple units are present, so no combined series is drawn.'
      ),
      disclaimer: t(
        'export.disclaimer',
        'This export organizes stored records and is not a diagnosis.'
      ),
    }),
    [t]
  );
  const model = useMemo(
    () =>
      buildHealthMetricExportModel(data, {
        patientLabel,
        dateRangeLabel,
        comparison,
      }),
    [comparison, data, dateRangeLabel, patientLabel]
  );
  const svg = useMemo(
    () => renderHealthMetricSvg(model, labels),
    [labels, model]
  );
  const disabled = model.observations.length === 0;

  const downloadSvg = () => {
    downloadBlob(
      new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
      buildHealthMetricFilename(model, 'svg')
    );
  };

  const downloadCsv = () => {
    downloadBlob(
      new Blob([renderHealthMetricCsv(model, labels)], {
        type: 'text/csv;charset=utf-8',
      }),
      buildHealthMetricFilename(model, 'csv')
    );
  };

  const printReport = () => {
    document.body.classList.add('health-metric-printing');
    try {
      window.print();
    } finally {
      document.body.classList.remove('health-metric-printing');
    }
  };

  return (
    <>
      <Menu shadow="md" position="bottom-end" withinPortal>
        <Menu.Target>
          <Button
            variant="light"
            size="compact-sm"
            leftSection={<IconDownload size={15} />}
            disabled={disabled}
            aria-label={t('export.actions.open', 'Export and print')}
          >
            {t('export.actions.open', 'Export and print')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>
            {t('export.actions.description', 'Portable metric report')}
          </Menu.Label>
          <Menu.Item
            leftSection={<IconFileTypeSvg size={16} />}
            onClick={downloadSvg}
          >
            {t('export.actions.svg', 'Download SVG')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconFileSpreadsheet size={16} />}
            onClick={downloadCsv}
          >
            {t('export.actions.csv', 'Download CSV')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconPrinter size={16} />}
            onClick={printReport}
          >
            {t('export.actions.print', 'Print / save PDF')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <section
        className="health-metric-print-report"
        data-testid="health-metric-print-report"
        aria-hidden="true"
      >
        <div
          className="health-metric-print-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <table>
          <caption>{labels.observations}</caption>
          <thead>
            <tr>
              <th>{labels.date}</th>
              <th>{labels.value}</th>
              <th>{labels.unit}</th>
              <th>{labels.status}</th>
              <th>{labels.referenceRange}</th>
              <th>{labels.sourceRecord}</th>
              <th>{labels.sourceId}</th>
            </tr>
          </thead>
          <tbody>
            {model.observations.map(observation => (
              <tr key={observation.id}>
                <td>{observation.date}</td>
                <td>{observation.displayValue}</td>
                <td>{observation.unit}</td>
                <td>{observation.status}</td>
                <td>{observation.referenceRange}</td>
                <td>{observation.sourceName}</td>
                <td>{observation.sourceId}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="health-metric-print-disclaimer">{labels.disclaimer}</p>
      </section>
    </>
  );
};

export default HealthMetricExportActions;
