import type { LabTestComponentForStack } from '../services/api/labTestComponentApi';
import {
  getClinicalDate,
  getMetricDisplayName,
  getNormalizedMetricKey,
  getNormalizedUnit,
} from './householdHealthDashboard';

export type HealthExamEpisodeKind = 'source_document' | 'lab_result';

export interface HealthExamEpisode {
  key: string;
  kind: HealthExamEpisodeKind;
  numericId: number;
  displayDate: string | null;
  recordDates: string[];
  hasDateConflict: boolean;
  sourceDocumentId: number | null;
  labResultIds: number[];
  componentIds: number[];
  components: LabTestComponentForStack[];
}

export type HealthExamComparisonState =
  | 'comparable_numeric'
  | 'comparable_text'
  | 'baseline_missing'
  | 'target_missing'
  | 'multiple_records'
  | 'incompatible_unit'
  | 'incompatible_result';

export interface HealthExamComparisonValue {
  components: LabTestComponentForStack[];
  displayValue: string | null;
  unit: string | null;
}

export interface HealthExamComparisonRow {
  metricKey: string;
  metricName: string;
  baseline: HealthExamComparisonValue;
  target: HealthExamComparisonValue;
  state: HealthExamComparisonState;
  absoluteDelta: number | null;
}

export type HealthExamSelectionError =
  | 'target_not_found'
  | 'baseline_not_found'
  | 'same_episode'
  | 'baseline_not_earlier';

export interface HealthExamComparison {
  episodes: HealthExamEpisode[];
  target: HealthExamEpisode | null;
  baseline: HealthExamEpisode | null;
  rows: HealthExamComparisonRow[];
  selectionError: HealthExamSelectionError | null;
}

const positiveInteger = (value?: number | null) =>
  Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;

const getEpisodeIdentity = (component: LabTestComponentForStack) => {
  const sourceDocumentId = positiveInteger(component.source_document_id);
  if (sourceDocumentId) {
    return {
      key: `source:${sourceDocumentId}`,
      kind: 'source_document' as const,
      numericId: sourceDocumentId,
      sourceDocumentId,
    };
  }

  return {
    key: `lab:${component.lab_result_id}`,
    kind: 'lab_result' as const,
    numericId: component.lab_result_id,
    sourceDocumentId: null,
  };
};

const sortUniqueNumbers = (values: number[]) =>
  Array.from(new Set(values)).sort((left, right) => left - right);

const compareEpisodesNewestFirst = (
  left: HealthExamEpisode,
  right: HealthExamEpisode
) => {
  if (left.displayDate !== right.displayDate) {
    if (!left.displayDate) return 1;
    if (!right.displayDate) return -1;
    return right.displayDate.localeCompare(left.displayDate);
  }
  if (left.kind !== right.kind) {
    return left.kind === 'source_document' ? -1 : 1;
  }
  return right.numericId - left.numericId;
};

export const buildHealthExamEpisodes = (
  components: LabTestComponentForStack[]
): HealthExamEpisode[] => {
  const groups = new Map<string, LabTestComponentForStack[]>();

  components.forEach(component => {
    const identity = getEpisodeIdentity(component);
    groups.set(identity.key, [...(groups.get(identity.key) || []), component]);
  });

  return Array.from(groups.entries())
    .map(([key, episodeComponents]) => {
      const identity = getEpisodeIdentity(episodeComponents[0]);
      const recordDates = Array.from(
        new Set(
          episodeComponents
            .map(getClinicalDate)
            .filter((date): date is string => Boolean(date))
        )
      ).sort();

      return {
        key,
        kind: identity.kind,
        numericId: identity.numericId,
        displayDate: recordDates.at(-1) || null,
        recordDates,
        hasDateConflict: recordDates.length > 1,
        sourceDocumentId: identity.sourceDocumentId,
        labResultIds: sortUniqueNumbers(
          episodeComponents.map(component => component.lab_result_id)
        ),
        componentIds: sortUniqueNumbers(
          episodeComponents
            .map(component => positiveInteger(component.id))
            .filter((id): id is number => id !== null)
        ),
        components: [...episodeComponents],
      } satisfies HealthExamEpisode;
    })
    .sort(compareEpisodesNewestFirst);
};

const getTextValue = (component: LabTestComponentForStack) =>
  component.qualitative_value?.trim() ||
  component.textual_value?.trim() ||
  null;

const getDisplayValue = (components: LabTestComponentForStack[]) => {
  if (components.length !== 1) return null;
  const component = components[0];
  if (typeof component.value === 'number' && Number.isFinite(component.value)) {
    return String(component.value);
  }
  return getTextValue(component);
};

const toComparisonValue = (
  components: LabTestComponentForStack[]
): HealthExamComparisonValue => ({
  components,
  displayValue: getDisplayValue(components),
  unit:
    components.length === 1 && components[0].unit?.trim()
      ? components[0].unit!.trim()
      : null,
});

