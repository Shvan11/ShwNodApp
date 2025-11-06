import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Custom plugin to handle plain JS/MJS files without JSX transformation
function skipReactForPlainJS() {
  return {
    name: 'skip-react-for-plain-js',
    enforce: 'pre', // Run before other plugins

    async transform(code, id) {
      // Only process our own .js and .mjs files (not node_modules, not .jsx/.tsx)
      if (/\.(js|mjs)$/.test(id) && !/node_modules/.test(id) && !id.includes('.jsx') && !id.includes('.tsx')) {
        // Return code with explicit marker that this is NOT JSX
        // This prevents import-analysis from trying to parse as JSX
        return {
          code: code,
          map: null,
          // Mark as already transformed to skip further JSX processing
          meta: {
            'skip-jsx': true
          }
        }
      }
    }
  }
}

export default defineConfig({
  plugins: [
    // Temporarily disable React plugin to test
    // skipReactForPlainJS(),
    // react({
    //   // Only include .jsx and .tsx files
    //   include: /\.(jsx|tsx)$/,
    // })
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
        alignerportal: resolve(__dirname, 'public/views/alignerportal.html'),
        visits: resolve(__dirname, 'public/views/visits.html'),
        expenses: resolve(__dirname, 'public/views/expenses.html')
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
      // React Router apps - handle all subroutes
      '/aligner': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          // For React Router apps, serve the HTML file for all subroutes
          if (req.url.startsWith('/aligner')) {
            return '/views/aligner.html'
          }
        }
      },
      '/portal': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          // For React Router apps, serve the HTML file for all subroutes
          if (req.url.startsWith('/portal')) {
            return '/views/alignerportal.html'
          }
        }
      },
      '/patient-management': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/patient-management.html'
      },
      '/expenses': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/expenses.html'
      },
      // Patient routes - React Router app, serve HTML for all subroutes
      '/patient': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        bypass: (req) => {
          // For React Router apps, serve the HTML file for all subroutes
          if (req.url.startsWith('/patient')) {
            return '/views/patient/react-shell.html'
          }
        }
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