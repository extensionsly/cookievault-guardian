/**
 * Orchestrates one full cleanup pass: load state → ask
 * `decideCleanup` for every cookie → apply deletions → write audit.
 *
 * Idempotent: re-running immediately is safe (the second pass has
 * nothing left to delete, and `removeCookie` returning false is
 * treated as already-gone, not a failure).
 */

import { decideCleanup, findMatchingRule, type Cookie } from '@cookievault/shared';
import { appendAudit, appendAuditBatch, type AuditEntry } from './audit.js';
import { listAllCookies, removeCookie } from './cookies.js';
import { loadRules, loadSettings } from './settings.js';
import { clearSiteDataForHosts } from './site-data.js';
import { computeOpenHosts } from './tabs.js';

export interface CleanupReport {
  deleted: number;
  kept: number;
  protected: number;
  errors: number;
  /** Number of origins whose other site data was cleared (0 unless enabled). */
  siteDataCleared: number;
}

export async function runCleanup(): Promise<CleanupReport> {
  const report: CleanupReport = {
    deleted: 0,
    kept: 0,
    protected: 0,
    errors: 0,
    siteDataCleared: 0,
  };

  // Cheap reads first. If there are no rules and the default is to allow,
  // no cookie can ever be deleted — skip the full `getAll` scan and tab
  // enumeration entirely. This keeps the every-30s safety alarm from waking
  // the SW to walk every cookie when the user hasn't configured anything
  // (audit F13d).
  const [rules, settings] = await Promise.all([loadRules(), loadSettings()]);
  if (rules.length === 0 && settings.defaultAction === 'allow') {
    return report;
  }

  const [cookies, openHosts] = await Promise.all([listAllCookies(), computeOpenHosts()]);
  const tabState = { hostsWithOpenTabs: openHosts };

  // Hosts whose cookies we actually deleted — candidates for clearing
  // their other site data (only when the user enabled it).
  const cleanedHosts = new Set<string>();

  // Collect audit entries and flush once at the end. Writing per-cookie
  // would do one storage get+set per deletion — a first-run sweep of a
  // few thousand cookies would stall for seconds (audit F2).
  const auditEntries: AuditEntry[] = [];

  for (const cookie of cookies) {
    const decision = decideCleanup(cookie, rules, tabState, settings);
    if (decision === 'keep') {
      report.kept += 1;
      continue;
    }
    if (decision === 'protect-while-tab-open' || decision === 'protect-login') {
      // Login-protected cookies are kept by the safety net; count them
      // as protected rather than deleted.
      report.protected += 1;
      continue;
    }
    // decision === 'delete'
    try {
      const removed = await removeCookie(cookie);
      if (!removed) {
        // Cookie already disappeared between listAll and now. Idempotent
        // no-op — not a deletion we performed, not an error.
        continue;
      }
      report.deleted += 1;
      cleanedHosts.add(cookie.domain.replace(/^\./, '').toLowerCase());
      auditEntries.push({
        ts: Date.now(),
        kind: 'deleted',
        domain: cookie.domain,
        name: cookie.name,
        reason: reasonString(cookie, rules, settings.defaultAction),
      });
    } catch (err) {
      // A real API failure (e.g. permission revoked mid-sweep). Record it
      // visibly in the audit log instead of swallowing it, so the user can
      // tell cleanup is degraded.
      report.errors += 1;
      auditEntries.push({
        ts: Date.now(),
        kind: 'error',
        domain: cookie.domain,
        name: cookie.name,
        reason: `error:${err instanceof Error ? err.message : 'remove-failed'}`,
      });
    }
  }

  // Optional second pass: clear localStorage / IndexedDB / cache for the
  // hosts we just cleaned. No-op unless the user enabled it AND granted
  // the optional `browsingData` permission.
  if (settings.clearSiteData && cleanedHosts.size > 0) {
    try {
      const cleared = await clearSiteDataForHosts(cleanedHosts);
      report.siteDataCleared = cleared;
      if (cleared > 0) {
        auditEntries.push({
          ts: Date.now(),
          kind: 'deleted',
          domain: `${cleanedHosts.size} site(s)`,
          name: '(site data)',
          reason: 'site-data:localStorage+indexedDB+cache',
        });
      }
    } catch (err) {
      report.errors += 1;
      auditEntries.push({
        ts: Date.now(),
        kind: 'error',
        domain: `${cleanedHosts.size} site(s)`,
        name: '(site data)',
        reason: `error:${err instanceof Error ? err.message : 'site-data-failed'}`,
      });
    }
  }

  // Single flush of the whole sweep's audit trail. Never let an
  // audit-write failure abort the sweep or lose the report.
  await appendAuditBatch(auditEntries).catch((err) => {
    console.error('[CookieVault Guardian] audit batch write failed', err);
  });

  return report;
}

/**
 * Aggressive "clear everything now" — the panic button. Deletes ALL cookies
 * regardless of rules or login protection (that's the point: a clean slate
 * on demand). Best-effort: individual failures are skipped so one bad cookie
 * can't stall the wipe. Returns the number actually removed and writes a
 * single summary audit entry.
 */
export async function clearAllNow(): Promise<number> {
  const cookies = await listAllCookies();
  let cleared = 0;
  for (const cookie of cookies) {
    try {
      if (await removeCookie(cookie)) cleared += 1;
    } catch {
      // Skip — a manual wipe shouldn't abort on a single stubborn cookie.
    }
  }
  if (cleared > 0) {
    await appendAudit({
      ts: Date.now(),
      kind: 'deleted',
      domain: `${cleared} cookie(s)`,
      name: '(clear all)',
      reason: 'manual:clear-all',
    }).catch(() => {});
  }
  return cleared;
}

function reasonString(
  cookie: Pick<Cookie, 'domain'>,
  rules: Awaited<ReturnType<typeof loadRules>>,
  defaultAction: string,
): string {
  const match = findMatchingRule(cookie.domain, rules);
  if (match) return `rule:${match.pattern}`;
  return `default:${defaultAction}`;
}
