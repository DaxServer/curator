import { HashLockError, SourceCdnError, StorageError } from '@backend/core/errors'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'

// mock.module() in Bun is global and persistent for the entire test process —
// it mutates live ES module bindings and cannot be restored between files.
// Only modules that no other test file imports directly are safe to mock here.
// - bullmq: not imported by any other test ✓
// - @backend/db/client: not imported by any other test ✓
// - @backend/db/dal/uploads: only type-imported (erased at runtime) by ws.handler.test.ts ✓

// Capture the processor and event handlers registered by createUploadWorker.
let capturedProcessor: ((job: unknown) => Promise<void>) | undefined
const capturedHandlers: Map<string, (...args: unknown[]) => unknown> = new Map()

mock.module('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: (job: unknown) => Promise<void>) {
      capturedProcessor = processor
    }
    on(event: string, handler: (...args: unknown[]) => unknown) {
      capturedHandlers.set(event, handler)
    }
  },
}))

mock.module('@backend/db/client', () => ({ lazyDb: { client: {} } }))

const mockUpdateStatus = mock(async () => {})
const mockClearToken = mock(async () => {})
const mockGetById = mock(async (_id: number) => null as unknown)

mock.module('@backend/db/dal/uploads', () => ({
  UploadService: class {
    updateUploadStatus = mockUpdateStatus
    clearUploadAccessToken = mockClearToken
    getUploadById = mockGetById
  },
}))

import { createUploadWorker } from '@backend/workers/upload.worker'

// === Helpers ===

const mockRedis = {} as Redis

function makeJob(uploadId: number) {
  return {
    id: `job-${uploadId}`,
    data: { uploadId, batchId: 1, editGroupId: 'eg-abc', userid: 'user-1' },
    attemptsMade: 3,
    opts: { attempts: 3 },
  }
}

beforeEach(() => {
  capturedHandlers.clear()
  capturedProcessor = undefined
  mockUpdateStatus.mockClear()
  mockClearToken.mockClear()
  mockGetById.mockClear()
  createUploadWorker(mockRedis)
})

// === Processor rethrows retryable errors without touching the DB ===
//
// HashLockError / StorageError / SourceCdnError bubble out of the inner catch
// (upload.worker.ts line 147-152) back to BullMQ so it can schedule a retry.
// Crucially, when they escape the processor the DB must NOT be marked 'failed'
// because the job may still succeed on a retry.
//
// The test drives this by making getUploadById throw the retryable error directly
// so it escapes the processor without any DB write.

describe('upload worker — retryable errors escape the processor without a DB update', () => {
  it.each([
    ['HashLockError', new HashLockError('lock already held')],
    ['StorageError', new StorageError('storage write failed')],
    ['SourceCdnError', new SourceCdnError('cdn returned 503')],
  ])('%s propagates out of the processor and leaves the DB untouched', async (_name, error) => {
    // Force the error to escape early (simulates it bubbling out of the inner try block).
    mockGetById.mockImplementation(async () => {
      throw error
    })

    const job = makeJob(1)
    await expect(capturedProcessor!(job)).rejects.toBe(error)

    // No DB write of any kind — BullMQ owns the retry decision.
    expect(mockUpdateStatus).not.toHaveBeenCalled()
    expect(mockClearToken).not.toHaveBeenCalled()
  })
})

// === BullMQ 'failed' event must update the DB — this is the bug being fixed ===
//
// When BullMQ exhausts all retry attempts it fires the 'failed' event with the
// final job and error.  Before the fix, the handler only logged.  After the fix
// it calls updateUploadStatus('failed') so the row no longer stays permanently
// stuck at 'in_progress'.

describe('upload worker — permanent BullMQ failure marks upload as failed in DB', () => {
  it.each([
    ['HashLockError', new HashLockError('lock already held')],
    ['StorageError', new StorageError('storage write failed')],
    ['SourceCdnError', new SourceCdnError('cdn returned 503')],
  ])('%s: permanently failed job updates DB status to "failed"', async (_name, error) => {
    const failedHandler = capturedHandlers.get('failed')
    expect(failedHandler).toBeDefined()

    await failedHandler!(makeJob(1), error)

    expect(mockUpdateStatus).toHaveBeenCalledWith(1, 'failed', {
      type: 'error',
      message: error.message,
    })
    expect(mockClearToken).toHaveBeenCalledWith(1)
  })

  it('does not throw when BullMQ passes undefined as the job', async () => {
    const failedHandler = capturedHandlers.get('failed')
    expect(failedHandler).toBeDefined()
    await expect(
      failedHandler!(undefined, new Error('lost job reference')),
    ).resolves.toBeUndefined()
    expect(mockUpdateStatus).not.toHaveBeenCalled()
  })
})
