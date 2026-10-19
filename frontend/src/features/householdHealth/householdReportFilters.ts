import type { HouseholdHealthReport } from './types';

export interface HouseholdReportFilters {
  query: string;
  status: string;
  type: string;
  year: string;
}

export interface HouseholdReportFilterOptions {
  statuses: string[];
  types: string[];
  years: string[];
}

const normalized = (value: string): string =>
  value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');

const reportYear = (report: HouseholdHealthReport): string => {
  const match = /^(\d{4})/u.exec(report.date.trim());
  return match?.[1] ?? '';
};

const uniqueInSourceOrder = (values: string[]): string[] => [
  ...new Set(values.map(value => value.trim()).filter(Boolean)),
];

export const buildHouseholdReportFilterOptions = (
  reports: HouseholdHealthReport[]
): HouseholdReportFilterOptions => ({
  statuses: uniqueInSourceOrder(reports.map(report => report.statusLabel)),
  types: uniqueInSourceOrder(reports.map(report => report.typeLabel)),
  years: [...new Set(reports.map(reportYear).filter(Boolean))].sort((a, b) =>
    b.localeCompare(a)
  ),
});

export const filterHouseholdHealthReports = (
  reports: HouseholdHealthReport[],
  filters: HouseholdReportFilters
): HouseholdHealthReport[] => {
  const query = normalized(filters.query);

  return reports.filter(report => {
    const searchable = normalized(
      [
        report.title,
        report.originalFilename,
        report.date,
        report.facility,
        report.typeLabel,
        report.statusLabel,
      ].join(' ')
    );

    return (
      (!query || searchable.includes(query)) &&
      (!filters.status || report.statusLabel === filters.status) &&
      (!filters.type || report.typeLabel === filters.type) &&
      (!filters.year || reportYear(report) === filters.year)
    );
  });
};
