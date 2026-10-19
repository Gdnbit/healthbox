import { DATE_FORMAT_OPTIONS } from '../utils/constants';

export type DateFormatValue = string | number | Date | null | undefined;

export interface DateFormatOptions {
  includeTime?: boolean;
  timezone?: string;
}

export interface DateTimeFormatOptions {
  timezone?: string;
  includeTimezone?: boolean;
  displayLocale?: string | null;
}

export interface UseDateFormatResult {
  formatDate: (
    dateValue: DateFormatValue,
    options?: DateFormatOptions
  ) => string;
  formatDateWithTime: (
    dateValue: DateFormatValue,
    options?: DateFormatOptions
  ) => string;
  formatDateTime: (
    dateValue: DateFormatValue,
    options?: DateTimeFormatOptions
  ) => string;
  formatLongDate: (dateValue: DateFormatValue, longMonth?: boolean) => string;
  formatDateTimeInput: (
    dateValue: Date | null | undefined,
    includeSeconds?: boolean
  ) => string;
  dateFormat: string;
  dateInputFormat: string;
  dateParser: (value: string) => Date | null;
  locale: string;
  formatLabel: string;
  formatExample: string;
  dateTimePlaceholder: string;
  formatOptions: typeof DATE_FORMAT_OPTIONS;
}

export function useDateFormat(): UseDateFormatResult;

export default useDateFormat;
