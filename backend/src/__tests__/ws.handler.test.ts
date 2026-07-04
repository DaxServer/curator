import { fakeBatchItem, makeSender } from '@backend/__tests__/helpers'
import type { BatchItem, BatchService } from '@backend/db/dal/batches'
import type { PresetService } from '@backend/db/dal/presets'
import type { SafeUploadRow, UploadService } from '@backend/db/dal/uploads'
import type { UserService } from '@backend/db/dal/users'
import { fetchExistingPages, fromMapillary } from '@backend/handlers/mapillary'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

// mock.module() in Bun is global and persistent for the entire test process —
// it mutates live ES module bindings and cannot be restored between files.
// Queue/wikidata/mapillary mocks below are safe because no other test file imports
// those modules directly. Services and rate-limiter functions are injected via
// constructor, so their modules do not need to be mocked here.

// ============================================================
// Shared mock state — updated per-test via .mockImplementation
// ============================================================

const mockGetBatches = mock(async () => [] as BatchItem[])
const mockCountBatches = mock(async () => 0)
const mockGetBatch = mock(async (_id: number) => null as BatchItem | null)
const mockCreateBatch = mock(
  async (_userid: string, _username: string): Promise<BatchItem> => ({
    id: 42,
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
  }),
)
const mockGetBatchIdsWithRecentChanges = mock(async () => [] as number[])
const mockGetBatchesMinimal = mock(async () => [])
const mockGetLatestUpdateTime = mock(async () => null as Date | null)
const mockCountUploadsInBatch = mock(async () => 0)
const mockPopulateBatchStats = mock(async () => new Map())

const mockGetUploadsByBatch = mock(
  async (_id: number, _limit: number, _offset: number) => [] as unknown[],
)
const mockRetrySelectedUploadsToNewBatch = mock(async () => ({
  newUploadIds: [] as number[],
  editGroupId: null as string | null,
  newBatchId: 0,
}))
const mockCreateUploadRequestsForBatch = mock(
  async () => [] as { id: number; key: string; status: string; isNew: boolean }[],
)
const mockCancelBatchDal = mock(async () => new Map<number, string | null>())
const mockUpdateJobTaskId = mock(async () => undefined)

const mockEnsureUser = mock(async () => undefined)

const mockGetPresetsForHandler = mock(async () => [] as unknown[])
const mockCreatePreset = mock(async () => undefined)
const mockUpdatePreset = mock(async () => null as unknown)
const mockDeletePreset = mock(async () => false)

const mockEnqueueUpload = mock(async () => 'job-1')
const mockRemoveUploadJob = mock(async () => undefined)

const mockGetRateLimitForBatch = mock(async () => ({ uploadsPerPeriod: 10, periodSeconds: 60 }))
const mockGetNextUploadDelay = mock(async () => 0)

// WikidataClient mock instance methods
const mockFetchItem = mock(async (_qid: string) => ({ claims: {} }))
const mockEditItem = mock(async (_qid: string, _claims: unknown, _sitelinks: unknown) => undefined)

// MapillaryHandler mock
const mockFetchCollection = mock(async (_col: string) => ({ images: {}, sequenceId: '' }))
const mockFetchCollectionIds = mock(async (_col: string) => [] as string[])
const mockFetchImagesBatch = mock(
  async (_ids: string[], _col: string) => ({}) as Record<string, unknown>,
)

// ============================================================
// Wire up non-DAL module mocks BEFORE any import of handler.ts
// ============================================================

mock.module('@backend/workers/queue', () => ({
  enqueueUpload: mockEnqueueUpload,
  removeUploadJob: mockRemoveUploadJob,
  formatDelayMs: (ms: number) => `${ms}ms`,
}))

mock.module('@backend/mediawiki/wikidata', () => ({
  WikidataClient: class {
    fetchItem(qid: string) {
      return mockFetchItem(qid)
    }
    editItem(qid: string, claims: unknown, sitelinks: unknown) {
      return mockEditItem(qid, claims, sitelinks)
    }
  },
}))

