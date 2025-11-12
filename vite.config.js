import { defineConfig } from 'vite'
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

export default defineConfig({
  plugins: [
    templateDesignerPlugin(), // Handle template-designer specifically
    react({
      // Include all typical React file extensions
      include: /\.(jsx|tsx|js|ts)$/,
    })
  ],
  root: 'public',
  publicDir: 'assets',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Single entry point for the entire SPA
        main: resolve(__dirname, 'public/index-spa.html'),
      },
      output: {
        // Code splitting by app for optimal loading
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          'single-spa': ['single-spa', 'single-spa-react'],
        }
      }
    }
  },
  server: {
    port: 5173,
    host: true,
    open: true,
    fs: {
      strict: false
    },
    // Single-SPA mode: All routes serve the same HTML file
    middlewareMode: false,
    proxy: {
      // Proxy API and data routes to Express server
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/DolImgs': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/data': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    },
    // SPA history fallback - serve index-spa.html for all routes
    historyApiFallback: {
      rewrites: [
        { from: /^\/dashboard/, to: '/index-spa.html' },
        { from: /^\/patient/, to: '/index-spa.html' },
        { from: /^\/expenses/, to: '/index-spa.html' },
        { from: /^\/send/, to: '/index-spa.html' },
        { from: /^\/auth/, to: '/index-spa.html' },
        { from: /^\/aligner/, to: '/index-spa.html' },
        { from: /^\/settings/, to: '/index-spa.html' },
        { from: /^\/templates/, to: '/index-spa.html' },
        { from: /^\/appointments/, to: '/index-spa.html' },
        { from: /^\/calendar/, to: '/index-spa.html' },
        { from: /^\/statistics/, to: '/index-spa.html' },
        { from: /^\/patient-management/, to: '/index-spa.html' },
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
    include: ['react', 'react-dom'],
    exclude: ['grapesjs', 'grapesjs-preset-newsletter']
  }
})