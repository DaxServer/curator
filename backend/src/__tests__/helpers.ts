import type { SessionStore } from '@backend/core/session'
import type { BatchItem } from '@backend/db/dal/batches'
import type { ServerMessage } from '@backend/types/ws'
import { mock } from 'bun:test'
import { Elysia } from 'elysia'
import type { Redis } from 'ioredis'

export function makeSessionStore() {
  const map = new Map<string, string>()
  const store: SessionStore = {
    async get(k) {
      return map.get(k) ?? null
    },
    async set(k, v, _ex, _ttl) {
      map.set(k, v)
    },
    async del(k) {
      map.delete(k)
    },
  }
  return { store, map }
}

export function makeSessionStorePlugin() {
  const { store, map } = makeSessionStore()
  return {
    plugin: new Elysia({ name: 'session-store' }).decorate('sessionStore', store),
    store: map,
  }
}

export function makeSender() {
  const messages: ServerMessage[] = []
  return {
    send: mock((msg: ServerMessage) => {
      messages.push(msg)
    }),
    get messages() {
      return messages
    },
  }
}

export function makeRedisMock(nextAvailable: string | null = null) {
  const getMock = mock(async () => nextAvailable)
  const setMock = mock(async () => 'OK' as const)
  const delMock = mock(async () => 1)
  const redis = { get: getMock, set: setMock, del: delMock } as unknown as Redis
  return { redis, getMock, setMock, delMock }
}

export function fakeBatchItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 1,
    userid: '1',
    username: 'alice',
    edit_group_id: 'eg-abc',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stats: {
      total: 0,
      queued: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      duplicate: 0,
    },
    ...overrides,
  }
}
