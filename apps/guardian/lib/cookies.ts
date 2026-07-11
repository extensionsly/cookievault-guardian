/**
 * Guardian's browser.cookies wrappers. Mirrors the discipline in
 * `apps/editor/lib/cookies.ts`: nothing outside this file imports
 * `browser.cookies` directly.
 */

import { browser, type Browser } from 'wxt/browser';
import { type Cookie, cookieUrl } from '@cookievault/shared';

export async function listAllCookies(): Promise<Cookie[]> {
  try {
    const list = await browser.cookies.getAll({});
    return list as unknown as Cookie[];
  } catch (err) {
    // If the cookies permission was revoked (policy change, malware,
    // chrome://extensions toggle) getAll throws. Degrade to an empty
    // sweep rather than crashing the Service Worker.
    console.error('[CookieVault Guardian] cookies.getAll failed', err);
    return [];
  }
}

/**
 * Remove one cookie. Returns `true` when a cookie was actually removed,
 * `false` when it was already gone (idempotent no-op). Throws only on a
 * real API failure (e.g. permission revoked mid-sweep) so the caller can
 * count it as an error rather than a silent success.
 */
export async function removeCookie(
  c: Pick<Cookie, 'domain' | 'path' | 'secure' | 'name' | 'storeId' | 'partitionKey'>,
): Promise<boolean> {
  const details: Browser.cookies.CookieDetails = {
    url: cookieUrl(c),
    name: c.name,
  };
  if (c.storeId) details.storeId = c.storeId;
  if (c.partitionKey) {
    details.partitionKey = c.partitionKey as Browser.cookies.CookiePartitionKey;
  }
  const result = await browser.cookies.remove(details);
  return result !== null;
}