mock.module('@backend/handlers/mapillary', () => ({
  fromMapillary,
  fetchExistingPages,
  MapillaryHandler: class {
    fetchCollection(col: string) {
      return mockFetchCollection(col)
    }
    fetchCollectionIds(col: string) {
      return mockFetchCollectionIds(col)
    }
    fetchImagesBatch(ids: string[], col: string) {
      return mockFetchImagesBatch(ids, col)
    }
    fetchExistingPages(ids: string[]) {
      return fetchExistingPages(ids)
    }
  },
}))

// ============================================================
// Import Handler AFTER all mock.module() calls
// ============================================================
const { Handler } = await import('@backend/core/handler')

// ============================================================
// Fake service objects — injected into Handler via constructor
// ============================================================

const fakeBatchService = {
  getBatches: mockGetBatches,
  countBatches: mockCountBatches,
  getBatch: mockGetBatch,
  createBatch: mockCreateBatch,
  getBatchIdsWithRecentChanges: mockGetBatchIdsWithRecentChanges,
  getBatchesMinimal: mockGetBatchesMinimal,
  getLatestUpdateTime: mockGetLatestUpdateTime,
  countUploadsInBatch: mockCountUploadsInBatch,
  populateBatchStats: mockPopulateBatchStats,
} as unknown as BatchService

const fakeUploadService = {
  getUploadsByBatch: mockGetUploadsByBatch,
  retrySelectedUploadsToNewBatch: mockRetrySelectedUploadsToNewBatch,
  createUploadRequestsForBatch: mockCreateUploadRequestsForBatch,
  cancelBatch: mockCancelBatchDal,
  updateJobTaskId: mockUpdateJobTaskId,
} as unknown as UploadService

const fakePresetService = {
  getPresetsForHandler: mockGetPresetsForHandler,
  createPreset: mockCreatePreset,
  updatePreset: mockUpdatePreset,
  deletePreset: mockDeletePreset,
} as unknown as PresetService

const fakeUserService = {
  ensureUser: mockEnsureUser,
} as unknown as UserService

// ============================================================
// Test helpers
// ============================================================

function makeRedis() {
  return {
    get: mock(async (_key: string) => null as string | null),
    set: mock(async (_key: string, _val: string) => 'OK'),
  }
}

const fakeUser = {
  username: 'alice',
  sub: '1',
  editcount: 0,
  rights: [] as string[],
  access_token: ['tok', 'secret'] as [string, string],
}

function makeHandler(sender = makeSender(), redis = makeRedis()) {
  return {
    handler: new Handler(
      fakeUser,
      sender,
      redis as unknown as import('ioredis').Redis,
      {
        batches: fakeBatchService,
        uploads: fakeUploadService,
        presets: fakePresetService,
        users: fakeUserService,
      },
      {
        getRateLimitForBatch: mockGetRateLimitForBatch,
        getNextUploadDelay: mockGetNextUploadDelay,
      },
    ),
    sender,
    redis,
  }
}

