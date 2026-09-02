import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { join, normalize, sep } from 'node:path'

import { getLanUrls } from './lan'
import {
  addGuess,
  createRoom,
  getAllGuesses,
  getPlayerGuesses,
  getRoom,
  joinRoom,
  removePlayer,
} from './room-session'

type SocketData = {
  playerId?: string
  sessionId?: string
  role?: 'host' | 'player'
  roomCode?: string
}

type LoginAttempt = {
  attempts: number
  resetAt: number
}

const port = Number(Bun.env.PORT ?? 8080)
const publicDirectory = join(import.meta.dir, 'dist')
const networkAddresses = getLanUrls(port)
const hostPassword = Bun.env.HOST_PASSWORD?.trim() ?? ''
const hostSessionSecret = Bun.env.HOST_SESSION_SECRET?.trim() || hostPassword
const loginAttempts = new Map<string, LoginAttempt>()
const hostSessionDurationSeconds = 12 * 60 * 60
const loginWindowMilliseconds = 15 * 60 * 1000
const maximumLoginAttempts = 5

if (Bun.env.RAILWAY_ENVIRONMENT_ID && !hostPassword) {
  console.warn('HOST_PASSWORD is not configured; public host access will remain locked.')
}

/**
 * Identifies requests originating on the server itself.
 *
 * Loopback is the trust boundary for passwordless local hosting and LAN-address discovery.
 * Proxy headers are deliberately ignored because callers can forge them outside Railway.
 */
function isLoopbackRequest(request: Request, bunServer: Bun.Server<SocketData>) {
  const address = bunServer.requestIP(request)?.address
  return address === '127.0.0.1' || address === '::1'
}

/** Extracts one named value from the request's Cookie header. */
function getCookie(request: Request, name: string) {
  const prefix = `${name}=`
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length)
}

/**
 * Creates the stateless host-session token stored in the host cookie.
 *
 * Only the expiration timestamp is exposed; its HMAC prevents clients from extending it.
 */
function signHostSession(expiresAt: number) {
  const signature = createHmac('sha256', hostSessionSecret).update(String(expiresAt)).digest('hex')
  return `${expiresAt}.${signature}`
}

/**
 * Verifies the stateless host cookie without storing server-side session records.
 *
 * A fixed-length, timing-safe signature comparison avoids leaking useful comparison timing.
 */
function hasValidHostSession(request: Request) {
  if (!hostSessionSecret) return false

  const token = getCookie(request, 'draw_host')
  if (!token) return false

  const [expiresAtValue, suppliedSignature] = token.split('.')
  const expiresAt = Number(expiresAtValue)
  if (!expiresAt || expiresAt <= Date.now() || !suppliedSignature) return false

  const expectedSignature = createHmac('sha256', hostSessionSecret)
    .update(String(expiresAt))
    .digest('hex')
  const suppliedBuffer = Buffer.from(suppliedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

/**
 * Applies the host authorization policy shared by HTTP and WebSocket requests.
 *
 * Localhost stays passwordless when no password is configured. Once a password exists, every
 * host—including localhost—must present a valid signed session.
 */
function isHostAuthorized(request: Request, bunServer: Bun.Server<SocketData>) {
  if (!hostPassword) return isLoopbackRequest(request, bunServer)
  return hasValidHostSession(request)
}

/** Compares passwords as fixed-size hashes so timingSafeEqual can be used safely. */
function passwordsMatch(suppliedPassword: string) {
  const suppliedHash = createHash('sha256').update(suppliedPassword).digest()
  const expectedHash = createHash('sha256').update(hostPassword).digest()
  return timingSafeEqual(suppliedHash, expectedHash)
}

/**
 * Selects the client identifier used by the login throttle.
 *
 * Railway terminates public traffic at a proxy, so its forwarded address takes precedence over
 * Bun's socket peer address. The value is used only for rate limiting, never authentication.
 */
function getClientAddress(request: Request, bunServer: Bun.Server<SocketData>) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    bunServer.requestIP(request)?.address ||
    'unknown'
  )
}

/** Records a failed login in the current process's fixed 15-minute attempt window. */
function recordFailedLogin(address: string) {
  const now = Date.now()
  const current = loginAttempts.get(address)
  const attempt =
    !current || current.resetAt <= now
      ? { attempts: 1, resetAt: now + loginWindowMilliseconds }
      : { ...current, attempts: current.attempts + 1 }

  loginAttempts.set(address, attempt)
}

/**
 * Reports whether an address exhausted its login attempts.
 *
 * Rate limiting is intentionally process-local while the app is restricted to one replica.
 */
function isLoginRateLimited(address: string) {
  const attempt = loginAttempts.get(address)
  if (!attempt) return false
  if (attempt.resetAt <= Date.now()) {
    loginAttempts.delete(address)
    return false
  }
  return attempt.attempts >= maximumLoginAttempts
}

/**
 * Serializes the host session cookie with production-safe browser restrictions.
 *
 * Railway handles TLS before forwarding the request, so X-Forwarded-Proto determines whether
 * the Secure attribute is required. Local HTTP development remains usable without it.
 */
