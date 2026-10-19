import { describe, expect, it } from 'vitest';
import contextCases from '../../../evals/visualization-context/cases/context-cases.json';
import {
  resolveHealthDatePreset,
  toLocalCalendarUtcBounds,
  validateHealthDateWindow,
} from './healthDateWindow';

describe('health date window', () => {
  it('resolves relative presets with local calendar dates', () => {
    const today = new Date(2026, 6, 22, 12, 0, 0);

    expect(resolveHealthDatePreset('3months', today)).toEqual({
      dateFrom: contextCases.date_windows[0].expected_from,
      dateTo: contextCases.date_windows[0].expected_to,
    });
    expect(resolveHealthDatePreset('all', today)).toEqual({
      dateFrom: '',
      dateTo: '',
    });
  });

  it('clamps month subtraction instead of rolling into another month', () => {
    expect(
      resolveHealthDatePreset('3months', new Date(2025, 4, 31, 12))
    ).toEqual({
      dateFrom: '2025-02-28',
      dateTo: '2025-05-31',
    });
  });

  it('accepts inclusive one-sided and two-sided ISO calendar dates', () => {
    expect(
      validateHealthDateWindow({
        dateFrom: '2025-01-01',
        dateTo: '2025-12-31',
      })
    ).toBeNull();
    expect(
      validateHealthDateWindow({ dateFrom: '2025-01-01', dateTo: '' })
    ).toBeNull();
    expect(validateHealthDateWindow({ dateFrom: '', dateTo: '' })).toBeNull();
  });

  it('rejects impossible dates and reversed windows', () => {
    expect(
      validateHealthDateWindow({ dateFrom: '2025-02-30', dateTo: '' })
    ).toBe('invalid_format');
    expect(
      validateHealthDateWindow({
        dateFrom: '2025-12-31',
        dateTo: '2025-01-01',
      })
    ).toBe('reversed');
  });

  it('converts inclusive local calendar days into UTC query boundaries', () => {
    const bounds = toLocalCalendarUtcBounds({
      dateFrom: '2025-01-01',
      dateTo: '2025-12-31',
    });
    const start = new Date(bounds.startDate as string);
    const end = new Date(bounds.endDate as string);

    expect([
      start.getFullYear(),
      start.getMonth() + 1,
      start.getDate(),
      start.getHours(),
    ]).toEqual([2025, 1, 1, 0]);
    expect([
      end.getFullYear(),
      end.getMonth() + 1,
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
      end.getSeconds(),
      end.getMilliseconds(),
    ]).toEqual([2025, 12, 31, 23, 59, 59, 999]);
  });
});
