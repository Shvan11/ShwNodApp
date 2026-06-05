import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
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

  return {
  // Define environment variables to expose to the client
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
  },
  plugins: [
    react({
      // TypeScript React files
      include: /\.(tsx|ts)$/,
      babel: {
        plugins: [
          ['babel-plugin-react-compiler', {
            // React Compiler configuration
            // Enables automatic memoization for all React components and hooks
            runtimeModule: 'react/compiler-runtime'
          }]
        ]
      }
    })
  ],
  root: publicRoot,
  publicDir: false, // Disable - Express serves static files in production
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Main staff-facing SPA
        main: resolve(publicRoot, 'index.html'),
        // Patient portal SPA (separate bundle, own auth, mobile-first)
        portal: resolve(publicRoot, 'portal.html'),
      },
      output: {
        // Optimal code splitting strategy for production
        manualChunks(id) {
          // React and core libraries (cached separately)
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor-react';
            }

            // GrapesJS - DO NOT bundle, let it stay as dynamic import chunk
            // This allows it to be loaded only when TemplateDesigner component mounts
            if (id.includes('grapesjs')) {
              return; // Return undefined to let Rollup handle it as dynamic chunk
            }

            // Chart libraries (used in Statistics route)
            if (id.includes('chart.js') || id.includes('recharts')) {
              return 'vendor-charts';
            }

            // Let Vite auto-chunk remaining modules (prevents circular dependency errors)
            // Previously: return 'vendor-other' - caused "Cannot access before initialization" errors
          }
        }
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
      // Public SSE for chair-display kiosk (no auth, separate from /api).
      // http-proxy passes chunked text/event-stream transparently.
      '/sse': {
        target: apiUrl,
        changeOrigin: true
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