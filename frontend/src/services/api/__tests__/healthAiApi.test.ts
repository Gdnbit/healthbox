import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService } from '../index';
import healthAiApi from '../healthAiApi';

vi.mock('../index', () => ({
  apiService: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('healthAiApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads owner-only capability without putting health scope in the URL', async () => {
    vi.mocked(apiService.get).mockResolvedValue({ available: false });

    await healthAiApi.getCapabilities(7);

    expect(apiService.get).toHaveBeenCalledWith(
      '/health-ai/subjects/7/capabilities',
      { signal: undefined }
    );
  });

  it('sends only record identifiers and scope, never client health values', async () => {
    vi.mocked(apiService.post).mockResolvedValue({ status: 'answered' });

    await healthAiApi.askQuestion(
      7,
      {
        question_id: 'recent_changes',
        question: '最近有哪些变化？',
        range: '5y',
        record_ids: ['lab:9', 'vital:weight:4'],
      },
      '00000000-0000-4000-8000-000000000001'
    );

    expect(apiService.post).toHaveBeenCalledWith(
      '/health-ai/subjects/7/questions',
      {
        question_id: 'recent_changes',
        question: '最近有哪些变化？',
        range: '5y',
        record_ids: ['lab:9', 'vital:weight:4'],
      },
      {
        headers: {
          'Idempotency-Key': '00000000-0000-4000-8000-000000000001',
        },
      }
    );
    expect(JSON.stringify(vi.mocked(apiService.post).mock.calls)).not.toContain(
      'value'
    );
  });

  it('lists, opens, and deletes saved answers inside the owner subject path', async () => {
    vi.mocked(apiService.get).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(apiService.delete).mockResolvedValue({
      status: 'deleted',
      answer_id: 12,
    });

    await healthAiApi.listAnswers(7);
    await healthAiApi.getAnswer(7, 12);
    await healthAiApi.deleteAnswer(7, 12);

    expect(apiService.get).toHaveBeenNthCalledWith(
      1,
      '/health-ai/subjects/7/answers',
      { params: { limit: 20, offset: 0 }, signal: undefined }
    );
    expect(apiService.get).toHaveBeenNthCalledWith(
      2,
      '/health-ai/subjects/7/answers/12',
      { signal: undefined }
    );
    expect(apiService.delete).toHaveBeenCalledWith(
      '/health-ai/subjects/7/answers/12'
    );
  });
});
