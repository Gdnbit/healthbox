import type { HealthAiQuestionInput } from '../../services/api/healthAiApi';

const STORAGE_PREFIX = 'family-health:health-ai-idempotency:v1:';
const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REGISTRY_ENTRIES = 100;
const DERIVATION_EPOCH_MS = 24 * 60 * 60 * 1000;

interface StoredHealthAiIdempotency {
  version: 1;
  digest: string;
  generation: number;
  epoch: number;
  pendingKey?: string;
  pendingSince?: number;
  updatedAt: number;
}

export interface HealthAiIdempotencyHandle {
  digest: string;
  key: string;
}

interface HealthAiRequestError {
  status?: number;
  code?: string;
}

const memoryRegistry = new Map<string, StoredHealthAiIdempotency>();
const memoryFallbackDigests = new Set<string>();

const canonicalRequest = (
  accountId: number,
  patientId: number,
  request: HealthAiQuestionInput
): string =>
  JSON.stringify({
    accountId,
    patientId,
    questionId: request.question_id,
    question: request.question,
    range: request.range,
    recordIds: [...new Set(request.record_ids)].sort(),
  });

const sha256Bytes = async (value: string): Promise<Uint8Array> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
};

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

const uuidV4FromBytes = (source: Uint8Array): string => {
  const bytes = source.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = toHex(bytes);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const readEntry = (digest: string): StoredHealthAiIdempotency | null => {
  const key = `${STORAGE_PREFIX}${digest}`;
  const browserStorage = storage();
  const raw = browserStorage?.getItem(key);
  if (!raw) {
    return !browserStorage || memoryFallbackDigests.has(digest)
      ? (memoryRegistry.get(digest) ?? null)
      : null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHealthAiIdempotency>;
    if (
      parsed.version !== 1 ||
      parsed.digest !== digest ||
      typeof parsed.generation !== 'number' ||
      typeof parsed.epoch !== 'number' ||
      typeof parsed.updatedAt !== 'number'
    ) {
      browserStorage?.removeItem(key);
      return null;
    }
    return parsed as StoredHealthAiIdempotency;
  } catch {
    browserStorage?.removeItem(key);
    return null;
  }
};

const writeEntry = (entry: StoredHealthAiIdempotency): void => {
  memoryRegistry.set(entry.digest, entry);
  try {
    const browserStorage = storage();
    if (!browserStorage) {
      memoryFallbackDigests.add(entry.digest);
      return;
    }
    browserStorage.setItem(
      `${STORAGE_PREFIX}${entry.digest}`,
      JSON.stringify(entry)
    );
    memoryFallbackDigests.delete(entry.digest);
  } catch {
    memoryFallbackDigests.add(entry.digest);
    // Memory fallback still preserves retries for the current page.
  }
};

const cleanupRegistry = (now: number): void => {
  const browserStorage = storage();
  if (!browserStorage) return;
  const entries: Array<{ key: string; updatedAt: number }> = [];
  const storageKeys = Array.from(
    { length: browserStorage.length },
    (_, index) => browserStorage.key(index)
  );
  for (const key of storageKeys) {
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    try {
      const raw = browserStorage.getItem(key);
      const parsed = raw
        ? (JSON.parse(raw) as Partial<StoredHealthAiIdempotency>)
        : null;
      if (
        !parsed ||
        typeof parsed.updatedAt !== 'number' ||
        now - parsed.updatedAt > REGISTRY_TTL_MS
      ) {
        browserStorage.removeItem(key);
        continue;
      }
      entries.push({ key, updatedAt: parsed.updatedAt });
    } catch {
      browserStorage.removeItem(key);
    }
  }
  entries
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(MAX_REGISTRY_ENTRIES)
    .forEach(entry => browserStorage.removeItem(entry.key));
};

const requestDigest = async (
  accountId: number,
  patientId: number,
  request: HealthAiQuestionInput
): Promise<string> =>
  toHex(await sha256Bytes(canonicalRequest(accountId, patientId, request)));

const derivedKey = async (
  digest: string,
  generation: number,
  epoch: number
): Promise<string> =>
  uuidV4FromBytes(
    await sha256Bytes(
      `family-health-ai-idempotency-v1:${digest}:${generation}:${epoch}`
    )
  );

export const acquireHealthAiIdempotency = async (
  accountId: number,
  patientId: number,
  request: HealthAiQuestionInput,
  now = Date.now()
): Promise<HealthAiIdempotencyHandle> => {
  cleanupRegistry(now);
  const digest = await requestDigest(accountId, patientId, request);
  const current = readEntry(digest);
  if (
    current?.pendingKey &&
    typeof current.pendingSince === 'number' &&
    now - current.pendingSince <= PENDING_TTL_MS
  ) {
    writeEntry({ ...current, updatedAt: now });
    return { digest, key: current.pendingKey };
  }

  const generation = current?.generation ?? 0;
  const epoch = Math.floor(now / DERIVATION_EPOCH_MS);
  const key = await derivedKey(digest, generation, epoch);
  writeEntry({
    version: 1,
    digest,
    generation,
    epoch,
    pendingKey: key,
    pendingSince: now,
    updatedAt: now,
  });
  return { digest, key };
};

export const completeHealthAiIdempotency = async (
  handle: HealthAiIdempotencyHandle,
  now = Date.now()
): Promise<void> => {
  const current = readEntry(handle.digest);
  if (!current || current.pendingKey !== handle.key) return;
  writeEntry({
    version: 1,
    digest: handle.digest,
    generation: current.generation + 1,
    epoch: Math.floor(now / DERIVATION_EPOCH_MS),
    updatedAt: now,
  });
};

export const shouldRetainHealthAiIdempotency = (error: unknown): boolean => {
  const requestError = error as HealthAiRequestError;
  const code =
    typeof requestError?.code === 'string' && requestError.code.length > 0
      ? requestError.code
      : undefined;
  if (typeof requestError?.status !== 'number') return true;
  if (
    (requestError.status === 502 ||
      requestError.status === 503 ||
      requestError.status === 504) &&
    !code
  ) {
    return true;
  }
  return (
    (requestError.status === 409 &&
      (code === 'health_ai_request_in_progress' ||
        code === 'health_ai_request_already_completed'))
  );
};
