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
        main: resolve(__dirname, 'public/index.html'),
        dashboard: resolve(__dirname, 'public/views/dashboard.html'),
        settings: resolve(__dirname, 'public/views/settings.html'),
        'daily-appointments': resolve(__dirname, 'public/views/appointments/daily-appointments.html'),
        'react-shell': resolve(__dirname, 'public/views/patient/react-shell.html'),
        calendar: resolve(__dirname, 'public/views/appointments/calendar.html'),
        'add-patient': resolve(__dirname, 'public/views/patient/add-patient.html'),
        'patient-management': resolve(__dirname, 'public/views/patient-management.html'),
        'grid': resolve(__dirname, 'public/views/patient/grid.html'),
        'send-message': resolve(__dirname, 'public/views/messaging/send-message.html'),
        'send': resolve(__dirname, 'public/views/messaging/send.html'),
        'auth': resolve(__dirname, 'public/views/messaging/auth.html'),
        aligner: resolve(__dirname, 'public/views/aligner.html'),
        visits: resolve(__dirname, 'public/views/visits.html'),
        expenses: resolve(__dirname, 'public/views/expenses.html'),
        statistics: resolve(__dirname, 'public/views/statistics.html')
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
    // Custom middleware to handle SPA routing for React Router apps
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
      },
      // Proxy routes that need Express routing but serve pages through Vite
      '/dashboard': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/dashboard.html'
      },
      '/calendar': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/appointments/calendar.html'
      },
      '/appointments': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/appointments/daily-appointments.html'
      },
      '/settings': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          // For React Router apps, serve the HTML file for all subroutes
          if (req.url.startsWith('/settings')) {
            return '/views/settings.html'
          }
        }
      },
      '/send-message': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/messaging/send-message.html'
      },
      '/send': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/messaging/send.html'
      },
      '/auth': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/messaging/auth.html'
      },
      // React Router apps - serve HTML for all subroutes
      '/aligner': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          if (req.url.startsWith('/aligner')) {
            return '/views/aligner.html'
          }
        }
      },
      // IMPORTANT: More specific routes must come before less specific ones
      '/patient-management': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          if (req.url.startsWith('/patient-management')) {
            return '/views/patient-management.html'
          }
        }
      },
      '/patient': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          if (req.url.startsWith('/patient')) {
            return '/views/patient/react-shell.html'
          }
        }
      },
      '/expenses': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/expenses.html'
      },
      '/statistics': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/statistics.html'
      }
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