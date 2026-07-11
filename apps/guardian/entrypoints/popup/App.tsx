import { browser, type Browser } from 'wxt/browser';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { t } from '../../lib/i18n.js';
import {
  type GuardianSettings,
  type Rule,
  type RuleAction,
  findMatchingRule,
  newRule,
} from '@cookievault/shared';
import { readAudit, type AuditEntry } from '../../lib/audit.js';
import { clearAllNow } from '../../lib/engine.js';
import { ConfirmDialog, ThemeToggle } from '@cookievault/ui';
import {
  loadRules,
  loadSettings,
  saveRules,
  saveSettings,
  type Settings,
} from '../../lib/settings.js';
import {
  hasSiteDataPermission,
  removeSiteDataPermission,
  requestSiteDataPermission,
} from '../../lib/site-data.js';

/** Written by the background SW when a sweep fails (see background.ts). */
const LAST_ERROR_KEY = 'guardian.lastError';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; rules: Rule[]; settings: Settings; audit: AuditEntry[] }
  | { kind: 'error'; message: string };

const ACTION_KEY: Record<RuleAction, string> = {
  allow: 'actionAllow',
  'clean-on-close': 'actionCleanOnClose',
  'clean-immediately': 'actionCleanImmediately',
};
const actionLabel = (a: RuleAction) => t(ACTION_KEY[a]);

const ACTION_OPTIONS: RuleAction[] = ['allow', 'clean-on-close', 'clean-immediately'];

// Default action is restricted: 'clean-immediately' as a global default
// would be too destructive, so the picker only exposes the gentler two.
const DEFAULT_ACTION_OPTIONS: GuardianSettings['defaultAction'][] = ['allow', 'clean-on-close'];