function fakeUploadItem(overrides: Partial<SafeUploadRow> = {}): SafeUploadRow {
  return {
    id: 10,
    batchid: 1,
    userid: '1',
    status: 'queued',
    key: 'img-key',
    handler: 'mapillary',
    filename: 'test.jpg',
    wikitext: '== wikitext ==',
    labels: null,
    result: null,
    error: null,
    success: null,
    created_at: new Date('2024-01-01T00:00:00.000Z'),
    updated_at: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function fakePresetRow(
  overrides: Partial<{
    id: number
    title: string
    title_template: string
    labels: unknown
    categories: string | null
    exclude_from_date_category: boolean
    handler: string
    is_default: boolean
    created_at: Date
    updated_at: Date
    userid: string
  }> = {},
) {
  return {
    id: 1,
    title: 'My Preset',
    title_template: '{{title}}',
    labels: null,
    categories: 'Category:Foo',
    exclude_from_date_category: false,
    handler: 'mapillary',
    is_default: false,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    userid: '1',
    ...overrides,
  }
}

// ============================================================
// Reset all mock call counts before each test so counts don't bleed across tests
// ============================================================
beforeEach(() => {
  for (const m of [
    mockGetBatches,
    mockCountBatches,
    mockGetBatch,
    mockCreateBatch,
    mockGetBatchIdsWithRecentChanges,
    mockGetBatchesMinimal,
    mockGetLatestUpdateTime,
    mockCountUploadsInBatch,
    mockPopulateBatchStats,
    mockGetUploadsByBatch,
    mockRetrySelectedUploadsToNewBatch,
    mockCreateUploadRequestsForBatch,
    mockCancelBatchDal,
    mockUpdateJobTaskId,
    mockEnsureUser,
    mockGetPresetsForHandler,
    mockCreatePreset,
    mockUpdatePreset,
    mockDeletePreset,
    mockEnqueueUpload,
    mockRemoveUploadJob,
    mockGetRateLimitForBatch,
    mockGetNextUploadDelay,
    mockFetchItem,
    mockEditItem,
    mockFetchCollection,
    mockFetchCollectionIds,
    mockFetchImagesBatch,
  ]) {
    m.mockClear()
  }
})

// ============================================================
// Tests
// ============================================================

describe('Handler.createBatch', () => {
  it('sends BATCH_CREATED with the new batch id', async () => {
    const { handler, sender } = makeHandler()
    mockEnsureUser.mockImplementation(async () => undefined)
    mockCreateBatch.mockImplementation(async () => fakeBatchItem({ id: 42 }))

    await handler.createBatch()

    const msg = sender.messages.find((m) => m.type === 'BATCH_CREATED')
    expect(msg).toBeDefined()
    expect((msg as { type: 'BATCH_CREATED'; data: number }).data).toBe(42)
  })
})

describe('Handler.fetchPresets', () => {
  it('sends PRESETS_LIST with the handler type and mapped presets', async () => {
    const { handler, sender } = makeHandler()
    mockGetPresetsForHandler.mockImplementation(async () => [fakePresetRow()])

    await handler.fetchPresets('mapillary')

    const msg = sender.messages.find((m) => m.type === 'PRESETS_LIST') as
      | {
          type: 'PRESETS_LIST'
          data: { handler: string; presets: unknown[] }
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data.handler).toBe('mapillary')
    expect(msg!.data.presets).toHaveLength(1)
  })

  it('sends PRESETS_LIST with empty array when no presets exist', async () => {
    const { handler, sender } = makeHandler()
    mockGetPresetsForHandler.mockImplementation(async () => [])

    await handler.fetchPresets('mapillary')

    const msg = sender.messages.find((m) => m.type === 'PRESETS_LIST') as
      | {
          type: 'PRESETS_LIST'
          data: { handler: string; presets: unknown[] }
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data.presets).toHaveLength(0)
  })
})

describe('Handler.savePreset (create)', () => {
  it('calls createPreset and sends PRESETS_LIST', async () => {
    const { handler, sender } = makeHandler()
    mockCreatePreset.mockImplementation(async () => undefined)
    mockGetPresetsForHandler.mockImplementation(async () => [fakePresetRow()])

    await handler.savePreset({
      title: 'New Preset',
      title_template: '{{title}}',
      categories: 'Category:Test',
      handler: 'mapillary',
    })

    expect(mockCreatePreset).toHaveBeenCalled()
    const msg = sender.messages.find((m) => m.type === 'PRESETS_LIST')
    expect(msg).toBeDefined()
  })
})

describe('Handler.savePreset (update, not found)', () => {
  it('sends ERROR when preset is not found or permission denied', async () => {
    const { handler, sender } = makeHandler()
    mockUpdatePreset.mockImplementation(async () => null)

    await handler.savePreset({
      preset_id: 999,
      title: 'Updated',
      title_template: '{{title}}',
      categories: 'Category:Test',
      handler: 'mapillary',
    })

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('not found')
  })
})

describe('Handler.deletePreset (found)', () => {
  it('calls deletePreset and refreshes presets list', async () => {
    const { handler, sender } = makeHandler()
    mockDeletePreset.mockImplementation(async () => true)
    mockGetPresetsForHandler.mockImplementation(async () => [fakePresetRow()])

    await handler.deletePreset(1)

    expect(mockDeletePreset).toHaveBeenCalledWith(1, fakeUser.sub)
    const msg = sender.messages.find((m) => m.type === 'PRESETS_LIST')
    expect(msg).toBeDefined()
  })
})

describe('Handler.deletePreset (not found)', () => {
  it('sends ERROR when preset is not found or permission denied', async () => {
    const { handler, sender } = makeHandler()
    mockDeletePreset.mockImplementation(async () => false)

    await handler.deletePreset(999)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('not found')
  })
})

describe('Handler.fetchBatchUploads (found)', () => {
  it('sends BATCH_UPLOADS_LIST without batch, with partial: false for single page', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => fakeBatchItem({ id: 5 }))
    mockGetUploadsByBatch.mockImplementation(async () => [fakeUploadItem({ batchid: 5 })])

    await handler.fetchBatchUploads({ batch_id: 5, page_size: 100 })

    const msgs = sender.messages.filter((m) => m.type === 'BATCH_UPLOADS_LIST') as {
      type: 'BATCH_UPLOADS_LIST'
      data: { uploads: unknown[]; partial: boolean }
    }[]
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.data).not.toHaveProperty('batch')
    expect(msgs[0]!.data.partial).toBe(false)
    expect(msgs[0]!.data.uploads).toHaveLength(1)
    const upload = msgs[0]!.data.uploads[0] as Record<string, unknown>
    expect(upload).not.toHaveProperty('userid')
    expect(upload).not.toHaveProperty('labels')
    expect(upload).not.toHaveProperty('result')
    expect(upload).not.toHaveProperty('created_at')
    expect(upload).not.toHaveProperty('updated_at')
  })

  it('sends paginated BATCH_UPLOADS_LIST messages for >100 uploads', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => fakeBatchItem({ id: 5 }))
    const page1 = Array.from({ length: 100 }, (_, i) => fakeUploadItem({ id: i + 1, batchid: 5 }))
    const page2 = [fakeUploadItem({ id: 101, batchid: 5 })]
    mockGetUploadsByBatch.mockImplementation(async (_id, _limit, offset) =>
      offset === 0 ? page1 : offset === 100 ? page2 : [],
    )

    await handler.fetchBatchUploads({ batch_id: 5, page_size: 100 })

    const msgs = sender.messages.filter((m) => m.type === 'BATCH_UPLOADS_LIST') as {
      type: 'BATCH_UPLOADS_LIST'
      data: { uploads: unknown[]; partial: boolean }
    }[]
    expect(msgs).toHaveLength(2)
    expect(msgs[0]!.data.uploads).toHaveLength(100)
    expect(msgs[0]!.data.partial).toBe(true)
    expect(msgs[1]!.data.uploads).toHaveLength(1)
    expect(msgs[1]!.data.partial).toBe(false)
  })
})

