import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const apiProxy = {
  target: 'http://127.0.0.1:8000',
  changeOrigin: true,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    target: ['chrome64', 'edge79', 'firefox67', 'safari12'],
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        promptWorkspace: resolve(__dirname, 'prompt-workspace.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5174,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
    proxy: {
      '/api': apiProxy,
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5174,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
    proxy: {
      '/api': apiProxy,
    },
  },
})