/** Hostname of the active tab, or null for internal/non-web pages. */
async function getActiveHost(): Promise<string | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return t('justNow');
  if (diff < 3_600_000) return t('minutesAgo', String(Math.floor(diff / 60_000)));
  if (diff < 86_400_000) return t('hoursAgo', String(Math.floor(diff / 3_600_000)));
  return new Date(ms).toLocaleDateString();
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [currentHost, setCurrentHost] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const [newAction, setNewAction] = useState<RuleAction>('allow');
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const [lastError, setLastError] = useState<{
    trigger: string;
    message: string;
    ts: number;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [rules, loaded, audit, errRec] = await Promise.all([
        loadRules(),
        loadSettings(),
        readAudit(),
        browser.storage.local.get(LAST_ERROR_KEY),
      ]);
      // Reconcile: if "clear site data" is on but the optional permission
      // was revoked (e.g. from chrome://extensions), flip it back off.
      let settings = loaded;
      if (loaded.clearSiteData && !(await hasSiteDataPermission())) {
        settings = { ...loaded, clearSiteData: false };
        await saveSettings(settings);
      }
      setLastError(
        (errRec[LAST_ERROR_KEY] as { trigger: string; message: string; ts: number } | undefined) ??
          null,
      );
      setState({ kind: 'ready', rules, settings, audit });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const dismissError = useCallback(async () => {
    await browser.storage.local.remove(LAST_ERROR_KEY);
    setLastError(null);
  }, []);

  useEffect(() => {
    void refresh();
    void getActiveHost().then(setCurrentHost);
    // Only refresh on the keys this popup actually renders — not every
    // storage write (badge state, unrelated keys). Combined with the
    // batched audit writes (F2), this stops the open-popup refresh storm
    // (audit F13b).
    const handler = (changes: Record<string, Browser.storage.StorageChange>) => {
      if (
        changes['guardian.rules'] ||
        changes['guardian.settings'] ||
        changes['guardian.audit.log'] ||
        changes[LAST_ERROR_KEY]
      ) {
        void refresh();
      }
    };
    browser.storage.local.onChanged.addListener(handler);
    return () => browser.storage.local.onChanged.removeListener(handler);
  }, [refresh]);

  const handleAdd = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (state.kind !== 'ready') return;
      setFormError(null);
      const pattern = newPattern.trim();
      if (!pattern) {
        setFormError(t('patternEmptyError'));
        return;
      }
      try {
        const rule = newRule(pattern, newAction);
        // De-dup: if a rule for this exact pattern already exists,
        // update its action rather than create a parallel entry.
        const existing = state.rules.findIndex(
          (r) => r.pattern.toLowerCase() === pattern.toLowerCase(),
        );
        const next =
          existing >= 0
            ? state.rules.map((r, i) =>
                i === existing
                  ? { ...r, action: newAction, updatedAt: new Date().toISOString() }
                  : r,
              )
            : [...state.rules, rule];
        await saveRules(next);
        setNewPattern('');
        setNewAction('allow');
      } catch (err) {
        setFormError(err instanceof Error ? err.message : String(err));
      }
    },
    [state, newPattern, newAction],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (state.kind !== 'ready') return;
      const next = state.rules.filter((r) => r.id !== id);
      await saveRules(next);
    },
    [state],
  );

  const handleDefaultAction = useCallback(
    async (value: GuardianSettings['defaultAction']) => {
      if (state.kind !== 'ready') return;
      await saveSettings({ ...state.settings, defaultAction: value });
    },
    [state],
  );

  const handleProtectLogins = useCallback(
    async (value: boolean) => {
      if (state.kind !== 'ready') return;
      await saveSettings({ ...state.settings, protectLogins: value });
    },
    [state],
  );

  // Turning this on requires the optional `browsingData` permission, so
  // we request it from the click. If the user declines we leave it off.
  const handleClearSiteData = useCallback(
    async (value: boolean) => {
      if (state.kind !== 'ready') return;
      if (value) {
        const granted = await requestSiteDataPermission();
        if (!granted) return;
        await saveSettings({ ...state.settings, clearSiteData: true });
      } else {
        await saveSettings({ ...state.settings, clearSiteData: false });
        void removeSiteDataPermission();
      }
    },
    [state],
  );

  const handleClearAll = useCallback(async () => {
    setConfirmClearAll(false);
    setClearMsg(t('clearing'));
    try {
      const n = await clearAllNow();
      setClearMsg(t('clearedCookies', String(n)));
    } catch (err) {
      setClearMsg(t('clearFailed', err instanceof Error ? err.message : String(err)));
    }
  }, []);

  // One-click "trust this site": add an `allow` rule for the active
  // host. Reuses the same de-dup behaviour as the manual add form.
  const handleTrustSite = useCallback(async () => {
    if (state.kind !== 'ready' || !currentHost) return;
    const exists = state.rules.some((r) => r.pattern.toLowerCase() === currentHost);
    if (exists) {
      const next = state.rules.map((r) =>
        r.pattern.toLowerCase() === currentHost
          ? { ...r, action: 'allow' as RuleAction, updatedAt: new Date().toISOString() }
          : r,
      );
      await saveRules(next);
      return;
    }
    await saveRules([...state.rules, newRule(currentHost, 'allow')]);
  }, [state, currentHost]);

  if (state.kind === 'loading') {
    return <main className="status">{t('loading')}</main>;
  }
  if (state.kind === 'error') {
    return (
      <main className="status error">
        <p>{t('errorLoadGuardian')}</p>
        <code>{state.message}</code>
      </main>
    );
  }

  const { rules, settings, audit } = state;
  const recentAudit = audit.slice(-20).reverse();
  const currentRule = currentHost ? findMatchingRule(currentHost, rules) : null;

  return (
    <main>
      <header>
        <div className="header-top">
          <div className="brand">
            <span className="brand-logo" aria-hidden="true">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              </svg>
            </span>
            <span className="brand-name">{t('appShortName')}</span>
          </div>
          <span className="header-spacer" />
          <ThemeToggle label={t('themeToggle')} />
          <button
            type="button"
            className="icon settings-btn"
            onClick={() => browser.runtime.openOptionsPage()}
            aria-label={t('optionsButton')}
            title={t('optionsButton')}
          >
            ⚙
          </button>
        </div>
        <p className="hint">{t('tagline')}</p>
      </header>

      {lastError ? (
        <div className="banner error" role="alert">
          <span>{t('cleanupDegraded')}</span>
          <button type="button" className="icon" onClick={() => void dismissError()}>
            {t('dismissError')}
          </button>
        </div>
      ) : null}

      {currentHost ? (
        <section className="current-site">
          <div className="current-site__host">
            <span className="label">{t('thisSite')}</span>
            <span className="host">{currentHost}</span>
          </div>
          {currentRule ? (
            <span
              className={`action action-${currentRule.action}`}
              title={t('ruleTitle', currentRule.pattern)}
            >
              {currentRule.action === 'allow' ? t('trusted') : actionLabel(currentRule.action)}
            </span>
          ) : (
            <button type="button" className="primary" onClick={() => void handleTrustSite()}>
              {t('trustThisSite')}
            </button>
          )}
        </section>
      ) : null}

      <section className="settings">
        <label className="label">{t('defaultForUnlisted')}</label>
        <div className="radio-row">
          {DEFAULT_ACTION_OPTIONS.map((opt) => (
            <label key={opt} className="radio-option">
              <input
                type="radio"
                name="default-action"
                checked={settings.defaultAction === opt}
                onChange={() => void handleDefaultAction(opt)}
              />
              {actionLabel(opt)}
            </label>
          ))}
        </div>
        <label className="toggle-row" title={t('protectLoginsTitle')}>
          <input
            type="checkbox"
            checked={settings.protectLogins}
            onChange={(e) => void handleProtectLogins(e.target.checked)}
          />
          {t('protectLogins')} <span className="muted">{t('recommended')}</span>
        </label>
        <label className="toggle-row" title={t('clearSiteDataTitle')}>
          <input
            type="checkbox"
            checked={settings.clearSiteData}
            onChange={(e) => void handleClearSiteData(e.target.checked)}
          />
          {t('alsoClearSiteData')} <span className="muted">{t('siteDataKinds')}</span>
        </label>
        <div className="danger-zone">
          <button type="button" className="danger-action" onClick={() => setConfirmClearAll(true)}>
            {t('clearAllNow')}
          </button>
          {clearMsg ? (
            <span className="clear-msg" role="status">
              {clearMsg}
            </span>
          ) : null}
        </div>
      </section>

      <section className="rules">
        <h2>
          {t('rulesHeading')} <span className="count">{rules.length}</span>
        </h2>
        {formError ? (
          <p className="error" role="alert">
            {formError}
          </p>
        ) : null}
        <form className="add-rule" onSubmit={handleAdd}>
          <input
            type="text"
            placeholder={t('patternPlaceholder')}
            aria-label={t('domainPatternAria')}
            value={newPattern}
            onChange={(e) => setNewPattern(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
          />
          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as RuleAction)}
            aria-label={t('actionAria')}
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
          <button type="submit" className="primary">
            {t('buttonAdd')}
          </button>
        </form>
        {rules.length === 0 ? (
          <p className="empty">
            {currentHost
              ? t('emptyRulesTrust', actionLabel(settings.defaultAction))
              : t('emptyRulesAdd', actionLabel(settings.defaultAction))}
          </p>
        ) : (
          <ul className="rule-list">
            {rules.map((r) => (
              <li key={r.id}>
                <span className="pattern">{r.pattern}</span>
                <span className={`action action-${r.action}`}>{actionLabel(r.action)}</span>
                <button
                  type="button"
                  className="icon danger"
                  onClick={() => void handleDelete(r.id)}
                  aria-label={t('deleteRuleAria', r.pattern)}
                  title={t('deleteRuleTitle')}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="audit">
        <h2>
          {t('recentActivity')} <span className="count">{recentAudit.length}</span>
        </h2>
        {recentAudit.length === 0 ? (
          <p className="empty">{t('emptyAudit')}</p>
        ) : (
          <ul className="audit-list">
            {recentAudit.map((e, i) => (
              <li key={`${e.ts}-${i}`} className={`audit-${e.kind}`}>
                <span className="time">{relativeTime(e.ts)}</span>
                <span className="domain">{e.domain}</span>
                <span className="name">{e.name}</span>
                <span className="reason" title={e.reason}>
                  {e.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer>
        <span>v{browser.runtime.getManifest().version}</span>
        <button type="button" onClick={() => browser.runtime.openOptionsPage()}>
          {t('optionsButton')}
        </button>
      </footer>
      <ConfirmDialog
        open={confirmClearAll}
        title={t('clearAllTitle')}
        message={t('clearAllMessage')}
        confirmLabel={t('clearEverything')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void handleClearAll()}
        onCancel={() => setConfirmClearAll(false)}
      />
    </main>
  );
}
