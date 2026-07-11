# Guardian — store assets

Placeholder directory mirroring `apps/editor/store-assets/`. Screenshots
and promotional tile artwork live here once captured.

## What goes in this directory

- `screenshots/` — five `1280×800` PNGs per the listing doc spec.
  Captured manually following [`/docs/screenshot-guide.md`](../../../docs/screenshot-guide.md);
  the Guardian guide will append a Guardian-specific section (rule
  editor + activity log views) when we sit down to take them.
- `promotional-tile.png` — `440×280`, green gradient per the listing
  doc. **Generated** from `assets/brand/promo-guardian.svg` by `pnpm promo`
  (deterministic resvg render using the vendored Liberation Sans). Edit the
  SVG master and re-run to update.

## Why no fixtures here yet

Editor needs a `screenshot-cookies.json` fixture because cookie data
is browser-state — you can't screenshot what the browser doesn't have.
Guardian's screens are driven by **user-entered rules** and the
**audit log** the SW builds at runtime, both of which can be staged
by hand in 30 seconds while taking screenshots. No fixture file needed.

If we automate capture later (Playwright + xvfb), we will revisit the
fixture vs scripted-state choice — see W4-02's note on why we deferred
automation for Editor.

## Listing source

[`/docs/guardian-cws-listing.md`](../../../docs/guardian-cws-listing.md).
