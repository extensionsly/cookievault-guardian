import { defineConfig } from 'vitest/config';

// jsdom so we can render the popup component alongside the pure-logic engine
// tests (which run fine under jsdom too). Collaborators are mocked, so no real
// browser is needed.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['lib/**/*.test.ts', 'entrypoints/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
