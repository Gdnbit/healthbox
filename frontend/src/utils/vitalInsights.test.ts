import { describe, expect, it } from 'vitest';
import {
  buildVitalCatalog,
  formatVitalCatalogValue,
  type VitalRecordLike,
} from './vitalInsights';

const records: VitalRecordLike[] = [
  {
    id: 1,
    recorded_date: '2026-01-01T08:00:00Z',
    systolic_bp: 118,
    diastolic_bp: 76,
    weight: 150,
  },
  {
    id: 2,
    recorded_date: '2026-02-01T08:00:00Z',
    systolic_bp: 121,
    diastolic_bp: 79,
    heart_rate: 70,
    temperature: 98.6,
    weight: 152,
  },
  {
    id: 3,
    recorded_date: '2026-03-01T08:00:00Z',
    heart_rate: null,
    oxygen_saturation: 98,
  },
];

describe('vital insights catalog', () => {
  it('reconciles row counts, available types, latest values and dates', () => {
    const summary = buildVitalCatalog(records);

    expect(summary.loadedRecordCount).toBe(3);
    expect(summary.availableTypeCount).toBe(5);
    expect(summary.trendTypeCount).toBe(2);
    expect(summary.latestDate).toBe('2026-03-01T08:00:00Z');

    expect(
      summary.entries.find(entry => entry.type === 'blood_pressure')
    ).toMatchObject({
      count: 2,
      latestRecordId: 2,
      primaryValue: 121,
      secondaryValue: 79,
    });
    expect(
      summary.entries.find(entry => entry.type === 'heart_rate')?.count
    ).toBe(1);
  });

  it('keeps dual blood-pressure values in one catalog entry', () => {
    const entry = buildVitalCatalog(records).entries.find(
      candidate => candidate.type === 'blood_pressure'
    );
    expect(entry).toBeDefined();
    expect(formatVitalCatalogValue(entry!, 'metric')).toEqual({
      value: '121/79',
      unit: 'mmHg',
    });
  });

  it('converts display units without mutating stored records', () => {
    const input = structuredClone(records);
    const entries = buildVitalCatalog(input).entries;
    const weight = entries.find(entry => entry.type === 'weight');
    const temperature = entries.find(entry => entry.type === 'temperature');

    expect(formatVitalCatalogValue(weight!, 'metric')).toEqual({
      value: '68.9',
      unit: 'kg',
    });
    expect(formatVitalCatalogValue(temperature!, 'metric')).toEqual({
      value: '37',
      unit: '°C',
    });
    expect(input).toEqual(records);
  });

  it('excludes empty and non-finite fields from type counts', () => {
    const summary = buildVitalCatalog([
      {
        id: 4,
        recorded_date: 'not-a-date',
        heart_rate: Number.NaN,
        a1c: null,
      },
    ]);

    expect(summary.availableTypeCount).toBe(0);
    expect(summary.latestDate).toBeNull();
  });
});
