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
        'daily-appointments': resolve(__dirname, 'public/views/appointments/daily-appointments.html'),
        'react-shell': resolve(__dirname, 'public/views/patient/react-shell.html'),
        calendar: resolve(__dirname, 'public/views/appointments/calendar.html'),
        search: resolve(__dirname, 'public/views/patient/search.html'),
        'add-patient': resolve(__dirname, 'public/views/patient/add-patient.html'),
        'grid': resolve(__dirname, 'public/views/patient/grid_.html')
      }
    }
  },
  server: {
    port: 5173,
    host: true,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/DolImgs': {
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