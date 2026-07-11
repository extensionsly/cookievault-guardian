import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookie } from '@cookievault/shared';
import { newRule } from '@cookievault/shared';

// Mock every chrome-touching collaborator; keep @cookievault/shared real so
// the actual decideCleanup logic runs end-to-end through the orchestrator.
vi.mock('./cookies.js', () => ({
  listAllCookies: vi.fn(),
  removeCookie: vi.fn(),
}));
vi.mock('./audit.js', () => ({
  appendAudit: vi.fn(async () => {}),
  appendAuditBatch: vi.fn(async () => {}),
}));
vi.mock('./settings.js', () => ({ loadRules: vi.fn(), loadSettings: vi.fn() }));
vi.mock('./site-data.js', () => ({ clearSiteDataForHosts: vi.fn(async () => 0) }));
vi.mock('./tabs.js', () => ({ computeOpenHosts: vi.fn(async () => new Set<string>()) }));

import { clearAllNow, runCleanup } from './engine.js';
import { listAllCookies, removeCookie } from './cookies.js';
import { appendAudit, appendAuditBatch } from './audit.js';
import { loadRules, loadSettings } from './settings.js';
import { clearSiteDataForHosts } from './site-data.js';

// Default that deletes every unlisted, non-login cookie — lets each test
// control decisions purely via the cookie set + rules.
const DELETE_ALL = {
  defaultAction: 'clean-immediately',
  protectLogins: false,
  clearSiteData: false,
} as const;

function cookie(over: { domain: string; name: string } & Partial<Cookie>): Cookie {
  return {
    value: '',
    hostOnly: true,
    path: '/',
    secure: false,
    httpOnly: false,
    sameSite: 'unspecified',
    session: false,
    storeId: '0',
    ...over,
  } as unknown as Cookie;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadRules).mockResolvedValue([]);
  vi.mocked(loadSettings).mockResolvedValue({ ...DELETE_ALL });
  vi.mocked(clearSiteDataForHosts).mockResolvedValue(0);
});

describe('runCleanup', () => {
  it('skips the full cookie scan when idle (no rules + default allow)', async () => {
    vi.mocked(loadRules).mockResolvedValue([]);
    vi.mocked(loadSettings).mockResolvedValue({
      defaultAction: 'allow',
      protectLogins: false,
      clearSiteData: false,
    });

    const report = await runCleanup();

    expect(report).toEqual({ deleted: 0, kept: 0, protected: 0, errors: 0, siteDataCleared: 0 });
    // The whole point of F13d: never walk every cookie when nothing can
    // possibly be deleted.
    expect(listAllCookies).not.toHaveBeenCalled();
    expect(appendAuditBatch).not.toHaveBeenCalled();
  });

  it('deletes a matching cookie and writes a "deleted" audit entry', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([cookie({ domain: 'a.com', name: 'foo' })]);
    vi.mocked(removeCookie).mockResolvedValue(true);

    const report = await runCleanup();

    expect(report.deleted).toBe(1);
    expect(report.errors).toBe(0);
    expect(removeCookie).toHaveBeenCalledTimes(1);
    // Whole sweep audited in a single batched write (audit F2).
    expect(appendAuditBatch).toHaveBeenCalledTimes(1);
    expect(appendAuditBatch).toHaveBeenCalledWith([
      expect.objectContaining({ kind: 'deleted', domain: 'a.com', name: 'foo' }),
    ]);
  });

  it('batches all deletions into one appendAuditBatch write', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([
      cookie({ domain: 'a.com', name: 'foo' }),
      cookie({ domain: 'b.com', name: 'bar' }),
      cookie({ domain: 'c.com', name: 'baz' }),
    ]);
    vi.mocked(removeCookie).mockResolvedValue(true);

    const report = await runCleanup();

    expect(report.deleted).toBe(3);
    // Three deletions, still exactly one storage write.
    expect(appendAuditBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(appendAuditBatch).mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('keeps a cookie covered by an allow rule (no removal, no audit)', async () => {
    vi.mocked(loadRules).mockResolvedValue([newRule('b.com', 'allow')]);
    vi.mocked(listAllCookies).mockResolvedValue([cookie({ domain: 'b.com', name: 'bar' })]);

    const report = await runCleanup();

    expect(report.kept).toBe(1);
    expect(report.deleted).toBe(0);
    expect(removeCookie).not.toHaveBeenCalled();
  });

  it('treats an already-gone cookie (remove → false) as a no-op, not a delete', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([cookie({ domain: 'a.com', name: 'foo' })]);
    vi.mocked(removeCookie).mockResolvedValue(false);

    const report = await runCleanup();

    expect(report.deleted).toBe(0);
    expect(report.errors).toBe(0);
    // No entries collected → empty batch (which is a storage no-op).
    expect(vi.mocked(appendAuditBatch).mock.calls[0]?.[0] ?? []).toHaveLength(0);
  });

  it('counts a thrown removal as an error and audits it with kind "error"', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([cookie({ domain: 'a.com', name: 'foo' })]);
    vi.mocked(removeCookie).mockRejectedValue(new Error('permission revoked'));

    const report = await runCleanup();

    expect(report.deleted).toBe(0);
    expect(report.errors).toBe(1);
    expect(appendAuditBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: 'error',
        domain: 'a.com',
        reason: expect.stringContaining('error:'),
      }),
    ]);
  });

  it('clears site data for cleaned hosts when the setting is on', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ ...DELETE_ALL, clearSiteData: true });
    vi.mocked(listAllCookies).mockResolvedValue([cookie({ domain: 'a.com', name: 'foo' })]);
    vi.mocked(removeCookie).mockResolvedValue(true);
    vi.mocked(clearSiteDataForHosts).mockResolvedValue(2);

    const report = await runCleanup();

    expect(clearSiteDataForHosts).toHaveBeenCalledTimes(1);
    expect(report.siteDataCleared).toBe(2);
  });

  it('does not touch site data when the setting is off', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([cookie({ domain: 'a.com', name: 'foo' })]);
    vi.mocked(removeCookie).mockResolvedValue(true);

    await runCleanup();

    expect(clearSiteDataForHosts).not.toHaveBeenCalled();
  });

  it('is a no-op on an empty cookie jar (idempotent re-run)', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([]);

    const report = await runCleanup();

    expect(report.deleted).toBe(0);
    expect(removeCookie).not.toHaveBeenCalled();
  });
});

describe('clearAllNow', () => {
  it('removes every cookie regardless of rules and audits a summary', async () => {
    // An allow rule would normally keep a.com — clearAllNow ignores rules.
    vi.mocked(loadRules).mockResolvedValue([newRule('a.com', 'allow')]);
    vi.mocked(listAllCookies).mockResolvedValue([
      cookie({ domain: 'a.com', name: 'x' }),
      cookie({ domain: 'b.com', name: 'y' }),
    ]);
    vi.mocked(removeCookie).mockResolvedValue(true);

    const n = await clearAllNow();

    expect(n).toBe(2);
    expect(removeCookie).toHaveBeenCalledTimes(2);
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'manual:clear-all' }),
    );
  });

  it('skips individual failures and clears the rest', async () => {
    vi.mocked(listAllCookies).mockResolvedValue([
      cookie({ domain: 'a.com', name: 'x' }),
      cookie({ domain: 'b.com', name: 'y' }),
    ]);
    vi.mocked(removeCookie).mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('nope'));

    const n = await clearAllNow();

    expect(n).toBe(1);
  });
});
