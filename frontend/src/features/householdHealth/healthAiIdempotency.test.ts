import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealthAiQuestionInput } from '../../services/api/healthAiApi';
import {
  acquireHealthAiIdempotency,
  shouldRetainHealthAiIdempotency,
} from './healthAiIdempotency';

const request: HealthAiQuestionInput = {
  question_id: 'custom',
  question: '不要把这段健康问题写进浏览器存储：血糖 9.9',
  range: '5y',
  record_ids: ['private-record-123'],
};

describe('health AI browser idempotency registry', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.mocked(localStorage.getItem).mockImplementation(
      key => values.get(key) ?? null
    );
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      values.set(key, value);
    });
    vi.mocked(localStorage.removeItem).mockImplementation(key => {
      values.delete(key);
    });
    vi.mocked(localStorage.clear).mockImplementation(() => {
      values.clear();
    });
  });

  it('converges concurrent empty-registry acquisition on one UUIDv4', async () => {
    const [first, second] = await Promise.all([
      acquireHealthAiIdempotency(1, 7, request),
      acquireHealthAiIdempotency(1, 7, request),
    ]);

    expect(second.key).toBe(first.key);
    expect(first.key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('persists only hashes, UUIDs, versions and timestamps', async () => {
    await acquireHealthAiIdempotency(1, 7, request);

    const persisted = vi
      .mocked(localStorage.setItem)
      .mock.calls.flat()
      .join('|');
    expect(persisted).not.toContain(request.question);
    expect(persisted).not.toContain('血糖');
    expect(persisted).not.toContain('9.9');
    expect(persisted).not.toContain('private-record-123');
    expect(persisted).toMatch(/[0-9a-f]{64}/);
  });

  it('survives a module reload and rotates only after a terminal outcome', async () => {
    const first = await acquireHealthAiIdempotency(1, 7, request);
    vi.resetModules();
    const refreshedModule = await import('./healthAiIdempotency');
    const afterRefresh = await refreshedModule.acquireHealthAiIdempotency(
      1,
      7,
      request
    );
    expect(afterRefresh.key).toBe(first.key);

    await refreshedModule.completeHealthAiIdempotency(first);
    const nextOperation = await refreshedModule.acquireHealthAiIdempotency(
      1,
      7,
      request
    );
    expect(nextOperation.key).not.toBe(first.key);
  });
});

describe('health AI unknown-result classification', () => {
  it.each([
    [502, undefined],
    [503, undefined],
    [504, undefined],
    [409, 'health_ai_request_in_progress'],
    [409, 'health_ai_request_already_completed'],
  ])('retains status %s with code %s', (status, code) => {
    expect(shouldRetainHealthAiIdempotency({ status, code })).toBe(true);
  });

  it.each([
    [502, 'health_ai_provider_failed'],
    [503, 'health_ai_request_abandoned'],
    [429, 'health_ai_rate_limit_exceeded'],
    [400, 'health_ai_invalid_question'],
  ])('clears terminal status %s with code %s', (status, code) => {
    expect(shouldRetainHealthAiIdempotency({ status, code })).toBe(false);
  });
});
