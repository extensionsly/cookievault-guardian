import { browser } from 'wxt/browser';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@cookievault/ui';
import { t, LOCALES, getStoredLocale, setLocale } from '../../lib/i18n.js';
import { LINKS } from '../../lib/links.js';

/**
 * Manual language picker (design spec §4.3). "System" follows the browser
 * language; any other choice is stored and overrides it. Changing it reloads
 * so the i18n layer re-initialises with the new locale.
 */
function LanguageSelect() {
  const [locale, setLoc] = useState<string>('system');
  useEffect(() => {
    void getStoredLocale().then((v) => setLoc(v ?? 'system'));
  }, []);
  return (
    <select
      className="lang-select"
      aria-label={t('prefLanguage')}
      value={locale}
      onChange={(e) => {
        const next = e.target.value;
        setLoc(next);
        void setLocale(next).then(() => location.reload());
      }}
    >
      <option value="system">{t('langSystem')}</option>
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export function App() {
  return (
    <main className="opt">
      <header className="opt-hero">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h1>{t('appName')}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LanguageSelect />
            <ThemeToggle label={t('themeToggle')} />
          </div>
        </div>
        <p className="lede">{t('optHeroDesc')}</p>
      </header>

      <section className="opt-card">
        <h2>{t('obTrustHeading')}</h2>
        <ul className="pillars">
          <li>
            <strong>{t('optPillar1Lead')}</strong> {t('optPillar1Rest')}
          </li>
          <li>
            <strong>{t('optPillar2Lead')}</strong> {t('optPillar2Rest')}
          </li>
          <li>
            <strong>{t('optPillar3Lead')}</strong> {t('optPillar3Rest')}
          </li>
        </ul>
      </section>

      <section className="opt-card">
        <h2>{t('optVerifyHeading')}</h2>
        <p>{t('optVerifyDesc')}</p>
        <div className="opt-links">
          <a href={LINKS.verifyBuild} target="_blank" rel="noopener noreferrer">
            {t('linkVerify')}
          </a>
          <a href={LINKS.repo} target="_blank" rel="noopener noreferrer">
            {t('linkSource')}
          </a>
          <a href={LINKS.pledge} target="_blank" rel="noopener noreferrer">
            {t('linkPledge')}
          </a>
        </div>
      </section>

      <section className="opt-card">
        <h2>{t('optSettingsHeading')}</h2>
        <p className="muted">
          {t('optSettingsPre')} <strong>{t('appName')}</strong> {t('optSettingsPost')}
        </p>
        <p>
          <a
            href={browser.runtime.getURL('/onboarding.html')}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('optReplayGuide')}
          </a>
        </p>
      </section>
    </main>
  );
}