const stableDelta = (target: number, baseline: number) =>
  Number((target - baseline).toPrecision(12));

const buildComparisonRow = (
  metricKey: string,
  metricName: string,
  baselineComponents: LabTestComponentForStack[],
  targetComponents: LabTestComponentForStack[]
): HealthExamComparisonRow => {
  const baseline = toComparisonValue(baselineComponents);
  const target = toComparisonValue(targetComponents);
  const base = {
    metricKey,
    metricName,
    baseline,
    target,
    absoluteDelta: null,
  };

  if (baselineComponents.length === 0) {
    return { ...base, state: 'baseline_missing' };
  }
  if (targetComponents.length === 0) {
    return { ...base, state: 'target_missing' };
  }
  if (baselineComponents.length !== 1 || targetComponents.length !== 1) {
    return { ...base, state: 'multiple_records' };
  }

  const baselineComponent = baselineComponents[0];
  const targetComponent = targetComponents[0];
  const baselineIsNumber =
    typeof baselineComponent.value === 'number' &&
    Number.isFinite(baselineComponent.value);
  const targetIsNumber =
    typeof targetComponent.value === 'number' &&
    Number.isFinite(targetComponent.value);

  if (baselineIsNumber && targetIsNumber) {
    const baselineUnit = getNormalizedUnit(baselineComponent.unit);
    const targetUnit = getNormalizedUnit(targetComponent.unit);
    if (!baselineUnit || !targetUnit || baselineUnit !== targetUnit) {
      return { ...base, state: 'incompatible_unit' };
    }
    return {
      ...base,
      state: 'comparable_numeric',
      absoluteDelta: stableDelta(
        targetComponent.value as number,
        baselineComponent.value as number
      ),
    };
  }

  const baselineText = getTextValue(baselineComponent);
  const targetText = getTextValue(targetComponent);
  if (baselineText && targetText) {
    return { ...base, state: 'comparable_text' };
  }

  return { ...base, state: 'incompatible_result' };
};

const buildRows = (
  baseline: HealthExamEpisode,
  target: HealthExamEpisode
): HealthExamComparisonRow[] => {
  const metricNames = new Map<string, string>();
  const byMetric = (components: LabTestComponentForStack[]) => {
    const result = new Map<string, LabTestComponentForStack[]>();
    components.forEach(component => {
      const key = getNormalizedMetricKey(component);
      metricNames.set(key, getMetricDisplayName(component));
      result.set(key, [...(result.get(key) || []), component]);
    });
    return result;
  };
  const baselineMetrics = byMetric(baseline.components);
  const targetMetrics = byMetric(target.components);
  const metricKeys = Array.from(
    new Set([...baselineMetrics.keys(), ...targetMetrics.keys()])
  ).sort((left, right) =>
    (metricNames.get(left) || left).localeCompare(
      metricNames.get(right) || right
    )
  );

  return metricKeys.map(metricKey =>
    buildComparisonRow(
      metricKey,
      metricNames.get(metricKey) || metricKey,
      baselineMetrics.get(metricKey) || [],
      targetMetrics.get(metricKey) || []
    )
  );
};

export const buildHealthExamComparison = (
  components: LabTestComponentForStack[],
  targetKey?: string | null,
  baselineKey?: string | null
): HealthExamComparison => {
  const episodes = buildHealthExamEpisodes(components);
  const datedEpisodes = episodes.filter(episode => episode.displayDate);
  const defaultTarget = datedEpisodes[0] || null;
  const defaultBaseline =
    datedEpisodes.find(
      episode =>
        defaultTarget?.displayDate &&
        episode.displayDate! < defaultTarget.displayDate
    ) || null;
  let target = defaultTarget;
  let baseline = defaultBaseline;
  let selectionError: HealthExamSelectionError | null = null;

  if (targetKey) {
    const requestedTarget = episodes.find(episode => episode.key === targetKey);
    if (requestedTarget?.displayDate) target = requestedTarget;
    else selectionError = 'target_not_found';
  }

  if (baselineKey) {
    const requestedBaseline = episodes.find(
      episode => episode.key === baselineKey
    );
    if (requestedBaseline?.displayDate) baseline = requestedBaseline;
    else selectionError ||= 'baseline_not_found';
  }

  if (target && baseline) {
    if (target.key === baseline.key) {
      selectionError ||= 'same_episode';
      target = defaultTarget;
      baseline = defaultBaseline;
    } else {
      if (baseline.displayDate! >= target.displayDate!) {
        selectionError ||= 'baseline_not_earlier';
        target = defaultTarget;
        baseline = defaultBaseline;
      }
    }
  }

  return {
    episodes,
    target,
    baseline,
    rows: target && baseline ? buildRows(baseline, target) : [],
    selectionError,
  };
};
