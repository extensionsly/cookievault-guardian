/**
 * Optional "clear other site data" capability, gated behind the
 * `browsingData` optional permission. Cookies are Guardian's core job
 * and use the always-granted `cookies` permission; localStorage /
 * IndexedDB / cache storage / service workers are origin-keyed and need
 * `browser.browsingData`, which we request at runtime so the base install
 * stays minimal.
 *
 * All `browser.permissions` / `browser.browsingData` calls live here, per
 * the apps/guardian/lib boundary.
 */

import { browser, type Browser } from 'wxt/browser';

const PERMISSION: Browser.permissions.Permissions = { permissions: ['browsingData'] };

export function hasSiteDataPermission(): Promise<boolean> {
  return browser.permissions.contains(PERMISSION);
}

/** Prompt the user (must be called from a user gesture, e.g. a click). */
export function requestSiteDataPermission(): Promise<boolean> {
  return browser.permissions.request(PERMISSION);
}

export function removeSiteDataPermission(): Promise<boolean> {
  return browser.permissions.remove(PERMISSION);
}

/**
 * Map cleaned hosts to concrete origins. Site data is origin-keyed while
 * cookies are domain-keyed, so we clear both http and https origins for
 * each host. Leading dots are stripped; blanks dropped.
 */
export function originsForHosts(hosts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of hosts) {
    const host = raw.replace(/^\./, '').trim().toLowerCase();
    if (!host) continue;
    out.add(`https://${host}`);
    out.add(`http://${host}`);
  }
  return [...out];
}

/** Bare hostnames (no scheme) for Firefox's `hostnames` removal filter. */
export function hostnamesForHosts(hosts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of hosts) {
    const host = raw.replace(/^\./, '').trim().toLowerCase();
    if (host) out.add(host);
  }
  return [...out];
}

/**
 * Clear origin-keyed site data for the given hosts. No-op when the
 * permission isn't granted or there are no hosts. Cookies are NOT
 * touched here — the engine already removed them via `browser.cookies`.
 *
 * Cross-browser split (docs/browser-compatibility.md §browsingData):
 * Chromium filters by `origins` and supports cacheStorage/fileSystems;
 * Firefox filters by `hostnames` (no scheme) and implements neither of
 * those two data types — passing them there throws.
 */
export async function clearSiteDataForHosts(hosts: Iterable<string>): Promise<number> {
  if (!(await hasSiteDataPermission())) return 0;
  if (import.meta.env.FIREFOX) {
    const hostnames = hostnamesForHosts(hosts);
    if (hostnames.length === 0) return 0;
    await browser.browsingData.remove(
      { hostnames } as unknown as Browser.browsingData.RemovalOptions,
      { localStorage: true, indexedDB: true, serviceWorkers: true },
    );
    return hostnames.length;
  }
  const origins = originsForHosts(hosts);
  if (origins.length === 0) return 0;
  await browser.browsingData.remove(
    { origins: origins as [string, ...string[]] },
    {
      localStorage: true,
      indexedDB: true,
      cacheStorage: true,
      serviceWorkers: true,
      fileSystems: true,
    },
  );
  return origins.length;
}
