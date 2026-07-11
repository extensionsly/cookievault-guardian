/**
 * 200-entry circular audit log of cookie events. Stored in
 * `browser.storage.local` (plaintext — local sync only; cloud sync of
 * the audit log, if we ever do it, will go through the encrypted
 * pipeline in @cookievault/shared/crypto).
 *
 * The popup's "Recent activity" pane reads from here.
 */

import { browser } from 'wxt/browser';

const STORAGE_KEY = 'guardian.audit.log';
const MAX_ENTRIES = 200;

export type AuditKind = 'deleted' | 'protected' | 'observed' | 'error';

export interface AuditEntry {
  /** Unix milliseconds. */
  ts: number;
  kind: AuditKind;
  domain: string;
  name: string;
  /**
   * Free-form short reason. Examples:
   *   'rule:*.example.com'  — matched a user rule
   *   'default:allow'       — no rule matched, fell back to default
   *   'set-by-website'      — observed via cookies.onChanged
   */
  reason: string;
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  await appendAuditBatch([entry]);
}

/**
 * Append many entries in a single storage read + write. Callers that
 * produce a burst of entries (e.g. a cleanup sweep deleting hundreds of
 * cookies, or a throttled buffer of "observed" events) must use this
 * instead of looping `appendAudit`, which would do one get+set per entry
 * and cause a storage write amplification stall (audit F2).
 *
 * Maintains the same 200-entry circular buffer: after appending, only the
 * newest MAX_ENTRIES are kept.
 */
export async function appendAuditBatch(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const { [STORAGE_KEY]: existing } = await browser.storage.local.get(STORAGE_KEY);
  const list: AuditEntry[] = Array.isArray(existing) ? (existing as AuditEntry[]) : [];
  list.push(...entries);
  // Circular: drop oldest once we exceed MAX_ENTRIES. splice in place
  // avoids a fresh array allocation per write.
  if (list.length > MAX_ENTRIES) {
    list.splice(0, list.length - MAX_ENTRIES);
  }
  await browser.storage.local.set({ [STORAGE_KEY]: list });
}

export async function readAudit(): Promise<AuditEntry[]> {
  const { [STORAGE_KEY]: existing } = await browser.storage.local.get(STORAGE_KEY);
  return Array.isArray(existing) ? (existing as AuditEntry[]) : [];
}

export async function clearAudit(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEY);
}
