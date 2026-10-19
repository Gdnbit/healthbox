export type HealthDatePreset =
  | 'all'
  | '3months'
  | '6months'
  | 'year'
  | '2years'
  | '5years'
  | 'custom';

export interface HealthDateWindow {
  dateFrom: string;
  dateTo: string;
}

export type HealthDateWindowError = 'invalid_format' | 'reversed';

export interface HealthDateWindowLabels {
  all: string;
  both: (_dateFrom: string, _dateTo: string) => string;
  from: (_dateFrom: string) => string;
  to: (_dateTo: string) => string;
}

export interface HealthDateTimeBounds {
  startDate?: string;
  endDate?: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const formatLocalCalendarDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isValidIsoCalendarDate = (value: string): boolean => {
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const subtractCalendarMonths = (value: Date, months: number): Date => {
  const result = new Date(value);
  const originalDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() - months);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(originalDay, lastDay));
  return result;
};

const subtractCalendarYears = (value: Date, years: number): Date => {
  const result = new Date(value);
  const month = result.getMonth();
  const day = result.getDate();
  result.setDate(1);
  result.setFullYear(result.getFullYear() - years);
  result.setMonth(month);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
};

export const resolveHealthDatePreset = (
  preset: HealthDatePreset,
  today = new Date()
): HealthDateWindow => {
  if (preset === 'all' || preset === 'custom') {
    return { dateFrom: '', dateTo: '' };
  }

  let dateFrom: Date;
  if (preset === '3months') dateFrom = subtractCalendarMonths(today, 3);
  else if (preset === '6months') dateFrom = subtractCalendarMonths(today, 6);
  else if (preset === 'year') dateFrom = subtractCalendarYears(today, 1);
  else if (preset === '2years') dateFrom = subtractCalendarYears(today, 2);
  else dateFrom = subtractCalendarYears(today, 5);

  return {
    dateFrom: formatLocalCalendarDate(dateFrom),
    dateTo: formatLocalCalendarDate(today),
  };
};

export const validateHealthDateWindow = ({
  dateFrom,
  dateTo,
}: HealthDateWindow): HealthDateWindowError | null => {
  if (
    (dateFrom && !isValidIsoCalendarDate(dateFrom)) ||
    (dateTo && !isValidIsoCalendarDate(dateTo))
  ) {
    return 'invalid_format';
  }
  if (dateFrom && dateTo && dateFrom > dateTo) return 'reversed';
  return null;
};

const localCalendarBoundary = (
  value: string,
  boundary: 'start' | 'end'
): string => {
  const match = ISO_DATE.exec(value);
  if (!match || !isValidIsoCalendarDate(value)) {
    throw new Error(`Invalid ISO calendar date: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date =
    boundary === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day + 1, 0, 0, 0, 0);

  if (boundary === 'end') date.setMilliseconds(date.getMilliseconds() - 1);
  return date.toISOString();
};

export const toLocalCalendarUtcBounds = ({
  dateFrom,
  dateTo,
}: HealthDateWindow): HealthDateTimeBounds => ({
  startDate: dateFrom ? localCalendarBoundary(dateFrom, 'start') : undefined,
  endDate: dateTo ? localCalendarBoundary(dateTo, 'end') : undefined,
});

export const formatHealthDateWindowLabel = (
  { dateFrom, dateTo }: HealthDateWindow,
  labels: HealthDateWindowLabels
): string => {
  if (dateFrom && dateTo) return labels.both(dateFrom, dateTo);
  if (dateFrom) return labels.from(dateFrom);
  if (dateTo) return labels.to(dateTo);
  return labels.all;
};
