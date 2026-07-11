# CookieVault Guardian

MV3 browser extension. The user-facing job: keep a whitelist of
domains, clean everything else when its last tab closes, and sweep
periodically as a safety net.

Profile sync and team-shared whitelists gate behind Pro / Team.

## Local development

```bash
# from repo root
pnpm install

# Chrome dev mode (launches a profile, reloads on save)
pnpm --filter guardian dev

# Firefox dev mode
pnpm --filter guardian dev:firefox

# Production build
pnpm --filter guardian build
pnpm --filter guardian zip
```

WXT writes the dev / build output to `apps/guardian/.output/`. The
generated `.wxt/` directory holds the typed manifest and generated
ambient types — both are gitignored.

## Entrypoints

| Path                        | What it is                                                           |
| --------------------------- | -------------------------------------------------------------------- |
| `entrypoints/popup/`        | Toolbar popup. Rules list, add-rule form, recent cleanup log.        |
| `entrypoints/options/`      | Full-page settings (account, subscription, advanced cleanup tuning). |
| `entrypoints/background.ts` | Service Worker. tabs.onRemoved + chrome.alarms cleanup engine.       |

## Cleanup model

- **tabs.onRemoved** — when a tab for an origin closes and no other
  tab on that origin remains, run cleanup for that origin.
- **chrome.alarms (30s)** — safety net. SW idle reaper might wake us
  up missing a `tabs.onRemoved` event; the sweep catches what slipped.
- **chrome.cookies.onChanged** — append to a 200-entry circular audit
  log in `chrome.storage.local`. No network, no analytics.

The decision logic itself lives in `@cookievault/shared/cleanup.ts` so
it can be unit-tested without `chrome.*`.

## Manifest

Derived from `wxt.config.ts`. Permissions: `cookies`, `storage`,
`tabs`, `alarms`, and `<all_urls>` host. Each is justified in the
forthcoming CWS listing source (`docs/cws-listing.md`, W3-11).

## Icons

`public/icon/*.png` currently ship placeholder 1×1 transparent PNGs.
Real icon set lands in W4 alongside CWS listing assets (W4-01); see
`ROADMAP.md`.
