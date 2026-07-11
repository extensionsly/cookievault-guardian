import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Mock every chrome-touching lib the popup pulls in. clearAllNow is the action
// under test for the danger-zone flow.
const { clearAllNow } = vi.hoisted(() => ({ clearAllNow: vi.fn(async () => 3) }));
vi.mock('../../lib/engine.js', () => ({ clearAllNow }));
vi.mock('../../lib/settings.js', () => ({
  loadRules: vi.fn(async () => []),
  loadSettings: vi.fn(async () => ({
    defaultAction: 'allow',
    protectLogins: true,
    clearSiteData: false,
  })),
  saveRules: vi.fn(async () => {}),
  saveSettings: vi.fn(async () => {}),
}));
vi.mock('../../lib/audit.js', () => ({ readAudit: vi.fn(async () => []) }));
vi.mock('../../lib/site-data.js', () => ({
  hasSiteDataPermission: vi.fn(async () => false),
  requestSiteDataPermission: vi.fn(async () => false),
  removeSiteDataPermission: vi.fn(async () => false),
}));

import { App } from './App.js';

beforeEach(() => clearAllNow.mockClear());
afterEach(cleanup);

describe('Guardian popup', () => {
  it('validates an empty add-rule submission', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Pattern cannot be empty.')).toBeTruthy();
  });

  it('clears all cookies only after confirming the danger dialog', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear all cookies now' }));
    expect(clearAllNow).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Clear everything' }));
    await waitFor(() => expect(clearAllNow).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Cleared 3 cookies.')).toBeTruthy();
  });
});
