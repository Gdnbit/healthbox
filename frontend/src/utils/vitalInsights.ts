import { convertForDisplay, unitLabels } from './unitConversion';
import type { VitalType } from '../components/medical/vitals/types';

export type VitalInsightType = Exclude<VitalType, 'bmi'>;
export type UnitSystem = 'imperial' | 'metric';

export interface VitalRecordLike {
  id: number;
  recorded_date: string;
  systolic_bp?: number | null;
  diastolic_bp?: number | null;
  heart_rate?: number | null;
  temperature?: number | null;
  weight?: number | null;
  oxygen_saturation?: number | null;
  respiratory_rate?: number | null;
  blood_glucose?: number | null;
  a1c?: number | null;
}

export interface VitalCatalogEntry {
  type: VitalInsightType;
  count: number;
  latestDate: string;
  latestRecordId: number;
  primaryValue: number;
  secondaryValue: number | null;
}

export interface VitalCatalogSummary {
  loadedRecordCount: number;
  availableTypeCount: number;
  trendTypeCount: number;
  latestDate: string | null;
  entries: VitalCatalogEntry[];
}

interface VitalDefinition {
  type: VitalInsightType;
  primaryField: keyof VitalRecordLike;
  secondaryField?: keyof VitalRecordLike;
}

const DEFINITIONS: VitalDefinition[] = [
  {
    type: 'blood_pressure',
    primaryField: 'systolic_bp',
    secondaryField: 'diastolic_bp',
  },
  { type: 'heart_rate', primaryField: 'heart_rate' },
  { type: 'temperature', primaryField: 'temperature' },
  { type: 'weight', primaryField: 'weight' },
  { type: 'oxygen_saturation', primaryField: 'oxygen_saturation' },
  { type: 'respiratory_rate', primaryField: 'respiratory_rate' },
  { type: 'blood_glucose', primaryField: 'blood_glucose' },
  { type: 'a1c', primaryField: 'a1c' },
];

const asFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const timestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const latestRecordedDate = (records: VitalRecordLike[]): string | null => {
  const dated = records
    .filter(record => Number.isFinite(timestamp(record.recorded_date)))
    .sort((a, b) => timestamp(b.recorded_date) - timestamp(a.recorded_date));
  return dated[0]?.recorded_date || null;
};

export const buildVitalCatalog = (
  records: VitalRecordLike[]
): VitalCatalogSummary => {
  const entries = DEFINITIONS.flatMap(definition => {
    const matching = records
      .map(record => ({
        record,
        primaryValue: asFiniteNumber(record[definition.primaryField]),
      }))
      .filter(
        (
          candidate
        ): candidate is {
          record: VitalRecordLike;
          primaryValue: number;
        } => candidate.primaryValue !== null
      )
      .sort(
        (a, b) =>
          timestamp(b.record.recorded_date) - timestamp(a.record.recorded_date)
      );

    const latest = matching[0];
    if (!latest) return [];

    const secondaryValue = definition.secondaryField
      ? asFiniteNumber(latest.record[definition.secondaryField])
      : null;

    return [
      {
        type: definition.type,
        count: matching.length,
        latestDate: latest.record.recorded_date,
        latestRecordId: latest.record.id,
        primaryValue: latest.primaryValue,
        secondaryValue,
      } satisfies VitalCatalogEntry,
    ];
  });

  return {
    loadedRecordCount: records.length,
    availableTypeCount: entries.length,
    trendTypeCount: entries.filter(entry => entry.count >= 2).length,
    latestDate: latestRecordedDate(records),
    entries,
  };
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

export const formatVitalCatalogValue = (
  entry: VitalCatalogEntry,
  unitSystem: UnitSystem
): { value: string; unit: string } => {
  if (entry.type === 'blood_pressure') {
    return {
      value: `${formatNumber(entry.primaryValue)}/${
        entry.secondaryValue === null ? '—' : formatNumber(entry.secondaryValue)
      }`,
      unit: 'mmHg',
    };
  }

  if (entry.type === 'temperature' || entry.type === 'weight') {
    const converted = convertForDisplay(
      entry.primaryValue,
      entry.type,
      unitSystem
    );
    return {
      value: converted === null ? '—' : formatNumber(converted),
      unit: unitLabels[unitSystem][entry.type],
    };
  }

  const units: Record<
    Exclude<VitalInsightType, 'blood_pressure' | 'temperature' | 'weight'>,
    string
  > = {
    heart_rate: 'BPM',
    oxygen_saturation: '%',
    respiratory_rate: '/min',
    blood_glucose: 'mg/dL',
    a1c: '%',
  };

  return {
    value: formatNumber(entry.primaryValue),
    unit: units[entry.type],
  };
};
