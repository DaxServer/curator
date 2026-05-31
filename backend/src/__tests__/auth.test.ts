import type { OAuthClient } from '@backend/core/oauthClient'
import { type SessionStore } from '@backend/core/session'
import { authRoutes } from '@backend/routes/auth'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'

function makeMockClient(): OAuthClient {
  return {
    initiate: mock(async () => ({
      redirectUrl: 'https://commons.wikimedia.org/wiki/Special:OAuth/authorize?oauth_token=tok',
      requestToken: ['req_key', 'req_secret'] as [string, string],
    })),
    complete: mock(async () => ({
      accessToken: ['acc_key', 'acc_secret'] as [string, string],
    })),
    identify: mock(async () => ({
      username: 'TestUser',
      sub: '123',
      editcount: 100,
      rights: ['autoconfirmed'],
    })),
  }
}

function makeTestApp(client?: OAuthClient) {
  const store = new Map<string, string>()
  const sessionStore: SessionStore = {
    async get(k) {
      return store.get(k) ?? null
    },
    async set(k, v, _ex, _ttl) {
      store.set(k, v)
    },
    async del(k) {
      store.delete(k)
    },
  }
  return new Elysia()
    .use(new Elysia({ name: 'session-store' }).decorate('sessionStore', sessionStore))
    .use(new Elysia({ name: 'oauth-client' }).decorate('oauthClient', client ?? makeMockClient()))
    .use(authRoutes)
}

function makeTestAppWithStore(client?: OAuthClient) {
  const store = new Map<string, string>()
  const sessionStore: SessionStore = {
    async get(k) {
      return store.get(k) ?? null
    },
    async set(k, v, _ex, _ttl) {
      store.set(k, v)
    },
    async del(k) {
      store.delete(k)
    },
  }
  const app = new Elysia()
    .use(new Elysia({ name: 'session-store' }).decorate('sessionStore', sessionStore))
    .use(new Elysia({ name: 'oauth-client' }).decorate('oauthClient', client ?? makeMockClient()))
    .use(authRoutes)
  return { app, store }
}

describe('GET /auth/whoami', () => {
  it('returns 401 when not logged in', async () => {
    const app = makeTestApp()
    const res = await app.handle(new Request('http://localhost/auth/whoami'))
    expect(res.status).toBe(401)
  })
})

describe('GET /auth/login', () => {
  it('redirects to Wikimedia OAuth authorize URL', async () => {
    const app = makeTestApp()
    const res = await app.handle(new Request('http://localhost/auth/login'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('Special:OAuth/authorize')
  })
})

describe('GET /auth/logout', () => {
  it('redirects to / and clears session', async () => {
    const app = makeTestApp()
    const res = await app.handle(new Request('http://localhost/auth/logout'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
  })
})

describe('GET /auth/callback', () => {
  it('redirects to / on successful OAuth flow', async () => {
    const app = makeTestApp()

    const loginRes = await app.handle(new Request('http://localhost/auth/login'))
    const cookie = (loginRes.headers.get('set-cookie') ?? '').split(';')[0]

    const callbackRes = await app.handle(
      new Request('http://localhost/auth/callback?oauth_token=tok&oauth_verifier=verifier123', {
        headers: { cookie },
      }),
    )
    expect(callbackRes.status).toBe(302)
    expect(callbackRes.headers.get('location')).toBe('/')
  })

  it('returns 400 when no request token in session', async () => {
    const app = makeTestApp()
    const res = await app.handle(
      new Request('http://localhost/auth/callback?oauth_token=tok&oauth_verifier=v'),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when oauth params are missing', async () => {
    const app = makeTestApp()
    const res = await app.handle(new Request('http://localhost/auth/callback'))
    expect(res.status).toBe(400)
  })
})

describe('POST /auth/register', () => {
  beforeAll(() => {
    Bun.env.X_USERNAME = 'BotUser'
    Bun.env.X_API_KEY = 'secret_key'
  })

  it('returns 200 and sets session for valid API key', async () => {
    const app = makeTestApp()
    const res = await app.handle(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'X-API-KEY': 'secret_key' },
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { username: string }
    expect(body.username).toBe('BotUser')
  })

  it('returns 401 for wrong API key', async () => {
    const app = makeTestApp()
    const res = await app.handle(
      new Request('http://localhost/auth/register', {
        method: 'POST',
        headers: { 'X-API-KEY': 'wrong_key' },
      }),
    )
    expect(res.status).toBe(401)
  })
})

describe('session fixation prevention', () => {
  it('session ID is rotated after login — old ID must not grant access', async () => {
    const { app, store } = makeTestAppWithStore()

    // Attacker-controlled session ID placed in the victim's browser before login.
    const attackerKnownId = 'attacker-known-session-id'
    const victimCookieBeforeLogin = `session_id=${attackerKnownId}`

    // Victim visits /auth/login with the pre-seeded cookie.
    const loginRes = await app.handle(
      new Request('http://localhost/auth/login', {
        headers: { cookie: victimCookieBeforeLogin },
      }),
    )
    expect(loginRes.status).toBe(302)

    // The request_token should be stored under the attacker-known ID.
    expect(store.has(`session:${attackerKnownId}`)).toBe(true)

    // Victim completes OAuth callback using the same cookie.
    const callbackRes = await app.handle(
      new Request('http://localhost/auth/callback?oauth_token=tok&oauth_verifier=verifier123', {
        headers: { cookie: victimCookieBeforeLogin },
      }),
    )
    expect(callbackRes.status).toBe(302)

    // After login the old session key must be gone from the store.
    expect(store.has(`session:${attackerKnownId}`)).toBe(false)

    // The callback response must issue a *new* session ID cookie.
    const newCookieHeader = callbackRes.headers.get('set-cookie') ?? ''
    expect(newCookieHeader).toMatch(/session_id=/)
    const newSessionId = newCookieHeader.match(/session_id=([^;]+)/)?.[1]
    expect(newSessionId).toBeDefined()
    expect(newSessionId).not.toBe(attackerKnownId)

    // The attacker's old cookie must not authenticate.
    const attackerRes = await app.handle(
      new Request('http://localhost/auth/whoami', {
        headers: { cookie: victimCookieBeforeLogin },
      }),
    )
    expect(attackerRes.status).toBe(401)

    // The victim's new cookie must authenticate successfully.
    const victimRes = await app.handle(
      new Request('http://localhost/auth/whoami', {
        headers: { cookie: `session_id=${newSessionId}` },
      }),
    )
    expect(victimRes.status).toBe(200)
    const body = (await victimRes.json()) as { username: string }
    expect(body.username).toBe('TestUser')
  })
})
