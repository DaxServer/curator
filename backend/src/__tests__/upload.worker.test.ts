import { HashLockError, SourceCdnError, StorageError } from '@backend/core/errors'
import type { UploadService } from '@backend/db/dal/uploads'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'

// mock.module() in Bun is global and persistent for the entire test process —
// it mutates live ES module bindings and cannot be restored between files.
// Only modules that no other test file imports directly are safe to mock here.
// - bullmq: not imported by any other test ✓
// - @backend/db/client: not imported by any other test ✓
// @backend/db/dal/uploads is a real value import in uploads.dal.test.ts, so it is
// injected via WorkerDeps.uploads instead of mock.module() here.

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
const mockGetById = mock(
  async (_id: number): Promise<Awaited<ReturnType<UploadService['getUploadById']>>> => null,
)

const mockUploads = {
  updateUploadStatus: mockUpdateStatus,
  clearUploadAccessToken: mockClearToken,
  getUploadById: mockGetById,
}

import { createUploadWorker } from '@backend/workers/upload.worker'

// === Helpers ===

const mockRedis = {} as Redis

function makeJob(uploadId: number, requeueCount = 0) {
  return {
    id: `job-${uploadId}`,
    data: {
      uploadId,
      batchId: 1,
      editGroupId: 'eg-abc',
      userid: 'user-1',
      rateLimit: { uploadsPerPeriod: 10, periodSeconds: 60 },
      requeueCount,
    },
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
  createUploadWorker(mockRedis, { uploads: mockUploads })
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

describe('upload worker — failed handler resets status to queued on intermediate BullMQ attempt', () => {
  it.each([
    ['HashLockError', new HashLockError('lock already held')],
    ['SourceCdnError', new SourceCdnError('cdn network error (ECONNRESET)')],
  ])('%s: resets status to queued when BullMQ will retry', async (_name, error) => {
    const failedHandler = capturedHandlers.get('failed')
    expect(failedHandler).toBeDefined()

    // attemptsMade=1 with attempts=3 — BullMQ will schedule two more retries
    const job = { ...makeJob(1), attemptsMade: 1, opts: { attempts: 3 } }

    await failedHandler!(job, error)

    expect(mockUpdateStatus).toHaveBeenCalledWith(1, 'queued')
    expect(mockClearToken).not.toHaveBeenCalled()
  })

  it('swallows DB errors when resetting status to queued so the handler never rejects', async () => {
    mockUpdateStatus.mockRejectedValueOnce(new Error('DB connection lost'))

    const failedHandler = capturedHandlers.get('failed')
    expect(failedHandler).toBeDefined()

    const job = { ...makeJob(1), attemptsMade: 1, opts: { attempts: 3 } }

    await expect(failedHandler!(job, new SourceCdnError('cdn error'))).resolves.toBeUndefined()
  })
})

describe('upload worker — permanent BullMQ failure marks upload as failed in DB', () => {
  it.each([
    ['HashLockError', new HashLockError('lock already held')],
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

  it('StorageError: resets DB to queued, increments requeueCount, and requeues', async () => {
    const mockEnqueue = mock(async () => 'new-job-id')
    const mockGetDelay = mock(async () => 1500)
    const mockRemoveJob = mock(async () => {})
    createUploadWorker(mockRedis, {
      uploads: mockUploads,
      enqueueUpload: mockEnqueue,
      getNextUploadDelay: mockGetDelay,
      removeUploadJob: mockRemoveJob,
    })

    const failedHandler = capturedHandlers.get('failed')
    expect(failedHandler).toBeDefined()

    const job = makeJob(1, 0)
    await failedHandler!(job, new StorageError('storage write failed'))

    expect(mockUpdateStatus).toHaveBeenCalledWith(1, 'queued')
    expect(mockClearToken).not.toHaveBeenCalled()
    expect(mockRemoveJob).toHaveBeenCalledWith(job.id)
    expect(mockGetDelay).toHaveBeenCalledWith(job.data.userid, job.data.rateLimit, mockRedis)
    expect(mockEnqueue).toHaveBeenCalledWith({ ...job.data, requeueCount: 1 }, 1500)
  })

  it('StorageError: permanently fails when requeueCount reaches the limit', async () => {
    const mockEnqueue = mock(async () => 'new-job-id')
    const mockGetDelay = mock(async () => 1500)
    createUploadWorker(mockRedis, {
      uploads: mockUploads,
      enqueueUpload: mockEnqueue,
      getNextUploadDelay: mockGetDelay,
    })

    const failedHandler = capturedHandlers.get('failed')
    expect(failedHandler).toBeDefined()

    const job = makeJob(1, 5)
    await failedHandler!(job, new StorageError('storage write failed'))

    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockUpdateStatus).toHaveBeenCalledWith(1, 'failed', {
      type: 'error',
      message: 'storage write failed',
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
