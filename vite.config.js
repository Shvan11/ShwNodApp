import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
  // Load env file based on mode (development, production, etc.)
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:3001';

  return {
  // Define environment variables to expose to the client
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
  },
  plugins: [
    react({
      // Include all typical React file extensions
      include: /\.(jsx|tsx|js|ts)$/,
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
  root: 'public',
  publicDir: false, // Disable - Express serves static files in production
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Single entry point for the entire SPA
        main: resolve(__dirname, 'public/index.html'),
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

            // Date/time utilities
            if (id.includes('date-fns')) {
              return 'vendor-utils';
            }

            // HTTP clients
            if (id.includes('axios')) {
              return 'vendor-utils';
            }

            // Let Vite auto-chunk remaining modules (prevents circular dependency errors)
            // Previously: return 'vendor-other' - caused "Cannot access before initialization" errors
          }
        }
      }
    }
  },
  server: {
    port: parseInt(process.env.VITE_DEV_PORT || '5173'),
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
      '@': resolve(__dirname, 'public/js'),
      '@components': resolve(__dirname, 'public/js/components'),
      '@services': resolve(__dirname, 'public/js/services')
    }
  },
  optimizeDeps: {
    // Pre-bundle React dependencies for faster dev server startup
    include: ['react', 'react-dom', 'react-dom/client', 'react-router-dom', 'date-fns', 'axios'],
    exclude: ['grapesjs', 'grapesjs-preset-newsletter']
  }
};
});