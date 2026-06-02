import type { SessionStore } from '@backend/core/session'
import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { Elysia } from 'elysia'

const TEST_ENCRYPTION_KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'

beforeAll(() => {
  Bun.env.TOKEN_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY
})

// ============================================================
// Mock workers/queue BEFORE importing admin routes
// ============================================================

const mockEnqueueUpload = mock(async () => 'job-1')

mock.module('@backend/workers/queue', () => ({
  enqueueUpload: mockEnqueueUpload,
  removeUploadJob: mock(async () => {}),
}))

// Import AFTER mock.module()
const { adminRoutes } = await import('@backend/routes/admin')

// ============================================================

function makeStore() {
  const m = new Map<string, string>()
  const store: SessionStore = {
    async get(k) {
      return m.get(k) ?? null
    },
    async set(k, v, _ex, _ttl) {
      m.set(k, v)
    },
    async del(k) {
      m.delete(k)
    },
  }
  return { m, store }
}

function seedSession(m: Map<string, string>, username = 'DaxServer', sub = '1'): string {
  const id = 'test-session'
  m.set(`session:${id}`, JSON.stringify({ user: { username, sub } }))
  return `session_id=${id}`
}

function seedSessionWithToken(m: Map<string, string>): string {
  const id = 'test-token-session'
  m.set(
    `session:${id}`,
    JSON.stringify({
      user: { username: 'DaxServer', sub: '1' },
      access_token: ['tok', 'secret'],
    }),
  )
  return `session_id=${id}`
}

type ServiceOverrides = {
  uploads?: object
  batches?: object
  users?: object
  presets?: object
}

function makeTestApp(overrides: ServiceOverrides = {}) {
  const { m, store } = makeStore()

  const mockBatches = {
    getBatches: mock(async () => []),
    countBatches: mock(async () => 0),
  }
  const mockUsers = {
    getUsers: mock(async () => []),
    countUsers: mock(async () => 0),
  }
  const mockPresets = {
    getAllPresets: mock(async () => []),
    countAllPresets: mock(async () => 0),
  }
  const mockUploads = {
    getAllUploadRequests: mock(async () => []),
    countAllUploadRequests: mock(async () => 0),
    cancelUploadRequests: mock(async () => 0),
    failUploadRequests: mock(async () => 0),
    getFailedUploadsGrouped: mock(async () => ({ items: [], total: 0 })),
    updateUploadFields: mock(async () => true),
    updateJobTaskId: mock(async () => {}),
    retrySelectedUploadsToNewBatch: mock(async () => ({
      newUploadIds: [10],
      editGroupId: 'eg-123',
      newBatchId: 5,
    })),
  }

  const app = new Elysia()
    .use(new Elysia({ name: 'session-store' }).decorate('sessionStore', store))
    .use(
      new Elysia({ name: 'db' }).decorate({
        users: { ...mockUsers, ...(overrides.users ?? {}) },
        batches: { ...mockBatches, ...(overrides.batches ?? {}) },
        presets: { ...mockPresets, ...(overrides.presets ?? {}) },
        uploads: { ...mockUploads, ...(overrides.uploads ?? {}) },
      }),
    )
    .use(adminRoutes)

  return { app, m }
}

describe('admin auth guard', () => {
  it('returns 401 for unauthenticated request', async () => {
    const { app } = makeTestApp()
    const res = await app.handle(new Request('http://localhost/api/admin/batches'))
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin authenticated request', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m, 'OtherUser', '99')
    const res = await app.handle(
      new Request('http://localhost/api/admin/batches', { headers: { cookie } }),
    )
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin/batches', () => {
  it('returns 200 with items and total for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/batches', { headers: { cookie } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('GET /api/admin/users', () => {
  it('returns 200 with items and total for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/users', { headers: { cookie } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('GET /api/admin/upload_requests', () => {
  it('returns 200 with items and total for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/upload_requests', { headers: { cookie } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('POST /api/admin/upload_requests/bulk-cancel', () => {
  it('returns 200 with cancelled_count for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/upload_requests/bulk-cancel', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [1, 2] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cancelled_count: number }
    expect(typeof body.cancelled_count).toBe('number')
  })
})

describe('POST /api/admin/upload_requests/bulk-fail', () => {
  it('returns 200 with failed_count for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/upload_requests/bulk-fail', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [3, 4] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { failed_count: number }
    expect(typeof body.failed_count).toBe('number')
  })
})

describe('GET /api/admin/presets', () => {
  it('returns 200 with items and total for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/presets', { headers: { cookie } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('GET /api/admin/failed_uploads', () => {
  it('returns 200 with items and total for admin', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/failed_uploads', { headers: { cookie } }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })
})

describe('PUT /api/admin/upload_requests/:id', () => {
  it('returns 200 when upload is found and updated', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/upload_requests/42', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('updated')
  })

  it('returns 404 when upload is not found', async () => {
    const { app, m } = makeTestApp({
      uploads: { updateUploadFields: mock(async () => false) },
    })
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/upload_requests/999', {
        method: 'PUT',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'queued' }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/admin/retry', () => {
  it('returns 200 with new_batch_id and enqueues jobs', async () => {
    mockEnqueueUpload.mockClear()
    const { app, m } = makeTestApp()
    const cookie = seedSessionWithToken(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/retry', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ upload_ids: [1, 2] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { new_batch_id: number; retried_count: number; enqueued_count: number }
    expect(body.new_batch_id).toBe(5)
    expect(body.retried_count).toBe(1)
    expect(body.enqueued_count).toBe(1)
    expect(mockEnqueueUpload).toHaveBeenCalledTimes(1)
    expect(mockEnqueueUpload).toHaveBeenCalledWith(
      { uploadId: 10, batchId: 5, editGroupId: 'eg-123', userid: '1' },
      0,
    )
  })

  it('returns 200 with enqueued_count=0 when enqueue fails', async () => {
    mockEnqueueUpload.mockRejectedValueOnce(new Error('redis unavailable'))
    const { app, m } = makeTestApp()
    const cookie = seedSessionWithToken(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/retry', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ upload_ids: [1] }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { retried_count: number; enqueued_count: number }
    expect(body.retried_count).toBe(1)
    expect(body.enqueued_count).toBe(0)
  })

  it('returns 401 when no access token in session', async () => {
    const { app, m } = makeTestApp()
    const cookie = seedSession(m)
    const res = await app.handle(
      new Request('http://localhost/api/admin/retry', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ upload_ids: [1, 2] }),
      }),
    )
    expect(res.status).toBe(401)
  })
})