describe('Handler.fetchBatchUploads (not found)', () => {
  it('sends ERROR when batch does not exist', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => null)

    await handler.fetchBatchUploads({ batch_id: 999, page_size: 100 })

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | { type: 'ERROR'; data: string }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('not found')
  })
})

describe('Handler.fetchBatch', () => {
  it('sends BATCH_INFO with the requested batch', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => fakeBatchItem({ id: 7 }))

    await handler.fetchBatch(7)

    const msg = sender.messages.find((m) => m.type === 'BATCH_INFO') as
      | { type: 'BATCH_INFO'; data: { batch: { id: number } } }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data.batch.id).toBe(7)
  })

  it('sends ERROR when batch does not exist', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => null)

    await handler.fetchBatch(999)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | { type: 'ERROR'; data: string }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('not found')
  })
})

describe('Handler.retryUploads (has failed uploads)', () => {
  it('enqueues jobs and sends RETRY_UPLOADS_RESPONSE with new batch id', async () => {
    const { handler, sender } = makeHandler()

    mockGetUploadsByBatch.mockImplementation(async () => [
      fakeUploadItem({ id: 10, status: 'failed' }),
      fakeUploadItem({ id: 11, status: 'completed' }),
    ])
    mockRetrySelectedUploadsToNewBatch.mockImplementation(async () => ({
      newUploadIds: [20, 21],
      editGroupId: 'eg-retry',
      newBatchId: 7,
    }))
    mockGetRateLimitForBatch.mockImplementation(async () => ({
      uploadsPerPeriod: 10,
      periodSeconds: 60,
    }))
    mockGetNextUploadDelay.mockImplementation(async () => 0)
    mockEnqueueUpload.mockImplementation(async () => 'job-xyz')
    mockUpdateJobTaskId.mockImplementation(async () => undefined)

    await handler.retryUploads(1)

    const msg = sender.messages.find((m) => m.type === 'RETRY_UPLOADS_RESPONSE') as
      | {
          type: 'RETRY_UPLOADS_RESPONSE'
          data: number
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toBe(7)
    expect(mockEnqueueUpload).toHaveBeenCalledTimes(2)
  })
})

describe('Handler.retryUploads (no failed uploads)', () => {
  it('sends ERROR when there are no failed uploads', async () => {
    const { handler, sender } = makeHandler()
    mockGetUploadsByBatch.mockImplementation(async () => [fakeUploadItem({ status: 'completed' })])

    await handler.retryUploads(1)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('No failed uploads')
  })
})

describe('Handler.cancelBatch (success)', () => {
  it('removes queued jobs and does not send an error', async () => {
    const { handler, sender } = makeHandler()
    const cancelled = new Map<number, string | null>()
    cancelled.set(10, 'task-abc')
    cancelled.set(11, null)
    mockCancelBatchDal.mockImplementation(async () => cancelled)
    mockRemoveUploadJob.mockImplementation(async () => undefined)

    await handler.cancelBatch(1)

    expect(mockRemoveUploadJob).toHaveBeenCalledWith('task-abc')
    expect(mockRemoveUploadJob).toHaveBeenCalledTimes(1)
    const errMsg = sender.messages.find((m) => m.type === 'ERROR')
    expect(errMsg).toBeUndefined()
  })
})

describe('Handler.cancelBatch (not found)', () => {
  it('sends ERROR when batch is not found', async () => {
    const { handler, sender } = makeHandler()
    mockCancelBatchDal.mockImplementation(async () => {
      throw new Error('Batch 999 not found')
    })

    await handler.cancelBatch(999)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('not found')
  })
})

describe('Handler.cancelBatch (no queued items)', () => {
  it('sends ERROR when there are no queued items to cancel', async () => {
    const { handler, sender } = makeHandler()
    mockCancelBatchDal.mockImplementation(async () => new Map<number, string | null>())

    await handler.cancelBatch(1)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('No queued items')
  })
})

describe('Handler.checkCategoriesDeleted (some deleted)', () => {
  it('sends CATEGORIES_DELETED_RESPONSE with deleted titles', async () => {
    const { handler, sender } = makeHandler()
    const responses = [{ query: { logevents: [{ type: 'delete' }] } }, { query: { logevents: [] } }]
    let call = 0
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify(responses[call++] ?? responses[responses.length - 1]), {
          status: 200,
        }),
    ) as unknown as typeof fetch

    await handler.checkCategoriesDeleted(['Cat:A', 'Cat:B'])

    const msg = sender.messages.find((m) => m.type === 'CATEGORIES_DELETED_RESPONSE') as
      | {
          type: 'CATEGORIES_DELETED_RESPONSE'
          data: { deleted: string[] }
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data.deleted).toEqual(['Cat:A'])
  })
})

