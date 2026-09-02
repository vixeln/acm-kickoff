import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { join, normalize, sep } from 'node:path'

import { getLanUrls } from './lan'

type SocketData = {
  playerId?: string
  sessionId?: string
  role?: 'host' | 'player'
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

function isLoopbackRequest(request: Request, bunServer: Bun.Server<SocketData>) {
  const address = bunServer.requestIP(request)?.address
  return address === '127.0.0.1' || address === '::1'
}

function getCookie(request: Request, name: string) {
  const prefix = `${name}=`
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length)
}

function signHostSession(expiresAt: number) {
  const signature = createHmac('sha256', hostSessionSecret).update(String(expiresAt)).digest('hex')
  return `${expiresAt}.${signature}`
}

/** Verifies the stateless host cookie without storing server-side session records. */
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

/** Localhost stays convenient; every non-loopback host must present a signed session. */
function isHostAuthorized(request: Request, bunServer: Bun.Server<SocketData>) {
  if (!hostPassword) return isLoopbackRequest(request, bunServer)
  return hasValidHostSession(request)
}

/** Hashing both values gives timingSafeEqual fixed-size inputs. */
function passwordsMatch(suppliedPassword: string) {
  const suppliedHash = createHash('sha256').update(suppliedPassword).digest()
  const expectedHash = createHash('sha256').update(hostPassword).digest()
  return timingSafeEqual(suppliedHash, expectedHash)
}

function getClientAddress(request: Request, bunServer: Bun.Server<SocketData>) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    bunServer.requestIP(request)?.address ||
    'unknown'
  )
}

function recordFailedLogin(address: string) {
  const now = Date.now()
  const current = loginAttempts.get(address)
  const attempt =
    !current || current.resetAt <= now
      ? { attempts: 1, resetAt: now + loginWindowMilliseconds }
      : { ...current, attempts: current.attempts + 1 }

  loginAttempts.set(address, attempt)
}

/** Rate limiting is intentionally process-local while the app is restricted to one replica. */
function isLoginRateLimited(address: string) {
  const attempt = loginAttempts.get(address)
  if (!attempt) return false
  if (attempt.resetAt <= Date.now()) {
    loginAttempts.delete(address)
    return false
  }
  return attempt.attempts >= maximumLoginAttempts
}

function hostCookie(request: Request, token: string, maxAge = hostSessionDurationSeconds) {
  const forwardedProtocol = request.headers.get('x-forwarded-proto')
  const secure = forwardedProtocol === 'https' || new URL(request.url).protocol === 'https:'
  return `draw_host=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Cache-Control', 'no-store')
  return Response.json(data, { ...init, headers })
}

const server = Bun.serve<SocketData>({
  hostname: '0.0.0.0',
  port,

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
