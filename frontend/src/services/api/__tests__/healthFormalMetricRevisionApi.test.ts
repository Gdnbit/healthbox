import { afterEach, describe, expect, it, vi } from 'vitest';
import healthImportApi from '../healthImportApi';
import { apiService } from '../index';

describe('formal metric revision API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads append-only history and creates a bound revision request', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue({});
    const postSpy = vi.spyOn(apiService, 'post').mockResolvedValue({});
    const signal = new AbortController().signal;
    const request = {
      expected_current_revision_id: 91,
      idempotency_key: 'synthetic-browser-revision-0001',
      reason: '修正自动识别时的小数点错误',
      result: {
        result_type: 'quantitative' as const,
        numeric_value: 13.2,
        qualitative_value: null,
        textual_value: null,
        unit: 'unit/L',
        ref_range_min: 10,
        ref_range_max: 15,
        ref_range_text: null,
        result_status: 'normal',
      },
    };

    await healthImportApi.listFormalMetricRevisions(31, signal);
    await healthImportApi.reviseFormalMetric(31, request);

    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/components/31/revisions',
      { signal }
    );
    expect(postSpy).toHaveBeenCalledWith(
      '/health-imports/components/31/revisions',
      request
    );
  });
});
