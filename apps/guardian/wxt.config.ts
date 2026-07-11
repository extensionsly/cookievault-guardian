import { defineConfig } from 'wxt';

// Guardian's job is auto-delete, so its permission surface is wider
// than Editor's — `tabs` to know when an origin's last tab closes,
// `alarms` for the 30s safety sweep. See docs/security-model.md §4
// for the per-permission justification.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: ({ browser }) => ({
    // Localized via public/_locales/<lang>/messages.json (default en).
    name: '__MSG_appName__',
    description: '__MSG_appExtDescription__',
    default_locale: 'en',
    permissions: ['cookies', 'storage', 'tabs', 'alarms'],
    // `browsingData` is optional: the base install stays minimal, and we
    // request it at runtime only if the user enables "also clear site
    // data" (localStorage / IndexedDB / cache). See lib/site-data.ts.
    optional_permissions: ['browsingData'],
    host_permissions: ['<all_urls>'],
    // Declared explicitly (not just the MV3 default) so store review can
    // self-verify no remote code / eval is allowed. See security-model §4.
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
    action: {
      default_title: 'CookieVault Guardian',
    },
    // AMO signing id + API floor + data-collection declaration. Guardian
    // collects nothing: no accounts, no telemetry, audit log stays local.
    // See docs/browser-compatibility.md §AMO.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'guardian@cookievault.net',
          strict_min_version: '115.0',
          data_collection_permissions: {
            required: ['none'],
          },
        },
      },
    }),
  }),
});
