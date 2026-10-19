import { describe, expect, it } from 'vitest';
import {
  HEALTH_UPLOAD_LIMITS,
  healthUploadMimeType,
  validateHealthUploadSelection,
} from './healthUploadValidation';

const file = (
  name: string,
  size: number,
  type: string,
  lastModified = 1
): File => {
  const value = new File(['x'], name, { type, lastModified });
  Object.defineProperty(value, 'size', { value: size });
  return value;
};

describe('validateHealthUploadSelection', () => {
  it('accepts supported images and PDFs within their separate limits', () => {
    const result = validateHealthUploadSelection(
      [],
      [
        file('page.jpg', HEALTH_UPLOAD_LIMITS.imageBytes, 'image/jpeg'),
        file('report.pdf', HEALTH_UPLOAD_LIMITS.pdfBytes, 'application/pdf'),
      ]
    );

    expect(result.accepted.map(item => item.name)).toEqual([
      'page.jpg',
      'report.pdf',
    ]);
    expect(result.rejected).toEqual([]);
    expect(healthUploadMimeType(file('phone.heic', 10, ''))).toBe('image/heic');
    expect(healthUploadMimeType(file('scan.JPG', 10, ''))).toBe('image/jpeg');
  });

  it('rejects unsupported types and files above the type-specific limit', () => {
    const result = validateHealthUploadSelection(
      [],
      [
        file('notes.txt', 100, 'text/plain'),
        file('large.png', HEALTH_UPLOAD_LIMITS.imageBytes + 1, 'image/png'),
        file('large.pdf', HEALTH_UPLOAD_LIMITS.pdfBytes + 1, 'application/pdf'),
      ]
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map(item => item.code)).toEqual([
      'unsupported_type',
      'file_too_large',
      'file_too_large',
    ]);
  });

  it('enforces the 30-file and 300MB queue limits deterministically', () => {
    const existing = Array.from({ length: 29 }, (_, index) => ({
      size: 9 * 1024 * 1024,
      fingerprint: `existing-${index}`,
    }));
    const result = validateHealthUploadSelection(existing, [
      file('accepted.jpg', 10 * 1024 * 1024, 'image/jpeg'),
      file('too-many.jpg', 1, 'image/jpeg'),
    ]);

    expect(result.accepted.map(item => item.name)).toEqual(['accepted.jpg']);
    expect(result.rejected).toEqual([
      expect.objectContaining({ fileName: 'too-many.jpg', code: 'too_many' }),
    ]);

    const totalResult = validateHealthUploadSelection(
      [{ size: HEALTH_UPLOAD_LIMITS.batchBytes - 10, fingerprint: 'existing' }],
      [file('over-total.jpg', 11, 'image/jpeg')]
    );
    expect(totalResult.rejected[0].code).toBe('batch_too_large');
  });

  it('filters an already queued exact fingerprint without dropping distinct files', () => {
    const sameCopy = file('same-copy.pdf', 100, 'application/pdf');
    const different = file('different.pdf', 100, 'application/pdf');
    const result = validateHealthUploadSelection(
      [{ size: 100, fingerprint: 'sha-256:same' }],
      [sameCopy, different],
      new Map([
        [sameCopy, 'sha-256:same'],
        [different, 'sha-256:different'],
      ])
    );

    expect(result.accepted.map(item => item.name)).toEqual(['different.pdf']);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        fileName: 'same-copy.pdf',
        code: 'duplicate',
      }),
    ]);
  });
});
