import { fileURLToPath, URL } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { getLanUrls } from './lan.ts'
import { addGuess, createRoom, getAllGuesses, getPlayerGuesses, getRoom, joinRoom } from './room-session.ts'

/**
 * Emulates the Bun endpoints required by HostView while Vite owns the development server.
 *
 * Development host access is intentionally granted without a password. Production authorization
 * remains exclusively implemented by the Bun server and is exercised with `bun run serve`.
 */
function installNetworkInfoMiddleware(
  middlewares: { use(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void): void },
  port: number,
) {
  middlewares.use('/api/network-info', (_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ urls: getLanUrls(port, '/login') }))
  })

  middlewares.use('/api/host/status', (_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify({ authenticated: true, configured: true }))
  })

  middlewares.use('/api/rooms', (request, response) => {
    const mountedPath = new URL(request.url ?? '/', 'http://localhost').pathname
    const path = mountedPath.startsWith('/api/rooms')
      ? mountedPath
      : `/api/rooms${mountedPath === '/' ? '' : mountedPath}`
    const roomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)$/i)
    const joinMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/players$/i)
    const guessesMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/guesses$/i)
    const send = (status: number, data: unknown) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify(data))
    }

    if (request.method === 'POST' && path === '/api/rooms') {
      send(201, { room: createRoom() })
      return
    }
    if (request.method === 'GET' && roomMatch) {
      const room = getRoom(roomMatch[1])
      send(room ? 200 : 404, room ? { room } : { error: 'That room does not exist.' })
      return
    }
    if (request.method === 'POST' && joinMatch) {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        let name = ''
        try {
          const parsed = JSON.parse(body) as { name?: unknown }
          if (typeof parsed.name === 'string') name = parsed.name
        } catch {
          send(400, { error: 'Invalid request.' })
          return
        }
        const result = joinRoom(joinMatch[1], name)
        send('error' in result ? 404 : 201, 'error' in result ? { error: result.error } : result)
      })
      return
    }
    if (request.method === 'GET' && guessesMatch) {
      const code = guessesMatch[1]
      const query = new URL(request.url ?? '/', 'http://localhost').searchParams
      const guesses = query.get('role') === 'host'
        ? getAllGuesses(code)
        : getPlayerGuesses(code, query.get('player') ?? '', query.get('token') ?? '')
      send(guesses ? 200 : 403, guesses ? { guesses } : { error: 'That player is not in the room.' })
      return
    }
    if (request.method === 'POST' && guessesMatch) {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { playerId?: unknown; token?: unknown; text?: unknown }
          const result = addGuess(
            guessesMatch[1],
            typeof parsed.playerId === 'string' ? parsed.playerId : '',
            typeof parsed.token === 'string' ? parsed.token : '',
            typeof parsed.text === 'string' ? parsed.text : '',
          )
          send('error' in result ? 400 : 201, result)
        } catch {
          send(400, { error: 'Invalid request.' })
        }
      })
      return
    }
    send(404, { error: 'Not found.' })
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
