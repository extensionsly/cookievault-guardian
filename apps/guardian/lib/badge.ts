/**
 * Per-tab action badge that surfaces, at a glance, how Guardian will
 * treat the current site:
 *
 *   - green ✓  — an `allow` rule matches: cookies are kept (trusted).
 *   - amber ~  — a `clean-on-close` rule matches: cleaned on tab close.
 *   - red ✕    — a `clean-immediately` rule matches: cleaned right away.
 *   - (none)   — no rule matches; the global default applies silently.
 *
 * All `browser.action` / `browser.tabs.get` calls live here (per the
 * apps/guardian/lib boundary). The background entrypoint only wires the
 * events that call into this module.
 */

import { browser } from 'wxt/browser';
import { findMatchingRule } from '@cookievault/shared';
import { loadRules } from './settings.js';

// Chrome MV3 exposes the toolbar-button API as `browser.action`; the
// Firefox MV2 build exposes the same surface as `browser.browserAction`.
// Resolve once — everything below goes through this alias.
const action = browser.action ?? browser.browserAction;

const COLORS = {
  allow: '#16a34a',
  'clean-on-close': '#ca8a04',
  'clean-immediately': '#dc2626',
} as const;

const ICONS = {
  allow: '✓',
  'clean-on-close': '~',
  'clean-immediately': '✕',
} as const;

function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function clearBadge(tabId: number): Promise<void> {
  await action.setBadgeText({ tabId, text: '' });
  await action.setTitle({ tabId, title: 'CookieVault Guardian' });
}

/** Recompute and apply the badge for a single tab. */
export async function refreshBadge(tabId: number): Promise<void> {
  let url: string | undefined;
  try {
    url = (await browser.tabs.get(tabId)).url;
  } catch {
    return; // tab closed between event and now
  }
  const host = hostFromUrl(url);
  if (!host) {
    await clearBadge(tabId);
    return;
  }
  const rule = findMatchingRule(host, await loadRules());
  if (!rule) {
    await clearBadge(tabId);
    return;
  }
  await action.setBadgeText({ tabId, text: ICONS[rule.action] });
  await action.setBadgeBackgroundColor({ tabId, color: COLORS[rule.action] });
  await action.setTitle({
    tabId,
    title: `CookieVault Guardian — ${host}: ${rule.action} (rule: ${rule.pattern})`,
  });
}

/** Refresh the badge for whichever tab is currently active. */
export async function refreshActiveTabBadge(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) await refreshBadge(tab.id);
}
