import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { getLanUrls } from './lan.ts'
import {
  addGuess,
  createRoom,
  deleteRoom,
  getAllGuesses,
  getDrawingState,
  getPlayerGuesses,
  getRoom,
  getHostRoom,
  joinRoom,
  setDrawingPreview,
  setDrawingState,
  setGameSettings,
  startGame,
  beginRound,
  chooseWord,
  advanceGame,
  setWordPool,
  setSecretWord,
} from './room-session.ts'
import type { DrawingAction } from './src/types/drawing'

type DevDrawingClient = { socket: Socket; role: 'host' | 'display'; roomCode: string; buffer: Buffer }
const devDrawingSockets = new Map<string, Set<DevDrawingClient>>()

function sendDevWebSocket(socket: Socket, payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload))
  const header = body.length < 126
    ? Buffer.from([0x81, body.length])
    : Buffer.concat([Buffer.from([0x81, 126]), Buffer.from([(body.length >> 8) & 255, body.length & 255])])
  socket.write(Buffer.concat([header, body]))
}

function isDevDrawingPayload(value: unknown): value is
  | { type: 'drawing-state'; actions: DrawingAction[]; sequence: number }
  | { type: 'drawing-preview'; action: DrawingAction | null; sequence: number } {
  if (!value || typeof value !== 'object') return false
  const payload = value as { type?: unknown; actions?: unknown; action?: unknown; sequence?: unknown }
  if (typeof payload.sequence !== 'number' || !Number.isInteger(payload.sequence) || payload.sequence < 1) return false
  if (payload.type === 'drawing-state') return Array.isArray(payload.actions)
  return payload.type === 'drawing-preview' && (payload.action === null || typeof payload.action === 'object')
}

