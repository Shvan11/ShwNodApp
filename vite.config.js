import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { transformSync } from 'esbuild'

// Custom plugin to handle template-designer specifically
function templateDesignerPlugin() {
  return {
    name: 'template-designer-handler',
    enforce: 'pre',

    async load(id) {
      // Only process the specific template-designer file
      if (id.endsWith('template-designer.mjs') || id.endsWith('pages/template-designer.js')) {
        const code = readFileSync(id, 'utf-8')

        // Pre-transform to prevent JSX detection
        const result = transformSync(code, {
          loader: 'js',
          format: 'esm',
          target: 'es2020',
          jsx: 'preserve', // Don't transform JSX-like syntax
        })

        return {
          code: result.code,
          map: null
        }
      }
      // Return null to let other plugins handle other files normally
      return null
    }
  }
}

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
    templateDesignerPlugin(), // Handle template-designer specifically
    react({
      // Include all typical React file extensions
      include: /\.(jsx|tsx|js|ts)$/,
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
        manualChunks: {
          // Vendor chunk: React and core libraries (cached separately)
          'vendor-react': ['react', 'react-dom', 'react-dom/client', 'react-router-dom'],
          // Utils chunk: Utility libraries
          'vendor-utils': ['date-fns', 'axios']
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