describe('Handler.checkCategoriesDeleted (none deleted)', () => {
  it('sends no message when no categories are deleted', async () => {
    const { handler, sender } = makeHandler()
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ query: { logevents: [] } }), { status: 200 }),
    ) as unknown as typeof fetch

    await handler.checkCategoriesDeleted(['Cat:A', 'Cat:B'])

    const msg = sender.messages.find((m) => m.type === 'CATEGORIES_DELETED_RESPONSE')
    expect(msg).toBeUndefined()
    const errMsg = sender.messages.find((m) => m.type === 'ERROR')
    expect(errMsg).toBeUndefined()
  })
})

describe('Handler.cancelTasks', () => {
  it('does not throw when called (smoke test)', async () => {
    const { handler } = makeHandler()
    expect(() => handler.cancelTasks()).not.toThrow()
  })

  it('clears upload polling interval set by subscribeBatch', async () => {
    const { handler, sender } = makeHandler()
    mockGetUploadsByBatch.mockImplementation(async () => [])
    mockCountUploadsInBatch.mockImplementation(async () => 0)
    await handler.subscribeBatch(1)

    const subMsg = sender.messages.find((m) => m.type === 'SUBSCRIBED')
    expect(subMsg).toBeDefined()

    expect(() => handler.cancelTasks()).not.toThrow()
  })
})

