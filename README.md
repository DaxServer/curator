[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

# Curator

A full-stack application for browsing [Mapillary](https://www.mapillary.com/) sequences and uploading selected street-level images to [Wikimedia Commons](https://commons.wikimedia.org/).

## Overview

The Curator application consists of:

1. **Backend**: An [Elysia](https://elysiajs.com/) service (Bun) with a REST API and WebSocket endpoint. [BullMQ](https://bullmq.io/) workers handle background upload tasks. Compiles to a single `curator-server` binary.
2. **Frontend**: A Vue 3 application with TypeScript and PrimeVue for browsing Mapillary sequences, configuring upload metadata, and monitoring batch progress. Embedded into the binary at build time.

The application is deployed on [Wikimedia Toolforge](https://wikitech.wikimedia.org/wiki/Portal:Toolforge). The [curator-launcher](https://github.com/DaxServer/curator-launcher) downloads the `curator-server` binary from the latest GitHub release, verifies its Sigstore attestation, and execs into it.

## Deployment

### Build

Every push to `main` compiles the binary and publishes a GitHub release automatically via the [build workflow](.github/workflows/build.yml). The curator-launcher picks up the latest release at container startup — no manual build step is required.

### Environment Variables

Use `toolforge envvars` to set them up. The OAuth1 application is at [OAuth applications - Wikimedia Meta-Wiki](https://meta.wikimedia.org/wiki/Special:OAuthListConsumers/view/8e7c7bbe93a2623af57eb03f37448b3c).

**Required:**

```bash
CURATOR_OAUTH1_KEY
CURATOR_OAUTH1_SECRET
TOKEN_ENCRYPTION_KEY
SESSION_SECRET_KEY
MAPILLARY_API_TOKEN
```

`SESSION_SECRET_KEY` signs cookie sessions. Rotating it invalidates all active user sessions. Generate with:

```bash
openssl rand -hex 32
```

`TOKEN_ENCRYPTION_KEY` encrypts OAuth access tokens stored in the database using AES-GCM. Generate with:

```bash
openssl rand -base64 32
```

**Optional:**

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | HTTP port |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis password |
| `WCQS_OAUTH_TOKEN` | — | Wikimedia Commons Query Service OAuth token |
| `DB_URL` | `mysql://curator:curator@localhost/curator` | MySQL connection URL (on Toolforge, automatically derived from `TOOL_TOOLSDB_USER` / `TOOL_TOOLSDB_PASSWORD`) |
| `GEOCODING_API_URL` | `https://geocoding.daxserver.com/reverse` | Reverse geocoding endpoint |
| `GEOCODING_CONCURRENCY_LIMIT` | `10` | Max concurrent geocoding requests |
| `CELERY_CONCURRENCY` | `2` | Upload worker concurrency |
| `CELERY_MAXIMUM_WAIT_TIME` | `240` | Max worker wait time in seconds |
| `RATE_LIMIT_DEFAULT_NORMAL` | `4` | Default rate limit (requests) |
| `RATE_LIMIT_DEFAULT_PERIOD` | `60` | Default rate limit window in seconds |
| `X_USERNAME` | `DaxServer` | X (Twitter) username for syndication |
| `X_API_KEY` | — | X API key |
| `ENABLE_MAINTENANCE` | — | Set to `true` to enable maintenance mode |
| `LOG_LEVEL` | — | Pino log level |

### Webservice

The webservice is run via the [curator-launcher](https://github.com/DaxServer/curator-launcher) image. When deploying for the first time:

```bash
toolforge webservice buildservice start --buildservice-image tool-curator/launcher:latest --mount=all
```

For subsequent deployments (after a new release is published):

```bash
toolforge webservice restart
```

## Development

### Prerequisites

- [Bun](https://bun.sh) 1.3.14

### Installation

```bash
bun install
```

### Running the server

```bash
DEV_MOCK_AUTH=true DB_URL=mysql://curator:curator@localhost/curator \
  CURATOR_OAUTH1_KEY=abc123 CURATOR_OAUTH1_SECRET=abc123 \
  SESSION_SECRET_KEY=dev-secret TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32) \
  MAPILLARY_API_TOKEN=dev bun dev
```

`DEV_MOCK_AUTH=true` bypasses Commons OAuth — every request without an active session is automatically authenticated as a mock user. The frontend shows an amber banner when running under Vite dev mode with mock auth active.

The backend server will be available at http://localhost:8000 and the Vite dev server at http://localhost:5173.

### Running Tests

```bash
bun test
```

### Code Style

```bash
bun lint
bun format
```

### Type Checking

```bash
bun typecheck
```

### Database Migrations

```bash
DB_URL=mysql://curator:curator@localhost/curator bun db:generate
DB_URL=mysql://curator:curator@localhost/curator bun db:migrate
```

## License

[MIT](./LICENSE)