function hostCookie(request: Request, token: string, maxAge = hostSessionDurationSeconds) {
  const forwardedProtocol = request.headers.get('x-forwarded-proto')
  const secure = forwardedProtocol === 'https' || new URL(request.url).protocol === 'https:'
  return `draw_host=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

/** Creates a JSON response that browsers and intermediaries must not cache. */
function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'no-store')
  return Response.json(data, { ...init, headers })
}

const server = Bun.serve<SocketData>({
  hostname: '0.0.0.0',
  port,

  /** Routes API, WebSocket, static-asset, and Vue history-fallback requests. */
  async fetch(request, bunServer) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    if (url.pathname === '/api/network-info') {
      // Railway's container address is private and unusable by players.
      if (!isLoopbackRequest(request, bunServer)) return new Response('Not found', { status: 404 })
      return json({ urls: getLanUrls(server.port, '/login') })
    }

    if (url.pathname === '/api/host/status') {
      return json({
        authenticated: isHostAuthorized(request, bunServer),
        configured: Boolean(hostPassword) || isLoopbackRequest(request, bunServer),
      })
    }

    if (url.pathname === '/api/host/login' && request.method === 'POST') {
      if (!hostPassword) {
        return json({ error: 'Host access is not configured.' }, { status: 503 })
      }

      const clientAddress = getClientAddress(request, bunServer)
      if (isLoginRateLimited(clientAddress)) {
        return json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 })
      }

      let password = ''
      try {
        const body = (await request.json()) as { password?: unknown }
        if (typeof body.password === 'string') password = body.password
      } catch {
        return json({ error: 'Invalid request.' }, { status: 400 })
      }

      if (!passwordsMatch(password)) {
        recordFailedLogin(clientAddress)
        return json({ error: 'Incorrect host password.' }, { status: 401 })
      }

      loginAttempts.delete(clientAddress)
      const expiresAt = Date.now() + hostSessionDurationSeconds * 1000
      return json(
        { authenticated: true },
        { headers: { 'Set-Cookie': hostCookie(request, signHostSession(expiresAt)) } },
      )
    }

    if (url.pathname === '/api/host/logout' && request.method === 'POST') {
      return json(
        { authenticated: false },
        { headers: { 'Set-Cookie': hostCookie(request, '', 0) } },
      )
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      if (!isHostAuthorized(request, bunServer)) {
        return json({ error: 'Host authentication required.' }, { status: 401 })
      }
      return json({ room: createRoom() }, { status: 201 })
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/i)
    if (roomMatch && request.method === 'GET') {
      const room = getRoom(roomMatch[1])
      return room
        ? json({ room })
        : json({ error: 'That room does not exist.' }, { status: 404 })
    }

    const joinMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/players$/i)
    if (joinMatch && request.method === 'POST') {
      let name = ''
      try {
        const body = (await request.json()) as { name?: unknown }
        if (typeof body.name === 'string') name = body.name
      } catch {
        return json({ error: 'Invalid request.' }, { status: 400 })
      }
      const result = joinRoom(joinMatch[1], name)
      return 'error' in result
        ? json({ error: result.error }, { status: 404 })
        : json({ player: result.player, room: result.room }, { status: 201 })
    }

    const guessesMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/guesses$/i)
    if (guessesMatch && request.method === 'GET') {
      const code = guessesMatch[1]
      if (url.searchParams.get('role') === 'host') {
        if (!isHostAuthorized(request, bunServer)) {
          return json({ error: 'Host authentication required.' }, { status: 401 })
        }
        const guesses = getAllGuesses(code)
        return guesses ? json({ guesses }) : json({ error: 'That room does not exist.' }, { status: 404 })
      }

      const guesses = getPlayerGuesses(
        code,
        url.searchParams.get('player') ?? '',
        url.searchParams.get('token') ?? '',
      )
      return guesses ? json({ guesses }) : json({ error: 'That player is not in the room.' }, { status: 403 })
    }

    if (guessesMatch && request.method === 'POST') {
      let playerId = ''
      let token = ''
      let text = ''
      try {
        const body = (await request.json()) as { playerId?: unknown; token?: unknown; text?: unknown }
        if (typeof body.playerId === 'string') playerId = body.playerId
        if (typeof body.token === 'string') token = body.token
        if (typeof body.text === 'string') text = body.text
      } catch {
        return json({ error: 'Invalid request.' }, { status: 400 })
      }
      const result = addGuess(guessesMatch[1], playerId, token, text)
      return 'error' in result ? json({ error: result.error }, { status: 400 }) : json(result, { status: 201 })
    }

    if (url.pathname === '/ws') {
      const wantsHostRole = url.searchParams.get('role') === 'host'
      if (wantsHostRole && !isHostAuthorized(request, bunServer)) {
        return new Response('Host authentication required', { status: 401 })
      }

      const role = wantsHostRole ? 'host' : 'player'
      if (bunServer.upgrade(request, { data: { role } })) return

      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
    const filePath = normalize(join(publicDirectory, requestedPath))

    if (filePath === publicDirectory || filePath.startsWith(`${publicDirectory}${sep}`)) {
      const file = Bun.file(filePath)
      if (await file.exists()) return new Response(file)
    }

    // SPA fallback: Vue Router handles application routes such as /login and /host.
    const index = Bun.file(join(publicDirectory, 'index.html'))
    if (await index.exists()) return new Response(index)

    return new Response('Build not found. Run `bun run build` first.', { status: 503 })
  },

  websocket: {
    /** WebSockets are available for future real-time game events; room entry uses HTTP for now. */
    open(socket) {
      console.log('connected', socket.data)
    },
    message(socket, message) {
      console.log('message:', message)
    },
    close(socket) {
      if (socket.data.role === 'player' && socket.data.roomCode && socket.data.playerId) {
        removePlayer(socket.data.roomCode, socket.data.playerId)
      }
      console.log('disconnected')
    },
  },
})

console.log(`Draw is available locally at http://localhost:${server.port}`)
for (const address of networkAddresses) console.log(`Draw is available on your network at ${address}`)
