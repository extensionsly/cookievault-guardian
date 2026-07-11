import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendAudit, appendAuditBatch, readAudit, type AuditEntry } from './audit.js';

const STORAGE_KEY = 'guardian.audit.log';

// In-memory storage backing so we can observe reads/writes precisely.
let store: Record<string, unknown>;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = {};
  get = vi.fn(async (key: string) => ({ [key]: store[key] }));
  set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  });
  (globalThis as unknown as { chrome: { storage: { local: unknown } } }).chrome.storage.local = {
    get,
    set,
  } as unknown as never;
});

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return { ts: Date.now(), kind: 'observed', domain: 'a.com', name: 'x', reason: 'r', ...over };
}

describe('appendAuditBatch', () => {
  it('writes many entries with a single get + single set', async () => {
    const batch = [entry({ name: '1' }), entry({ name: '2' }), entry({ name: '3' })];

    await appendAuditBatch(batch);

    expect(get).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(1);
    expect(await readAudit()).toHaveLength(3);
  });

  it('is a no-op (no storage touch) for an empty batch', async () => {
    await appendAuditBatch([]);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps only the newest 200 entries (circular buffer)', async () => {
    // Seed with 150, then append 100 more in one batch → 250 total, trim to 200.
    store[STORAGE_KEY] = Array.from({ length: 150 }, (_, i) => entry({ name: `old-${i}` }));

    await appendAuditBatch(Array.from({ length: 100 }, (_, i) => entry({ name: `new-${i}` })));

    const list = await readAudit();
    expect(list).toHaveLength(200);
    // Oldest 50 dropped; the newest entry is the last we appended.
    expect(list[list.length - 1]?.name).toBe('new-99');
    // First surviving entry is old-50 (the oldest 50 fell off).
    expect(list[0]?.name).toBe('old-50');
  });
});

describe('appendAudit', () => {
  it('appends a single entry via the batch path', async () => {
    await appendAudit(entry({ name: 'solo' }));
    const list = await readAudit();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('solo');
  });
});
