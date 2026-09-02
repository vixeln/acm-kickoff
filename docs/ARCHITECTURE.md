# Draw architecture

## Overview

Draw uses a single deployable service. The browser receives a compiled Vue single-page
application, while Bun serves its files and owns the API and WebSocket endpoint.

```text
Host browser ── HTTP/cookie ──┐
                             ├── Bun server ── dist/ Vue application
Player browsers ─ WebSocket ─┘
```

There is no database or external session store. Authentication throttles, future room state,
and active WebSocket connections therefore belong to one Bun process.

## Source map

| Path | Responsibility |
| --- | --- |
| `server.ts` | HTTP routing, host authentication, static files, health check, and WebSockets |
| `lan.ts` | Discovers and ranks usable local IPv4 addresses |
| `src/main.ts` | Creates and mounts the Vue application |
| `src/router.ts` | Selects the host/player entry route and defines client routes |
| `src/views/HostView.vue` | Host login, connection URL selection, and QR generation |
| `src/views/LoginView.vue` | Collects player name and room code |
| `src/views/PlayView.vue` | Displays the player's joined state |
| `src/styles.css` | Shared application presentation |
| `vite.config.ts` | Vite settings and local-development API middleware |
| `Dockerfile` | Multi-stage Railway image build |
| `railway.json` | Railway health-check and restart policy |

## Runtime modes

### Vite development

`bun dev` runs Vite on `0.0.0.0:5173`. Vite provides two development-only responses:

- `/api/network-info` returns LAN login URLs.
- `/api/host/status` treats the local developer as authenticated.

The Bun API is not running in this mode. New API behavior needed by the UI should either be
represented in Vite's development middleware or tested with the production server.

### Local production server

`bun run serve` builds `dist/` and starts `server.ts`. Requests from loopback are allowed to
host without a configured password. The LAN information endpoint is restricted to loopback,
so another device cannot use it to inspect server interfaces.

The root route is chosen in the browser:

- `localhost`, `127.0.0.1`, or `::1` redirects to `/host`.
- Other hostnames and IP addresses redirect to `/login`.

### Railway

Railway injects `PORT`; Bun listens on that port and `0.0.0.0`. A public host must visit
`/host` and authenticate using `HOST_PASSWORD`. Once authenticated, the QR code encodes
`window.location.origin + "/login"`, so it uses Railway's HTTPS domain rather than the
container's private address.

## HTTP contract

All authentication responses include `Cache-Control: no-store`.

| Method | Path | Authentication | Behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | None | Returns `200` when the Bun process is ready |
| `GET` | `/api/network-info` | Loopback only | Returns ordered local login URLs |
| `GET` | `/api/host/status` | Optional cookie | Reports `authenticated` and `configured` |
| `POST` | `/api/host/login` | Password in JSON | Creates a signed host session cookie |
| `POST` | `/api/host/logout` | None | Expires the host session cookie |
| `GET` | `/ws` | Host cookie for `role=host` | Upgrades to a WebSocket connection |

Host login request:

```json
{
  "password": "the configured host password"
}
```

Successful login and status responses:

```json
{ "authenticated": true }
```

```json
{ "authenticated": true, "configured": true }
```

## Host authentication

`HOST_PASSWORD` never enters the Vue bundle. The browser posts it to the Bun API over HTTPS.
The server compares fixed-length SHA-256 digests with a timing-safe comparison.

After a successful login, the server sets `draw_host`, containing an expiration timestamp and
an HMAC-SHA256 signature. The cookie is:

- HTTP-only, preventing JavaScript access
- `SameSite=Strict`, reducing cross-site request risk
- `Secure` when Railway forwards an HTTPS request
- valid for 12 hours

Five failed logins from one client address cause a 15-minute in-memory throttle. The throttle
resets when the process restarts and is not shared between replicas.

If `HOST_PASSWORD` is absent, only loopback requests can host. On Railway, the public host
view remains locked and the server writes a configuration warning to the runtime log.

## QR address selection

`HostView.vue` deliberately uses two strategies:

1. On a loopback hostname, fetch `/api/network-info` and encode the preferred LAN URL.
2. On any other hostname, encode the current public origin and `/login`.

`lan.ts` considers non-internal IPv4 interfaces. Private address ranges are preferred, then
common physical interface names such as `en`, `eth`, and `wlan`, which generally rank ahead
of VPN adapters.

## WebSockets

Connect players to `/ws`. A future host client should connect to `/ws?role=host`; the server
rejects that role unless the request includes a valid host cookie. Public clients must use
`wss://` when the page uses HTTPS.

The current handlers only log connection lifecycle events and messages. Before implementing
gameplay, define a versioned message schema, validate all incoming payloads, add heartbeat and
reconnection behavior, and avoid trusting player-supplied role or room identifiers.

## Static file serving and client routing

Bun serves files below `dist/` and verifies that normalized paths remain inside that
directory. When no physical file matches, it returns `dist/index.html`, allowing Vue Router
routes such as `/host`, `/login`, and `/play` to work after a browser refresh.

## Docker and Railway

The Docker build has two stages:

1. The Bun builder installs locked dependencies and creates the Vite bundle. Node is installed
   only to execute `vue-tsc`, which currently does not resolve Vue modules correctly under the
   Bun runtime in the Alpine builder.
2. The runtime image contains only Bun, `dist/`, `server.ts`, and `lan.ts`, and runs as the
   unprivileged `bun` user.

Railway calls `/health` during deployment. A new container receives traffic only after that
endpoint responds successfully.

## Scaling and persistence

Use one replica while state is in process memory. Railway does not provide sticky sessions,
so multiple replicas could place a host and players in different processes.

Before scaling horizontally:

- Store rooms and membership in Redis or a database.
- Define cross-instance message delivery, such as Redis pub/sub.
- Replace the in-memory login throttle with a shared limiter.
- Decide how active games recover from deploys and server restarts.

No volume is currently required because the service intentionally writes no persistent files.

## Security notes

- Set unrelated, high-entropy values for `HOST_PASSWORD` and `HOST_SESSION_SECRET`.
- Store secrets only in Railway Variables or an ignored local `.env` file.
- Do not prefix server secrets with `VITE_`; Vite-prefixed values can be exposed to browsers.
- Keep `/host` protected before sharing the public URL.
- Validate and size-limit future WebSocket messages before acting on them.
- Rotate `HOST_SESSION_SECRET` to invalidate every existing host session.
