import { describe, expect, it } from 'vitest';
import type { HouseholdHealthReport } from './types';
import {
  buildHouseholdReportFilterOptions,
  filterHouseholdHealthReports,
} from './householdReportFilters';

const reports: HouseholdHealthReport[] = [
  {
    id: 'source:1',
    sourceDocumentId: 1,
    title: '年度体检报告',
    originalFilename: 'ANNUAL-CHECKUP-2026.PDF',
    date: '2026-06-18',
    facility: '城市健康体检中心',
    typeLabel: '体检报告',
    statusLabel: '已完成复核',
    sizeLabel: '8 页',
    mimeType: 'application/pdf',
  },
  {
    id: 'source:2',
    sourceDocumentId: 2,
    title: '血常规与生化检查',
    originalFilename: 'blood-tests-2025.pdf',
    date: '2025-05-22',
    facility: '市第一医院',
    typeLabel: '检验报告',
    statusLabel: '已完成复核',
    sizeLabel: '4 页',
    mimeType: 'application/pdf',
  },
  {
    id: 'source:3',
    sourceDocumentId: 3,
    title: '基础状态记录',
    originalFilename: 'baseline-status-2024.pdf',
    date: '2024-11-03',
    facility: '本人补充',
    typeLabel: '健康资料',
    statusLabel: '已保存原件',
    sizeLabel: '7 页',
    mimeType: 'application/pdf',
  },
];

describe('household report filters', () => {
  it('searches all useful report metadata without case sensitivity', () => {
    expect(
      filterHouseholdHealthReports(reports, {
        query: 'annual-checkup',
        status: '',
        type: '',
        year: '',
      }).map(report => report.id)
    ).toEqual(['source:1']);

    expect(
      filterHouseholdHealthReports(reports, {
        query: '市第一医院',
        status: '',
        type: '',
        year: '',
      }).map(report => report.id)
    ).toEqual(['source:2']);
  });

  it('combines status, type and year filters and builds stable options', () => {
    expect(
      filterHouseholdHealthReports(reports, {
        query: '',
        status: '已完成复核',
        type: '检验报告',
        year: '2025',
      }).map(report => report.id)
    ).toEqual(['source:2']);

    expect(buildHouseholdReportFilterOptions(reports)).toEqual({
      statuses: ['已完成复核', '已保存原件'],
      types: ['体检报告', '检验报告', '健康资料'],
      years: ['2026', '2025', '2024'],
    });
  });
});
