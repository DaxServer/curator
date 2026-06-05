import { makeSessionStorePlugin } from '@backend/__tests__/helpers'
import { sessionPlugin } from '@backend/core/session'
import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

const COOKIE_CONFIG = { cookie: { httpOnly: true, sameSite: 'lax' as const, path: '/' } }

describe('session plugin', () => {
  it('injects empty session on first request', async () => {
    const { plugin } = makeSessionStorePlugin()
    const app = new Elysia(COOKIE_CONFIG)
      .use(plugin)
      .use(sessionPlugin)
      .get('/test', ({ session }) => ({ user: session.user ?? null }))

    const res = await app.handle(new Request('http://localhost/test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: null })
  })

  it('persists session data after save()', async () => {
    const { plugin } = makeSessionStorePlugin()
    const app = new Elysia(COOKIE_CONFIG)
      .use(plugin)
      .use(sessionPlugin)
      .get('/write', async ({ session }) => {
        session.user = { username: 'Alice', sub: '1', editcount: 100, rights: ['autoconfirmed'] }
        await session.save()
        return { ok: true }
      })
      .get('/read', ({ session }) => ({ username: session.user?.username ?? null }))

    const writeRes = await app.handle(new Request('http://localhost/write'))
    expect(writeRes.status).toBe(200)

    const cookie = writeRes.headers.get('set-cookie') ?? ''
    const sessionCookie = cookie.split(';')[0]

    const readRes = await app.handle(
      new Request('http://localhost/read', { headers: { cookie: sessionCookie } }),
    )
    expect(readRes.status).toBe(200)
    expect(await readRes.json()).toEqual({ username: 'Alice' })
  })

  it('clears session data on clear()', async () => {
    const { plugin } = makeSessionStorePlugin()
    const app = new Elysia(COOKIE_CONFIG)
      .use(plugin)
      .use(sessionPlugin)
      .get('/write', async ({ session }) => {
        session.user = { username: 'Alice', sub: '1', editcount: 100, rights: ['autoconfirmed'] }
        await session.save()
        return { ok: true }
      })
      .get('/clear', async ({ session }) => {
        session.clear()
        await session.save()
        return { ok: true }
      })
      .get('/read', ({ session }) => ({ user: session.user ?? null }))

    const writeRes = await app.handle(new Request('http://localhost/write'))
    const cookie = (writeRes.headers.get('set-cookie') ?? '').split(';')[0]

    await app.handle(new Request('http://localhost/clear', { headers: { cookie } }))

    const readRes = await app.handle(new Request('http://localhost/read', { headers: { cookie } }))
    expect((await readRes.json()).user).toBeNull()
  })

  it('expires cookie and deletes store entry on clear() + save()', async () => {
    const { plugin, store } = makeSessionStorePlugin()
    const app = new Elysia(COOKIE_CONFIG)
      .use(plugin)
      .use(sessionPlugin)
      .get('/write', async ({ session }) => {
        session.user = { username: 'Alice', sub: '1', editcount: 100, rights: ['autoconfirmed'] }
        await session.save()
        return { ok: true }
      })
      .get('/clear', async ({ session }) => {
        session.clear()
        await session.save()
        return { ok: true }
      })

    const writeRes = await app.handle(new Request('http://localhost/write'))
    const cookie = (writeRes.headers.get('set-cookie') ?? '').split(';')[0]
    expect(store.size).toBe(1)

    const clearRes = await app.handle(
      new Request('http://localhost/clear', { headers: { cookie } }),
    )

    expect(store.size).toBe(0)
    const setCookie = clearRes.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/Max-Age=0/i)
    expect(setCookie).toMatch(/Path=\//i)
    expect(setCookie).toMatch(/HttpOnly/i)
  })
})
