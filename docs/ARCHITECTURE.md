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
| `server.ts` | HTTP routing, host authentication, room API, static files, health check, and WebSockets |
| `room-session.ts` | In-memory room creation, lookup, player membership, and guesses |
| `lan.ts` | Discovers and ranks usable local IPv4 addresses |
| `src/main.ts` | Creates and mounts the Vue application |
| `src/router.ts` | Selects the host/player entry route and defines client routes |
| `src/views/HostView.vue` | Host login, private word controls, connection URL selection, and QR generation |
| `src/views/DisplayView.vue` | Projector/audience view that deliberately omits the secret word |
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
| `POST` | `/api/rooms` | Host cookie | Creates a four-character room |
| `GET` | `/api/rooms/:code` | None | Returns the room and current players |
| `GET` | `/api/rooms/:code/host-state` | Host cookie | Returns the room including the secret word |
| `PUT` | `/api/rooms/:code/secret-word` | Host cookie | Sets the private word to draw |
| `POST` | `/api/rooms/:code/players` | None | Adds a named player to the room |
| `GET` | `/api/rooms/:code/guesses?player=:id&token=:token` | Player token | Returns only that player's guesses |
| `POST` | `/api/rooms/:code/guesses` | Player token in JSON | Adds a word guess for the authenticated player |
| `GET` | `/api/rooms/:code/guesses?role=host` | Host cookie | Returns all player guesses |
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

## Room sessions

After host authentication, `HostView.vue` creates a room and displays its code in the QR URL.
`LoginView.vue` submits the player name to the room API and only navigates to `/play` after the
server confirms the room exists and the player has been added. The host polls the room and the
all-guesses feed every two seconds so the waiting list and guesses stay current. The projector
view polls the public room endpoint every two seconds so its player count stays current. Players
poll a player-scoped guesses feed every second so their own submitted guesses appear without
exposing them to other players. All polling stops when the corresponding Vue view is unmounted.

### Room polling

Polling is the current lightweight synchronization mechanism for room state. A view makes a
normal HTTP request at a fixed interval, replaces its local reactive state with the response, and
renders the latest result. It is used for UI freshness, not authentication: every protected
request is still authorized by the server, and the public room response intentionally omits the
secret word.

| View | Endpoint | Interval | Purpose |
| --- | --- | --- | --- |
| Host | `GET /api/rooms/:code` | 2 seconds | Refresh the player list |
| Host | `GET /api/rooms/:code/host-state` | 2 seconds | Restore the private word after refresh |
| Host | `GET /api/rooms/:code/guesses?role=host` | 2 seconds | Show all player guesses |
| Projector | `GET /api/rooms/:code` | 2 seconds | Show the current audience/player count |
| Player | `GET /api/rooms/:code/guesses?player=:id&token=:token` | 1 second | Show that player's own guesses |

The requests are intentionally scoped by role. The host may receive the secret word and all
guesses, the projector receives only public room information, and a player receives only their
own guesses. Failed polling requests are ignored or shown as a room error depending on the view;
the next interval retries automatically. This makes the app simple to deploy, but it creates
repeated HTTP traffic and can make updates appear up to one polling interval late. As drawing and
timers become real-time gameplay, replace or supplement polling with authenticated WebSocket
messages and keep the same server-side response separation.

Players poll a player-scoped feed and submit guesses with a private per-join token, so another
player cannot read them. Room codes, player names, and guess text are validated on the server, and
all room state is process-local.

The projector uses `/display/:roomCode` and only calls the public room endpoint. The secret word
is stored in the room but omitted by `publicRoom`; only the authenticated host-state endpoint can
return it. Use an extended desktop with the projector window moved to the second display.
Operating-system mirroring cannot hide content because both outputs receive the same pixels.

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
