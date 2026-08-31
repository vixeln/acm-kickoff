import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { getLanUrls } from './lan.ts'

function installNetworkInfoMiddleware(
  middlewares: { use(path: string, handler: (_request: unknown, response: import('node:http').ServerResponse) => void): void },
  port: number,
) {
  middlewares.use('/api/network-info', (_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ urls: getLanUrls(port, '/login') }))
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    {
      name: 'lan-network-info',
      configureServer(server) {
        installNetworkInfoMiddleware(server.middlewares, server.config.server.port)
      },
      configurePreviewServer(server) {
        installNetworkInfoMiddleware(server.middlewares, server.config.preview.port)
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
})
