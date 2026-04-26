import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    // Dev-only: proxy /api to the server container so same-origin <img>
    // requests for /api/renders/... carry the session cookie. In the docker
    // compose dev stack the server is reachable as "server:3001"; outside
    // docker, fall back to localhost.
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://server:3001',
        changeOrigin: true,
      },
    },
  },
})
