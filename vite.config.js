import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
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
        search: resolve(__dirname, 'public/views/patient/search.html'),
        'add-patient': resolve(__dirname, 'public/views/patient/add-patient.html'),
        'grid': resolve(__dirname, 'public/views/patient/grid_.html'),
        'send-message': resolve(__dirname, 'public/views/messaging/send-message.html'),
        'send': resolve(__dirname, 'public/views/messaging/send.html'),
        'auth': resolve(__dirname, 'public/views/messaging/auth.html'),
        aligner: resolve(__dirname, 'public/views/aligner.html'),
        alignerportal: resolve(__dirname, 'public/views/alignerportal.html'),
        visits: resolve(__dirname, 'public/views/visits.html')
      }
    }
  },
  server: {
    port: 5173,
    host: true,
    open: true,
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
      '/search': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/patient/search.html'
      },
      '/settings': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/settings.html'
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
      '/aligner': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/aligner.html'
      },
      '/portal': {
        target: 'http://localhost:5173',
        changeOrigin: true,
        rewrite: (path) => '/views/alignerportal.html'
      },
      // Patient routes need Express for dynamic handling
      '/patient': {
        target: 'http://localhost:3000',
        changeOrigin: true
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
    include: ['react', 'react-dom']
  }
})