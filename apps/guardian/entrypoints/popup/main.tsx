import { initTheme, mountApp } from '@cookievault/ui';
import { initI18n } from '../../lib/i18n.js';
import { logError, reportUrl } from '../../lib/errlog.js';
import { App } from './App.js';

initTheme();

// See resilience.md §1: mountApp gives every entrypoint white-screen
// prevention + local error logging. Locale fetch failure is logged and
// swallowed so English still renders (matches the old .finally).
void mountApp({
  rootId: 'root',
  app: <App />,
  prepare: async () => {
    await initI18n().catch((e) => logError(e, 'initI18n'));
  },
  onError: (err, ctx) => void logError(err, ctx),
  screen: {
    title: 'Something went wrong',
    body: 'The controls failed to load. Reload usually fixes it — your rules and cleanup keep running.',
    retryLabel: 'Reload',
    reportLabel: 'Report a problem',
    reportHref: reportUrl(),
  },
});
