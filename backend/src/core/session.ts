import { config } from '@backend/config'
import { Elysia } from 'elysia'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'

export type SessionUser = {
  username: string
  sub: string
  editcount: number
  rights: string[]
}

export type SessionData = {
  user?: SessionUser
  access_token?: [string, string]
  request_token?: [string, string]
}

export type Session = SessionData & {
  save(): Promise<void>
  clear(): void
  regenerate(): Promise<void>
}

export interface SessionStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ex: 'EX', ttl: number): Promise<void>
  del(key: string): Promise<void>
}

const SESSION_TTL = 86400 * 7
const COOKIE_NAME = 'session_id'

class RedisSessionStore implements SessionStore {
  private _client: Redis | null = null

  private get client(): Redis {
    this._client ??= new Redis(config.redisUrl)
    return this._client
  }

  async get(key: string) {
    return this.client.get(key)
  }

  async set(key: string, value: string, ex: 'EX', ttl: number) {
    await this.client.set(key, value, ex, ttl)
  }

  async del(key: string) {
    await this.client.del(key)
  }
}

export const sessionStorePlugin = new Elysia({ name: 'session-store' }).decorate(
  'sessionStore',
  new RedisSessionStore() as SessionStore,
)

export const sessionPlugin = new Elysia({ name: 'session' })
  .use(sessionStorePlugin)
  .derive({ as: 'global' }, async ({ sessionStore, cookie }) => {
    let id = cookie[COOKIE_NAME]?.value || randomUUID()
    const raw = await sessionStore.get(`session:${id}`)
    const stored: SessionData = raw ? JSON.parse(raw) : {}

    let cleared = false

    const session: Session = {
      ...stored,
      async save() {
        if (cleared) {
          await sessionStore.del(`session:${id}`)
          cookie[COOKIE_NAME]!.remove()
          return
        }
        const plain: SessionData = {
          user: session.user,
          access_token: session.access_token,
          request_token: session.request_token,
        }
        await sessionStore.set(`session:${id}`, JSON.stringify(plain), 'EX', SESSION_TTL)
        cookie[COOKIE_NAME]!.set({ value: id, maxAge: SESSION_TTL })
      },
      clear() {
        cleared = true
        delete session.user
        delete session.access_token
        delete session.request_token
      },
      async regenerate() {
        await sessionStore.del(`session:${id}`)
        id = randomUUID()
      },
    }

    return { session }
  })
