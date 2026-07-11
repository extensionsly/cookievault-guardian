import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { appendAuditBatch, type AuditEntry } from '../lib/audit.js';
import { refreshActiveTabBadge, refreshBadge } from '../lib/badge.js';
import { runCleanup } from '../lib/engine.js';

const ALARM_NAME = 'guardian.sweep';
// browser.alarms accepts fractional minutes; 0.5 = 30s. Chrome may
// round up to its enforced minimum (currently 30s in MV3). The sweep
// is a safety net — `tabs.onRemoved` is the fast path that catches
// most cleanups in real time.
const ALARM_PERIOD_MIN = 0.5;

const LAST_ERROR_KEY = 'guardian.lastError';

export default defineBackground(() => {
  // Guards against overlapping sweeps: a tab closing near the 30s alarm
  // tick would otherwise run two passes in parallel, double-writing audit
  // entries and racing on the same deletions.
  let sweeping = false;

  // In-memory buffer of "observed" (website-set) audit entries. Writing one
  // storage get+set per set cookie flooded the disk during normal browsing
  // and kept the MV3 service worker from ever idling (audit F2, the heavier
  // half). We coalesce them here and flush in batches: whenever a sweep runs
  // (the SW is already awake) and whenever the buffer fills. The audit log
  // is a best-effort "recent activity" feed, so dropping the tail of a burst
  // on SW eviction is acceptable.
  let observedBuffer: AuditEntry[] = [];
  const OBSERVED_FLUSH_AT = 25;

  const flushObserved = async (): Promise<void> => {
    if (observedBuffer.length === 0) return;
    const batch = observedBuffer;
    observedBuffer = [];
    await appendAuditBatch(batch).catch((err) => {
      console.error('[CookieVault Guardian] observed audit flush failed', err);
    });
  };

  const sweep = async (trigger: string): Promise<void> => {
    if (sweeping) return;
    sweeping = true;
    try {
      // Piggyback the observed-buffer flush on the sweep: the SW is awake
      // and we're about to touch storage anyway.
      await flushObserved();
      await runCleanup();
    } catch (err) {
      console.error(`[CookieVault Guardian] ${trigger} failed`, err);
      // Surface the failure so the popup can show "cleanup is degraded"
      // instead of the user silently losing protection.
      await browser.storage.local
        .set({
          [LAST_ERROR_KEY]: {
            trigger,
            message: err instanceof Error ? err.message : String(err),
            ts: Date.now(),
          },
        })
        .catch(() => {});
    } finally {
      sweeping = false;
    }
  };

  // First-run only: open the onboarding tab. Updates and browser
  // restarts (reason 'update' / 'chrome_update') must not reopen it.
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') }).catch((err) => {
      console.error('[CookieVault Guardian] onboarding open failed', err);
    });
  });

  // (Re-)register the periodic sweep on every SW boot. browser.alarms
  // persists across SW termination, but re-creating is idempotent
  // when the name + period match.
  browser.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void sweep('sweep');
  });

  // Fast path: when any tab closes we re-evaluate. We don't try to
  // scope this to the closed tab's origin — listAllCookies + the pure
  // decideCleanup is fast enough, and a full scan catches edge cases
  // (e.g. session cookies on other origins that lost their last tab
  // earlier and slipped past).
  browser.tabs.onRemoved.addListener(() => {
    void sweep('tab-close cleanup');
  });

  // Per-tab "how will Guardian treat this site" badge. Recompute when
  // the active tab changes, when a tab finishes loading (URL settled),
  // when window focus moves, and when rules change in storage.
  const badge = (tabId: number) =>
    void refreshBadge(tabId).catch((err) => {
      console.error('[CookieVault Guardian] badge refresh failed', err);
    });
  const activeBadge = () =>
    void refreshActiveTabBadge().catch((err) => {
      console.error('[CookieVault Guardian] active-badge refresh failed', err);
    });

  browser.tabs.onActivated.addListener((info) => badge(info.tabId));
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) badge(tabId);
  });
  browser.windows.onFocusChanged.addListener(() => activeBadge());
  browser.storage.local.onChanged.addListener((changes) => {
    if (changes['guardian.rules']) activeBadge();
  });

  // Audit-only listener. Skip removals (engine already audits its own
  // deletes) and skip non-explicit causes (evictions / expirations
  // would flood the log with noise). What's left: cookies *set* by a
  // website — interesting "recent activity" for the popup.
  //
  // Buffer in memory instead of writing per event: normal browsing sets
  // many cookies per second, and one storage get+set each was the worst
  // of the F2 write amplification. The 30s sweep flushes the buffer; a
  // size cap force-flushes bursts so the SW can still be evicted between
  // ticks without losing everything.
  browser.cookies.onChanged.addListener((change) => {
    if (change.removed) return;
    if (change.cause !== 'explicit') return;
    observedBuffer.push({
      ts: Date.now(),
      kind: 'observed',
      domain: change.cookie.domain,
      name: change.cookie.name,
      reason: 'set-by-website',
    });
    if (observedBuffer.length >= OBSERVED_FLUSH_AT) void flushObserved();
  });
});
