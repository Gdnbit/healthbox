import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiService } from '../index';
import logger from '../../logger.js';

vi.mock('../../logger.js', () => ({
  default: {
    apiError: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

class FakeXMLHttpRequest {
  static latest = null;
  static instances = [];

  constructor() {
    FakeXMLHttpRequest.latest = this;
    FakeXMLHttpRequest.instances.push(this);
    this.upload = {};
    this.headers = {};
    this.status = 0;
    this.statusText = '';
    this.response = null;
    this.responseText = '';
    this.withCredentials = false;
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }

  getResponseHeader(name) {
    return name.toLowerCase() === 'content-type' ? 'application/json' : null;
  }

  send(body) {
    this.body = body;
  }

  abort() {
    this.onabort?.();
  }

  emitProgress(loaded, total) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    });
  }

  succeed(payload) {
    this.status = 200;
    this.statusText = 'OK';
    this.responseText = JSON.stringify(payload);
    this.onload?.();
  }

  fail(status, payload) {
    this.status = status;
    this.statusText = 'Request failed';
    this.responseText = JSON.stringify(payload);
    this.onload?.();
  }
}

describe('apiService upload progress transport', () => {
  const originalXMLHttpRequest = globalThis.XMLHttpRequest;
  let originalBaseUrl;
  let originalFallbackUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    originalBaseUrl = apiService.baseURL;
    originalFallbackUrl = apiService.fallbackURL;
    apiService.baseURL = 'https://health.example.test/api/v1';
    apiService.fallbackURL = apiService.baseURL;
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
  });

  afterEach(() => {
    apiService.baseURL = originalBaseUrl;
    apiService.fallbackURL = originalFallbackUrl;
    globalThis.XMLHttpRequest = originalXMLHttpRequest;
    vi.unstubAllGlobals();
    FakeXMLHttpRequest.latest = null;
    FakeXMLHttpRequest.instances = [];
  });

  it('uses XMLHttpRequest and reports uploaded bytes and percentage', async () => {
    const onUploadProgress = vi.fn();
    const formData = new FormData();
    formData.append(
      'file',
      new File(['synthetic'], 'report.pdf', { type: 'application/pdf' })
    );

    const request = apiService.post(
      '/health-imports/source-documents',
      formData,
      {
        onUploadProgress,
      }
    );
    const xhr = FakeXMLHttpRequest.latest;

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(
      'https://health.example.test/api/v1/health-imports/source-documents'
    );
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.body).toBe(formData);
    expect(xhr.headers).not.toHaveProperty('Content-Type');

    xhr.emitProgress(5, 20);
    expect(onUploadProgress).toHaveBeenCalledWith({
      loaded: 5,
      total: 20,
      percent: 25,
    });

    xhr.succeed({ id: 42 });
    await expect(request).resolves.toEqual({ id: 42 });
  });

  it('does not retransmit a file after an HTTP validation response', async () => {
    apiService.fallbackURL = 'https://fallback.example.test/api/v1';
    const formData = new FormData();
    formData.append(
      'file',
      new File(['synthetic'], 'report.pdf', { type: 'application/pdf' })
    );

    const request = apiService.post(
      '/health-imports/source-documents',
      formData,
      {
        onUploadProgress: vi.fn(),
      }
    );
    FakeXMLHttpRequest.latest.fail(409, {
      detail: 'Duplicate source document',
    });

    await expect(request).rejects.toMatchObject({ status: 409 });
    expect(FakeXMLHttpRequest.instances).toHaveLength(1);
  });

  it('preserves a structured FastAPI error code for feature-specific recovery', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new File(['synthetic'], 'report.pdf', { type: 'application/pdf' })
    );

    const request = apiService.post(
      '/health-imports/source-documents',
      formData,
      {
        onUploadProgress: vi.fn(),
      }
    );
    FakeXMLHttpRequest.latest.fail(413, {
      detail: {
        code: 'health_ai_input_too_large',
        message: 'Too many selected records',
      },
    });

    await expect(request).rejects.toMatchObject({
      status: 413,
      code: 'health_ai_input_too_large',
      message: 'Too many selected records',
    });
  });

  it('does not retry the same ordinary request URL twice', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiService.get('/health-ai/subjects/7/capabilities')
    ).rejects.toThrow('Failed to fetch');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry or log an intentionally aborted ordinary request', async () => {
    apiService.fallbackURL = 'https://fallback.example.test/api/v1';
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException(
      'The operation was aborted.',
      'AbortError'
    );
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiService.get('/archive-access/subjects', {
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.apiError).not.toHaveBeenCalled();
  });
});
