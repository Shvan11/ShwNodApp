import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit-test runner for the frontend infrastructure modules (core/http funnel,
 * router/loader-cache). Tests live next to their module as `*.test.ts` under
 * public/js. Playwright owns e2e/ — keep the two runners out of each other's
 * globs.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['public/js/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', 'e2e/**', 'dist/**', 'dist-server/**'],
  },
  resolve: {
    // Mirror tsconfig.frontend.json so tests import modules the way app code does.
    alias: {
      '@': fileURLToPath(new URL('./public/js', import.meta.url)),
      '@components': fileURLToPath(new URL('./public/js/components', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./public/js/hooks', import.meta.url)),
      '@contexts': fileURLToPath(new URL('./public/js/contexts', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
});
