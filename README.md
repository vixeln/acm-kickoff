# Draw

Draw is a lightweight Vue and Bun application for hosting a browser-based game. Players can
join over a local network or through a public Railway deployment by scanning a QR code.

## Technology

- Vue 3 and Vue Router for the browser interface
- Vite for development and production bundling
- Bun for HTTP, static files, and WebSocket upgrades
- `qrcode` for client-side QR generation
- Docker and Railway for public deployment

For the source layout, request flow, API contract, authentication model, and deployment
constraints, see [Architecture](docs/ARCHITECTURE.md).

## Setup

Requirements:

- Bun 1.3.14 or compatible
- Node.js for `vue-tsc` inside the Docker build stage

Install dependencies:

```sh
bun install
```

Copy the environment template when you need production-style host authentication locally:

```sh
cp .env.example .env
```

Do not commit `.env` or real secrets.

## Commands

| Command | Purpose |
| --- | --- |
| `bun dev` | Start the Vite development server on port 5173 |
| `bun run build` | Type-check and create the production bundle in `dist/` |
| `bun start` | Serve an existing production bundle with Bun |
| `bun run serve` | Build and then serve the app on port 8080 |
| `bun run lint` | Run Oxlint and ESLint with automatic fixes |

## Local development

```sh
bun dev
```

Opening `http://localhost:5173` redirects to `/host`. Vite supplies development-only API
middleware, so the local host view does not require a password. Devices opening Vite's
printed Network URL are treated as players.

To exercise the production server locally:

```sh
bun run serve
```

The Bun server listens on every network interface. The host should open
`http://localhost:8080`; the host screen generates a QR code using the preferred LAN IPv4
address. Public networks may block peer-to-peer traffic even when both devices use the same
Wi-Fi.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | Railway supplies it | HTTP port; defaults to `8080` locally |
| `HOST_PASSWORD` | Public deployment | Password accepted by the host login endpoint |
| `HOST_SESSION_SECRET` | Recommended | Secret used to sign host sessions; falls back to `HOST_PASSWORD` |

Use long, unrelated values for the password and session secret. Generate a session secret
with:

```sh
openssl rand -base64 32
```

## Railway deployment

1. Connect this repository to a Railway service.
2. Add `HOST_PASSWORD` and `HOST_SESSION_SECRET` to that service's Variables tab in the same
   Railway environment as the public domain.
3. Apply the staged variable changes so Railway creates a new deployment.
4. Generate a domain under **Networking → Public Networking**.
5. Keep the service at one replica while application state remains in process memory.
6. Open `https://<domain>/host` to host; players use the root URL or QR code.

The [Dockerfile](Dockerfile) builds the Vue bundle and runs the Bun server as an unprivileged
user. [railway.json](railway.json) configures `/health` as the deployment readiness check.

If the host page reports that access is not configured, verify that the variables belong to
the application service and current Railway environment, then deploy the staged changes.

## Current scope

The repository currently provides routing, player entry UI, host authentication, QR joining,
static serving, and a WebSocket upgrade endpoint. The room lifecycle and game message
protocol are not implemented yet; WebSocket messages are only logged.
