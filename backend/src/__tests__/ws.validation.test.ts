import { sessionPlugin, type SessionStore } from '@backend/core/session'
import { ClientMessage } from '@backend/types/ws'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

// ============================================================
// Test setup — a minimal WS app with only body validation,
// no Handler business logic, no .onError() hook.
//
// When body validation fails, Elysia (1.4.28 Bun adapter) sends
// back a JSON object { type: "validation", on: "message", ... }
// because hasCustomErrorHandlers is false. Valid messages receive
// an echo { received: <type> }. Tests distinguish the two by
// checking the "received" field.
// ============================================================

const SESSION_ID = 'ws-validation-test-session'

const testSessionStore: SessionStore = new (class {
  private store = new Map<string, string>()

  constructor() {
    this.store.set(
      `session:${SESSION_ID}`,
      JSON.stringify({
        user: { username: 'TestUser', sub: '1', editcount: 100, rights: ['autoconfirmed'] },
        access_token: ['token-key', 'token-secret'],
      }),
    )
  }

  async get(k: string) {
    return this.store.get(k) ?? null
  }

  async set(k: string, v: string, _ex: 'EX', _ttl: number) {
    this.store.set(k, v)
  }

  async del(k: string) {
    this.store.delete(k)
  }
})()

const app = new Elysia()
  .use(new Elysia({ name: 'session-store' }).decorate('sessionStore', testSessionStore))
  .use(sessionPlugin)
  .ws('/ws', {
    body: ClientMessage,
    open(ws) {
      if (!ws.data.session.user) ws.close(1008, 'Unauthorized')
    },
    message(ws, body) {
      ws.send(JSON.stringify({ received: body.type }))
    },
  })
  .listen(0)

const PORT = app.server!.port

let sharedWs: WebSocket

beforeAll(async () => {
  sharedWs = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`, {
      headers: { cookie: `session_id=${SESSION_ID}` },
    } as unknown as string[])
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
})

afterAll(() => {
  sharedWs?.close()
  app.stop(true)
})

async function wsSendAndCollect(msg: unknown, timeoutMs = 1000): Promise<string[]> {
  return new Promise((resolve) => {
    const received: string[] = []

    const handler = (e: MessageEvent) => {
      received.push(e.data as string)
      clearTimeout(timer)
      resolve(received)
    }

    const timer = setTimeout(() => {
      sharedWs.removeEventListener('message', handler)
      resolve(received)
    }, timeoutMs)

    sharedWs.addEventListener('message', handler, { once: true })
    sharedWs.send(JSON.stringify(msg))
  })
}

// ============================================================
// Guard test — verifies the test harness can detect validation
// failures before trusting the passing tests below.
// ============================================================
describe('guard: invalid message triggers body validation error', () => {
  it('unknown type causes Elysia to send back a validation error JSON', async () => {
    const msgs = await wsSendAndCollect({ type: 'UNKNOWN_TYPE', data: {} })

    expect(msgs.length).toBeGreaterThan(0)
    const parsed = JSON.parse(msgs[0]!) as Record<string, unknown>
    expect(parsed.type).toBe('validation')
    expect(parsed.on).toBe('message')
  })
})

// ============================================================
// Validation tests — each message type sent by loadCollection()
// ============================================================
describe('FETCH_PRESETS body validation', () => {
  it('passes with mapillary handler', async () => {
    const msgs = await wsSendAndCollect({
      type: 'FETCH_PRESETS',
      data: { handler: 'mapillary' },
    })

    const received = msgs.map((m) => {
      try {
        return (JSON.parse(m) as { received?: string }).received
      } catch {
        return null
      }
    })
    expect(received).toContain('FETCH_PRESETS')
  })
})

describe('FETCH_IMAGES body validation', () => {
  it('passes with empty string data (store.input default)', async () => {
    const msgs = await wsSendAndCollect({
      type: 'FETCH_IMAGES',
      data: '',
      handler: 'mapillary',
    })

    const received = msgs.map((m) => {
      try {
        return (JSON.parse(m) as { received?: string }).received
      } catch {
        return null
      }
    })
    expect(received).toContain('FETCH_IMAGES')
  })

  it('passes with a non-empty sequence id', async () => {
    const msgs = await wsSendAndCollect({
      type: 'FETCH_IMAGES',
      data: 'LqNt2V0eQ2ClmDPEVHGqLg',
      handler: 'mapillary',
    })

    const received = msgs.map((m) => {
      try {
        return (JSON.parse(m) as { received?: string }).received
      } catch {
        return null
      }
    })
    expect(received).toContain('FETCH_IMAGES')
  })
})
