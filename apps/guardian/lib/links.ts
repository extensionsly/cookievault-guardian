/**
 * Canonical external links shown in the onboarding and options pages.
 * Default branch is `CookieVault` (see CLAUDE.md), so file links pin to
 * it explicitly.
 */
const REPO = 'https://github.com/xiaobaocms/CookieVault';

export const LINKS = {
  repo: REPO,
  pledge: `${REPO}/blob/CookieVault/NO_SALE_PROMISE.md`,
  verifyBuild: `${REPO}/blob/CookieVault/docs/build-verification.md`,
} as const;
