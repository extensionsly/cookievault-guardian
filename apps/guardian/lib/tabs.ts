/**
 * Snapshot of currently-open hosts. Used by the cleanup engine to
 * decide whether `clean-on-close` cookies are still in use.
 */

import { browser } from 'wxt/browser';

export async function computeOpenHosts(): Promise<Set<string>> {
  const tabs = await browser.tabs.query({});
  const hosts = new Set<string>();
  for (const t of tabs) {
    if (!t.url) continue;
    try {
      const url = new URL(t.url);
      // Internal URLs (chrome://, about:, file://) don't have a
      // meaningful cookie host — skip them.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      hosts.add(url.hostname.toLowerCase());
    } catch {
      // Malformed URL — skip.
    }
  }
  return hosts;
}
