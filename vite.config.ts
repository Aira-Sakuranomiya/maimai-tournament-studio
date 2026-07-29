import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/socket.io': { target: 'http://127.0.0.1:8787', ws: true },
      '/uploads': 'http://127.0.0.1:8787',
      '/cache': 'http://127.0.0.1:8787'
    }
  },
  test: {
    environment: 'node',
    api: false,
    include: ['src/**/*.test.ts']
  }
})
