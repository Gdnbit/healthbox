import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { authService } from './simpleAuthService';

describe('simpleAuthService same-origin cookie flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the same-origin API path for login instead of a direct backend URL', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await authService.makeRequest('/auth/login', {
      method: 'POST',
      body: new URLSearchParams({ username: 'member' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      })
    );
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  });

  it('keeps MFA verification on the same cookie origin', async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockResolvedValue({
        access_token: 'invalid-test-token',
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await authService.verifyAdminMfa('challenge', '123456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/mfa/verify',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      })
    );
  });

  it('aborts the underlying request when the auth timeout expires', async () => {
    vi.useFakeTimers();
    let capturedSignal;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_url, options) => {
        capturedSignal = options.signal;
        return new Promise((_, reject) => {
          options.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
      });
    vi.stubGlobal('fetch', fetchMock);

    const request = authService.makeRequest('/auth/login', { method: 'POST' });
    const rejection = expect(request).rejects.toThrow(
      'Authentication API request failed. Last error: Request timeout'
    );
    await vi.advanceTimersByTimeAsync(15000);

    await rejection;
    expect(capturedSignal.aborted).toBe(true);
  });
});