describe('Handler.uploadSlice (batch found, items created)', () => {
  it('enqueues jobs and sends UPLOAD_SLICE_ACK', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => fakeBatchItem({ id: 3, edit_group_id: 'eg-abc' }))
    mockCreateUploadRequestsForBatch.mockImplementation(async () => [
      { id: 101, key: 'img-1', status: 'queued', isNew: true },
      { id: 102, key: 'img-2', status: 'queued', isNew: true },
    ])
    mockGetRateLimitForBatch.mockImplementation(async () => ({
      uploadsPerPeriod: 10,
      periodSeconds: 60,
    }))
    mockGetNextUploadDelay.mockImplementation(async () => 0)
    mockEnqueueUpload.mockImplementation(async () => 'job-1')
    mockUpdateJobTaskId.mockImplementation(async () => undefined)

    await handler.uploadSlice({
      batchid: 3,
      sliceid: 1,
      items: [
        { id: 'img-1', input: 'seq-1', title: 'File1.jpg', wikitext: '...' },
        { id: 'img-2', input: 'seq-1', title: 'File2.jpg', wikitext: '...' },
      ],
    })

    const msg = sender.messages.find((m) => m.type === 'UPLOAD_SLICE_ACK') as
      | {
          type: 'UPLOAD_SLICE_ACK'
          data: { id: string; status: string }[]
          sliceid: number
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.sliceid).toBe(1)
    expect(msg!.data).toHaveLength(2)
    expect(msg!.data[0]!.id).toBe('img-1')
    expect(mockEnqueueUpload).toHaveBeenCalledTimes(2)
  })

  it('does not re-enqueue or re-consume rate limit for rows that already existed (resent slice)', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => fakeBatchItem({ id: 3, edit_group_id: 'eg-abc' }))
    mockCreateUploadRequestsForBatch.mockImplementation(async () => [
      { id: 101, key: 'img-1', status: 'in_progress', isNew: false },
      { id: 102, key: 'img-2', status: 'queued', isNew: true },
    ])
    mockGetRateLimitForBatch.mockImplementation(async () => ({
      uploadsPerPeriod: 10,
      periodSeconds: 60,
    }))
    mockGetNextUploadDelay.mockImplementation(async () => 0)
    mockEnqueueUpload.mockImplementation(async () => 'job-1')
    mockUpdateJobTaskId.mockImplementation(async () => undefined)

    await handler.uploadSlice({
      batchid: 3,
      sliceid: 1,
      items: [
        { id: 'img-1', input: 'seq-1', title: 'File1.jpg', wikitext: '...' },
        { id: 'img-2', input: 'seq-1', title: 'File2.jpg', wikitext: '...' },
      ],
    })

    expect(mockGetNextUploadDelay).toHaveBeenCalledTimes(1)
    expect(mockEnqueueUpload).toHaveBeenCalledTimes(1)
    expect(mockUpdateJobTaskId).toHaveBeenCalledTimes(1)
    expect(mockUpdateJobTaskId).toHaveBeenCalledWith(102, 'job-1')

    const msg = sender.messages.find((m) => m.type === 'UPLOAD_SLICE_ACK') as
      | {
          type: 'UPLOAD_SLICE_ACK'
          data: { id: string; status: string }[]
          sliceid: number
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toEqual([
      { id: 'img-1', status: 'in_progress' },
      { id: 'img-2', status: 'queued' },
    ])
  })
})

