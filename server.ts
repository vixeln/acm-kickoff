import { join, normalize, sep } from 'node:path'

import { getLanUrls } from './lan'

type SocketData = {
  playerId?: string
  sessionId?: string
  role?: 'host' | 'player'
  isHostMachine: boolean
}

const port = Number(Bun.env.PORT ?? 8080)
const publicDirectory = join(import.meta.dir, 'dist')
const networkAddresses = getLanUrls(port)

const server = Bun.serve<SocketData>({
  hostname: '0.0.0.0',
  port,

  async fetch(request, bunServer) {
    const url = new URL(request.url)

    if (url.pathname === '/api/network-info') {
      return Response.json(
        { urls: getLanUrls(server.port, '/login') },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (url.pathname === '/ws') {
      const address = bunServer.requestIP(request)?.address
      const isHostMachine = address === '127.0.0.1' || address === '::1'

      if (bunServer.upgrade(request, { data: { isHostMachine } })) return

      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const filePath = normalize(join(publicDirectory, requestedPath))

    if (filePath === publicDirectory || filePath.startsWith(`${publicDirectory}${sep}`)) {
      const file = Bun.file(filePath)
      if (await file.exists()) return new Response(file)
    }

    // Vue Router handles application routes such as /login and /host.
    const index = Bun.file(join(publicDirectory, 'index.html'))
    if (await index.exists()) return new Response(index)

    return new Response('Build not found. Run `bun run build` first.', { status: 503 })
  },

  websocket: {
    open(socket) {
      console.log('connected', socket.data)
    },
    message(_socket, message) {
      console.log('message:', message)
    },
    close() {
      console.log('disconnected')
    },
  },
})

console.log(`Draw is available locally at http://localhost:${server.port}`)
for (const address of networkAddresses) console.log(`Draw is available on your network at ${address}`)
