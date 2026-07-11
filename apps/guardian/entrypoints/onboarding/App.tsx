import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n.js';
import { LINKS } from '../../lib/links.js';
import { loadSettings, saveSettings, type Settings } from '../../lib/settings.js';

type Choice = 'clean-on-close' | 'allow';

const ShieldIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
  </svg>
);

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const choice: Choice = settings?.defaultAction === 'allow' ? 'allow' : 'clean-on-close';

  const pick = useCallback(
    async (c: Choice) => {
      if (!settings) return;
      const next: Settings = { ...settings, defaultAction: c };
      await saveSettings(next);
      setSettings(next);
    },
    [settings],
  );

  const goNext = () => (step < 2 ? setStep(step + 1) : setDone(true));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  return (
    <main className="ob">
      <div className="ob-shell">
        <header className="ob-banner">
          <span className="ob-banner-logo">
            <ShieldIcon />
          </span>
          <span className="ob-banner-title">{t('appName')}</span>
          <span className="ob-spacer" />
          <div className="ob-dots" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`ob-dot ${!done && step === i ? 'active' : done || step > i ? 'past' : ''}`}
              />
            ))}
          </div>
        </header>

        <div className="ob-body">
          {done ? (
            <div className="ob-final">
              <div className="ob-check">✓</div>
              <h1>{t('obDoneTitle')}</h1>
              <p className="ob-lede">{t('obDonePin')}</p>
            </div>
          ) : step === 0 ? (
            <div className="ob-step">
              <h1>{t('obWelcome')}</h1>
              <p className="ob-lede">{t('obLede')}</p>
              <div className="ob-cols">
                <div className="ob-card ok">
                  <div className="ob-card-title">{t('obWhatDoes')}</div>
                  <ul className="ob-list ok">
                    <li>{t('obDoes1')}</li>
                    <li>{t('obDoes2')}</li>
                    <li>{t('obDoes3')}</li>
                    <li>{t('obDoes4')}</li>
                  </ul>
                </div>
                <div className="ob-card no">
                  <div className="ob-card-title">{t('obWhatNever')}</div>
                  <ul className="ob-list no">
                    <li>{t('obNever1')}</li>
                    <li>{t('obNever2')}</li>
                    <li>{t('obNever3')}</li>
                    <li>{t('obNever4')}</li>
                  </ul>
                </div>
              </div>
            </div>
          ) : step === 1 ? (
            <div className="ob-step">
              <h1>{t('obPickHeading')}</h1>
              <p className="ob-lede">{t('obPickLede')}</p>
              <div className="ob-choices">
                <button
                  type="button"
                  className={`ob-choice ${choice === 'clean-on-close' ? 'selected' : ''}`}
                  disabled={!settings}
                  onClick={() => void pick('clean-on-close')}
                >
                  <span className="ob-radio" aria-hidden="true" />
                  <span className="ob-choice-body">
                    <span className="ob-choice-head">
                      <span className="ob-choice-title">{t('obChoiceCleanTitle')}</span>
                      <span className="ob-rec">{t('recommended')}</span>
                    </span>
                    <span className="ob-choice-sub">{t('obChoiceCleanSub')}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`ob-choice ${choice === 'allow' ? 'selected' : ''}`}
                  disabled={!settings}
                  onClick={() => void pick('allow')}
                >
                  <span className="ob-radio" aria-hidden="true" />
                  <span className="ob-choice-body">
                    <span className="ob-choice-title">{t('obChoiceSafeTitle')}</span>
                    <span className="ob-choice-sub">{t('obChoiceSafeSub')}</span>
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="ob-step ob-protected">
              <div className="ob-shield-badge">
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <h1>{t('obProtectedTitle')}</h1>
              <p className="ob-lede">{t('obProtectedLede')}</p>
              <div className="ob-summary">
                <span>{t('obDefaultBehaviorLabel')}</span>
                <span className={`ob-badge ${choice === 'clean-on-close' ? 'warn' : 'ok'}`}>
                  {choice === 'clean-on-close' ? t('actionCleanOnClose') : t('actionAllow')}
                </span>
              </div>
              <div className="ob-links">
                <a href={LINKS.repo} target="_blank" rel="noopener noreferrer">
                  {t('linkSource')}
                </a>
                <a href={LINKS.pledge} target="_blank" rel="noopener noreferrer">
                  {t('linkPledge')}
                </a>
                <a href={LINKS.verifyBuild} target="_blank" rel="noopener noreferrer">
                  {t('linkVerify')}
                </a>
              </div>
            </div>
          )}
        </div>

        {!done ? (
          <footer className="ob-foot">
            {step > 0 ? (
              <button type="button" className="ob-back" onClick={goBack}>
                ‹ {t('obNavBack')}
              </button>
            ) : null}
            <span className="ob-spacer" />
            <span className="ob-progress">{t('obStepProgress', [String(step + 1), '3'])}</span>
            <button type="button" className="ob-next" onClick={goNext}>
              {step === 2 ? t('obNavGetStarted') : t('obNavContinue')} ▸
            </button>
          </footer>
        ) : null}
      </div>
    </main>
  );
}