describe('Handler.uploadSlice (batch not found)', () => {
  it('sends ERROR when batch does not exist', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => null)

    await handler.uploadSlice({
      batchid: 999,
      sliceid: 1,
      items: [],
    })

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('not found')
  })
})

describe('Handler.uploadSlice (batch has no edit_group_id)', () => {
  it('sends ERROR when batch has no edit_group_id', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatch.mockImplementation(async () => fakeBatchItem({ id: 4, edit_group_id: null }))

    await handler.uploadSlice({
      batchid: 4,
      sliceid: 1,
      items: [],
    })

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('no edit_group_id')
  })
})

describe('Handler.retryUploads (retrySelectedUploadsToNewBatch returns empty)', () => {
  it('sends ERROR when new upload ids list is empty', async () => {
    const { handler, sender } = makeHandler()
    mockGetUploadsByBatch.mockImplementation(async () => [fakeUploadItem({ status: 'failed' })])
    mockRetrySelectedUploadsToNewBatch.mockImplementation(async () => ({
      newUploadIds: [],
      editGroupId: null,
      newBatchId: 0,
    }))

    await handler.retryUploads(1)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('No failed uploads')
  })
})

describe('Handler.cancelBatch (permission denied)', () => {
  it('sends ERROR when user lacks permission', async () => {
    const { handler, sender } = makeHandler()
    mockCancelBatchDal.mockImplementation(async () => {
      throw new Error('Permission denied')
    })

    await handler.cancelBatch(1)

    const msg = sender.messages.find((m) => m.type === 'ERROR') as
      | {
          type: 'ERROR'
          data: string
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data).toContain('Permission denied')
  })
})

describe('Handler.savePreset (update, success)', () => {
  it('calls updatePreset and sends PRESETS_LIST when preset exists', async () => {
    const { handler, sender } = makeHandler()
    mockUpdatePreset.mockImplementation(async () => fakePresetRow())
    mockGetPresetsForHandler.mockImplementation(async () => [fakePresetRow()])

    await handler.savePreset({
      preset_id: 1,
      title: 'Updated Preset',
      title_template: '{{title}}',
      categories: 'Category:Test',
      handler: 'mapillary',
    })

    expect(mockUpdatePreset).toHaveBeenCalled()
    const msg = sender.messages.find((m) => m.type === 'PRESETS_LIST')
    expect(msg).toBeDefined()
    const errMsg = sender.messages.find((m) => m.type === 'ERROR')
    expect(errMsg).toBeUndefined()
  })
})

describe('Handler.fetchBatches', () => {
  it('sends BATCHES_LIST with items and total', async () => {
    const { handler, sender } = makeHandler()
    mockGetBatches.mockImplementation(async () => [fakeBatchItem()])
    mockCountBatches.mockImplementation(async () => 1)
    mockGetLatestUpdateTime.mockImplementation(async () => null)

    await handler.fetchBatches({ page: 1, limit: 10 })

    const msg = sender.messages.find((m) => m.type === 'BATCHES_LIST') as
      | {
          type: 'BATCHES_LIST'
          data: { items: unknown[]; total: number }
          partial: boolean
        }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.data.total).toBe(1)
    expect(msg!.data.items).toHaveLength(1)
    expect(msg!.partial).toBe(false)
  })
})
