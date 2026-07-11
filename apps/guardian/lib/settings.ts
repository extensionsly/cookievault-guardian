/**
 * Persistence for Guardian's rules and global settings, layered over
 * `browser.storage.local`. Both shapes are validated on read so a
 * corrupt storage entry can't crash the Service Worker.
 *
 * MVP scope: plaintext local-only. Encrypted cross-device sync is a
 * future commit that will wrap this module in the shared/crypto
 * facade.
 */

import { browser } from 'wxt/browser';
import {
  DEFAULT_GUARDIAN_SETTINGS,
  type GuardianSettings,
  GuardianSettingsSchema,
} from '@cookievault/shared';
import { type Rule, RuleSchema } from '@cookievault/shared/schema';

const RULES_KEY = 'guardian.rules';
const SETTINGS_KEY = 'guardian.settings';

export type Settings = GuardianSettings;
export { DEFAULT_GUARDIAN_SETTINGS as DEFAULT_SETTINGS };

export async function loadRules(): Promise<Rule[]> {
  const { [RULES_KEY]: raw } = await browser.storage.local.get(RULES_KEY);
  if (!Array.isArray(raw)) return [];
  // Defensively drop entries that don't validate — a corrupted single
  // rule shouldn't break the whole engine.
  const out: Rule[] = [];
  for (const r of raw) {
    const parsed = RuleSchema.safeParse(r);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export async function saveRules(rules: readonly Rule[]): Promise<void> {
  await browser.storage.local.set({ [RULES_KEY]: rules });
}

export async function loadSettings(): Promise<Settings> {
  const { [SETTINGS_KEY]: raw } = await browser.storage.local.get(SETTINGS_KEY);
  const parsed = GuardianSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_GUARDIAN_SETTINGS;
}

export async function saveSettings(s: Settings): Promise<void> {
  // Re-parse to drop any unknown fields before persisting.
  await browser.storage.local.set({ [SETTINGS_KEY]: GuardianSettingsSchema.parse(s) });
}