function handleDevWebSocketUpgrade(request: IncomingMessage, socket: Socket) {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost')
  if (requestUrl.pathname !== '/ws') return false
  const role = requestUrl.searchParams.get('role')
  const roomCode = requestUrl.searchParams.get('room')?.trim().toUpperCase() ?? ''
  if ((role !== 'host' && role !== 'display') || !roomCode || !getRoom(roomCode)) {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
    return true
  }
  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
    return true
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)

  const client: DevDrawingClient = { socket, role, roomCode, buffer: Buffer.alloc(0) }
  const clients = devDrawingSockets.get(roomCode) ?? new Set<DevDrawingClient>()
  clients.add(client)
  devDrawingSockets.set(roomCode, clients)
  if (role === 'display') {
    const state = getDrawingState(roomCode)
    if (state) sendDevWebSocket(socket, { type: 'drawing-state', ...state, sequence: 0 })
  }

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk])
    while (client.buffer.length >= 2) {
      const first = client.buffer[0] ?? 0
      const second = client.buffer[1] ?? 0
      const masked = Boolean(second & 0x80)
      let length = second & 0x7f
      let offset = 2
      if (length === 126) {
        if (client.buffer.length < 4) return
        length = client.buffer.readUInt16BE(2)
        offset = 4
      }
      if (!masked || length > 1_000_000 || client.buffer.length < offset + 4 + length) return
      const mask = client.buffer.subarray(offset, offset + 4)
      offset += 4
      const data = Buffer.alloc(length)
      for (let index = 0; index < length; index += 1) data[index] = (client.buffer[offset + index] ?? 0) ^ (mask[index % 4] ?? 0)
      client.buffer = client.buffer.subarray(offset + length)
      if ((first & 0x0f) === 8) {
        socket.end()
        return
      }
      if ((first & 0x0f) !== 1 || client.role !== 'host') continue
      let payload: unknown
      try { payload = JSON.parse(data.toString()) } catch { continue }
      if (!isDevDrawingPayload(payload)) continue
      if (payload.type === 'drawing-state') setDrawingState(roomCode, payload.actions)
      else setDrawingPreview(roomCode, payload.action)
      for (const peer of clients) {
        if (peer.role === 'display') sendDevWebSocket(peer.socket, payload.type === 'drawing-state'
          ? { type: 'drawing-state', actions: payload.actions, preview: null, sequence: payload.sequence }
          : payload)
      }
    }
  })
  socket.on('close', () => {
    clients.delete(client)
    if (!clients.size) devDrawingSockets.delete(roomCode)
  })
  socket.on('error', () => socket.destroy())
  return true
}

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
    const gameMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/game$/i)
    const startGameMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/game\/start$/i)
    const beginRoundMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/game\/begin-round$/i)
    const chooseWordMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/game\/choose-word$/i)
    const wordPoolMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/game\/pool$/i)
    const hostStateMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/host-state$/i)
    const secretWordMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/secret-word$/i)
    const advanceGameMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/game\/advance$/i)
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
    if (request.method === 'GET' && hostStateMatch) {
      const room = getHostRoom(hostStateMatch[1])
      send(room ? 200 : 404, room ? { room } : { error: 'That room does not exist.' })
      return
    }
    if (request.method === 'PUT' && secretWordMatch) {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { secretWord?: unknown }
          const result = setSecretWord(secretWordMatch[1], typeof parsed.secretWord === 'string' ? parsed.secretWord : '')
          send('error' in result ? 400 : 200, result)
        } catch { send(400, { error: 'Invalid request.' }) }
      })
      return
    }
    if (request.method === 'PUT' && gameMatch) {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { drawingTime?: unknown; rounds?: unknown; wordPickTime?: unknown }
          const result = setGameSettings(gameMatch[1], {
            drawingTime: Number(parsed.drawingTime),
            rounds: Number(parsed.rounds),
            wordPickTime: Number(parsed.wordPickTime),
          })
          send('error' in result ? 400 : 200, 'error' in result ? { error: result.error } : result)
        } catch {
          send(400, { error: 'Invalid request.' })
        }
      })
      return
    }
    if (request.method === 'POST' && startGameMatch) {
      const result = startGame(startGameMatch[1])
      send('error' in result ? 400 : 200, result)
      return
    }
    if (request.method === 'POST' && beginRoundMatch) {
      const result = beginRound(beginRoundMatch[1])
      send('error' in result ? 400 : 200, result)
      return
    }
    if (request.method === 'POST' && chooseWordMatch) {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { word?: unknown }
          const result = chooseWord(chooseWordMatch[1], typeof parsed.word === 'string' ? parsed.word : '')
          send('error' in result ? 400 : 200, result)
        } catch { send(400, { error: 'Invalid request.' }) }
      })
      return
    }
    if (request.method === 'PUT' && wordPoolMatch) {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { words?: unknown }
          const words = Array.isArray(parsed.words) ? parsed.words.filter((word): word is string => typeof word === 'string') : []
          const result = setWordPool(wordPoolMatch[1], words)
          send('error' in result ? 400 : 200, result)
        } catch { send(400, { error: 'Invalid request.' }) }
      })
      return
    }
    if (request.method === 'POST' && advanceGameMatch) {
      const result = advanceGame(advanceGameMatch[1])
      send('error' in result ? 400 : 200, result)
      return
    }
    const endRoomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)$/i)
    if (request.method === 'DELETE' && endRoomMatch) {
      const ended = deleteRoom(endRoomMatch[1])
      send(ended ? 200 : 404, ended ? { ended: true } : { error: 'That room does not exist.' })
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
      if (query.get('role') !== 'host' && !getRoom(code)) {
        send(404, { error: 'That room does not exist.' })
        return
      }
      const guesses = query.get('role') === 'host'
        ? getAllGuesses(code)
        : getPlayerGuesses(code, query.get('player') ?? '', query.get('token') ?? '')
      send(guesses ? 200 : 403, guesses ? { guesses } : { error: 'That player is not in the room.' })
      return
    }
    if (request.method === 'POST' && guessesMatch) {
      if (!getRoom(guessesMatch[1])) {
        send(404, { error: 'That room does not exist.' })
        return
      }
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
        server.httpServer?.on('upgrade', (request, socket) => {
          handleDevWebSocketUpgrade(request, socket)
        })
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
