import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { visualizer } from 'rollup-plugin-visualizer'
import { resolve } from 'path'
import { realpathSync } from 'fs'

export default defineConfig(({ mode }) => {
  // Load env file based on mode (development, production, etc.)
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:3001';

  // Canonicalize the project root to its real on-disk casing. On Windows the
  // shell's cwd casing (e.g. C:\shwnodapp-dolphin) can differ from the true
  // directory name (C:\ShwNodApp-dolphin). Vite resolves served files via the
  // realpath (canonical) casing but compares against `config.root` with a
  // CASE-SENSITIVE String.replace when stripping the root prefix for its
  // html-inline-proxy cache. A mismatch breaks that strip and throws
  // "No matching HTML proxy module found". Deriving every path from the
  // realpath keeps root/input/aliases consistent with how Vite sees the files.
  const projectRoot = realpathSync.native(__dirname);
  const publicRoot = resolve(projectRoot, 'public');

  // App-wide runtime, in two long-cached eager chunks. Both match EXACT package
  // directories on purpose: the old `id.includes('react')` was a substring test
  // that also swept the route-only libs (react-select, react-easy-crop,
  // react-imask/imask, @tanstack/react-virtual) into the eager bundle.
  //
  // VENDOR_REACT is React itself: what BOTH entry points run (the staff SPA and
  // the Patient Portal). VENDOR_APP is the rest of the staff app's runtime (the
  // router, React Query, i18n), which the portal never imports. They were one
  // chunk, so a patient's phone downloaded 164 kB of router, query cache and
  // i18n to show a sign-in form (audit FE-F26-6). Keep both lists to deps the
  // first paint of any route needs.
  const VENDOR_REACT =
    /[\\/]node_modules[\\/](?:react|react-dom|react-is|scheduler|use-sync-external-store)[\\/]/;
  const VENDOR_APP =
    /[\\/]node_modules[\\/](?:react-router|react-router-dom|@tanstack[\\/](?:react-query|query-core)|react-i18next|i18next)[\\/]/;

  return {
  // Define environment variables to expose to the client
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
  },
  plugins: [
    react({
      // TypeScript React files
      include: /\.(tsx|ts)$/,
    }),
    // React Compiler (automatic memoization for every component and hook).
    // plugin-react v6 has NO `babel` option: the compiler runs through
    // @rolldown/plugin-babel + `reactCompilerPreset()`. The v5-style
    // `react({ babel: { plugins: [...] } })` this replaced was silently
    // ignored from the Vite 8 upgrade (2026-06-01) until 2026-10-05 — a JS
    // config, so no type error, and the app just ran unmemoized (FE-F26-1).
    // `npm run check:compiler` fails the gate if the build stops carrying the
    // compiler's output.
    babel({ presets: [reactCompilerPreset()] }),
    // Bundle treemap, opt-in via `npm run build:analyze` (sets ANALYZE=true).
    // Writes dist/stats.html so we can see what actually ships (per-module sizes
    // for every chunk). No cost on a normal `npm run build`.
    process.env.ANALYZE === 'true' &&
      visualizer({
        filename: resolve(projectRoot, 'dist/stats.html'),
        template: 'treemap',
        gzipSize: true,
        brotliSize: true,
        open: false, // don't spawn a browser (this host is also prod/headless)
      }),
  ].filter(Boolean),
  root: publicRoot,
  publicDir: false, // Disable - Express serves static files in production
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // 'hidden' emits .map files for every chunk but omits the
    // `//# sourceMappingURL=` comment, so browsers don't auto-fetch them and
    // they aren't advertised — yet a prod error stack can still be un-minified
    // against the map when debugging. Without this, prod stacks are unreadable.
    sourcemap: 'hidden',
    rollupOptions: {
      input: {
        // Main staff-facing SPA
        main: resolve(publicRoot, 'index.html'),
        // Patient portal SPA (separate bundle, own auth, mobile-first)
        portal: resolve(publicRoot, 'portal.html'),
      },
      output: {
        // Chunk groups. Anything not named here is auto-chunked by Rolldown, so
        // route-only deps ride with the lazy route that imports them (GrapesJS
        // stays an on-demand chunk of the template designer), and there is no
        // catch-all vendor chunk (one caused circular-dependency "Cannot access
        // before initialization" errors).
        //
        // `priority` is load-bearing. A group also takes the dependencies of the
        // modules it matches, so without it the router's group swallowed `react`
        // itself (the router imports it) and the portal still downloaded the
        // whole staff runtime. The higher priority claims its modules first.
        // This is why the groups are `codeSplitting`, not a `manualChunks`
        // function: that form has no priority.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: VENDOR_REACT, priority: 30 },
            { name: 'vendor-app', test: VENDOR_APP, priority: 20 },
            // Chart.js: only the lazy Statistics route imports it, so this
            // chunk loads on demand with that route.
            { name: 'vendor-charts', test: /[\\/]node_modules[\\/]chart\.js[\\/]/, priority: 10 },
          ],
        },
      }
    }
  },
  server: {
    port: parseInt(env.VITE_DEV_PORT || '5173'),
    host: true,
    open: true,
    fs: {
      strict: false
    },
    // SPA mode: All routes serve the same HTML file
    middlewareMode: false,
    proxy: {
      // Proxy API and data routes to Express server
      // Target loaded from .env.development or defaults to 3001
      '/api': {
        target: apiUrl,
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: apiUrl,
        changeOrigin: true
      },
      '/DolImgs': {
        target: apiUrl,
        changeOrigin: true
      },
      '/data': {
        target: apiUrl,
        changeOrigin: true
      }
    },
    // SPA history fallback - serve index.html for all routes
    historyApiFallback: {
      rewrites: [
        { from: /^\/portal/, to: '/portal.html' },
        { from: /^\/dashboard/, to: '/index.html' },
        { from: /^\/patient/, to: '/index.html' },
        { from: /^\/expenses/, to: '/index.html' },
        { from: /^\/send/, to: '/index.html' },
        { from: /^\/auth/, to: '/index.html' },
        { from: /^\/aligner/, to: '/index.html' },
        { from: /^\/settings/, to: '/index.html' },
        { from: /^\/templates/, to: '/index.html' },
        { from: /^\/appointments/, to: '/index.html' },
        { from: /^\/calendar/, to: '/index.html' },
        { from: /^\/statistics/, to: '/index.html' },
        { from: /^\/patient-management/, to: '/index.html' },
      ]
    }
  },
  resolve: {
    alias: {
      '@': resolve(publicRoot, 'js'),
      '@components': resolve(publicRoot, 'js/components'),
      '@services': resolve(publicRoot, 'js/services'),
      // Shared API contracts (shared/contracts/*) + Zod primitives (shared/validation.ts),
      // imported by both the React bundle (this alias) and the Express routes (relative .js).
      '@shared': resolve(projectRoot, 'shared')
    }
  },
  optimizeDeps: {
    // Pre-bundle React dependencies for faster dev server startup
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
    exclude: ['grapesjs']
  }
};
});