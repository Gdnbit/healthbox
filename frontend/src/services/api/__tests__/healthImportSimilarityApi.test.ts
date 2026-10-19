import { afterEach, describe, expect, it, vi } from 'vitest';
import healthImportApi from '../healthImportApi';
import { apiService } from '../index';

describe('health source similarity API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists owner-only pending relationships and reviews one decision', async () => {
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue([]);
    const postSpy = vi.spyOn(apiService, 'post').mockResolvedValue({});
    const signal = new AbortController().signal;

    await healthImportApi.listSourceSimilarityRelations(22, signal, 'pending');
    await healthImportApi.reviewSourceSimilarityRelation(41, 'confirmed');

    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/patients/22/source-similarity-relations',
      {
        signal,
        params: { review_status: 'pending', limit: 50 },
      }
    );
    expect(postSpy).toHaveBeenCalledWith(
      '/health-imports/source-similarity-relations/41/review',
      { decision: 'confirmed' }
    );
  });

  it('loads a transient owner-only thumbnail as a blob', async () => {
    const blob = new Blob(['synthetic image'], { type: 'image/jpeg' });
    const getSpy = vi.spyOn(apiService, 'get').mockResolvedValue(blob);
    const signal = new AbortController().signal;

    await healthImportApi.thumbnailSourceDocument(51, signal);

    expect(getSpy).toHaveBeenCalledWith(
      '/health-imports/source-documents/51/thumbnail',
      {
        responseType: 'blob',
        signal,
      }
    );
  });
});
