import { fakeBatchItem, makeSender } from '@backend/__tests__/helpers'
import { OptimizedBatchStreamer, STREAM_INTERVAL_MS } from '@backend/core/batchStreamer'
import type { BatchItem, BatchService } from '@backend/db/dal/batches'
import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test'

// Each await in poll interleaves with one Promise.resolve() here; 10 rounds is plenty
async function flushPromises() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

const mockGetBatches = mock(async () => [] as BatchItem[])
const mockCountBatches = mock(async () => 0)
const mockGetLatestUpdateTime = mock(async () => null as Date | null)
const mockGetBatchIdsWithRecentChanges = mock(async () => [] as number[])
const mockGetBatchesMinimal = mock(async () => [] as BatchItem[])

const fakeBatchService = {
  getBatches: mockGetBatches,
  countBatches: mockCountBatches,
  getLatestUpdateTime: mockGetLatestUpdateTime,
  getBatchIdsWithRecentChanges: mockGetBatchIdsWithRecentChanges,
  getBatchesMinimal: mockGetBatchesMinimal,
} as unknown as BatchService

beforeEach(() => {
  jest.useFakeTimers()
  for (const m of [
    mockGetBatches,
    mockCountBatches,
    mockGetLatestUpdateTime,
    mockGetBatchIdsWithRecentChanges,
    mockGetBatchesMinimal,
  ]) {
    m.mockClear()
  }
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
})

describe('OptimizedBatchStreamer.startStreaming', () => {
  it('sends initial BATCHES_LIST with partial=false', async () => {
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    mockGetBatches.mockImplementation(async () => [fakeBatchItem({ id: 1 })])
    mockCountBatches.mockImplementation(async () => 1)
    mockGetLatestUpdateTime.mockImplementation(async () => null)

    await streamer.startStreaming(undefined, undefined, 1, 10)
    streamer.stopStreaming()

    const msg = sender.messages.find((m) => m.type === 'BATCHES_LIST') as
      | { type: 'BATCHES_LIST'; data: { items: unknown[]; total: number }; partial: boolean }
      | undefined
    expect(msg).toBeDefined()
    expect(msg!.partial).toBe(false)
    expect(msg!.data.items).toHaveLength(1)
    expect(msg!.data.total).toBe(1)
  })

  it('sends partial=true update when database has newer changes', async () => {
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const t1 = new Date('2024-01-01T00:00:01.000Z')

    mockGetBatches.mockImplementation(async () => [fakeBatchItem({ id: 1 })])
    mockCountBatches.mockImplementation(async () => 1)
    // First call returns t0 (recorded as lastUpdateTime before getBatches/initial send)
    // Second call (in poll) returns t1, triggering partial update
    mockGetLatestUpdateTime
      .mockImplementationOnce(async () => t0)
      .mockImplementationOnce(async () => t1)
    mockGetBatchIdsWithRecentChanges.mockImplementation(async () => [1])
    mockGetBatchesMinimal.mockImplementation(async () => [fakeBatchItem({ id: 1 })])

    await streamer.startStreaming(undefined, undefined, 1, 10)

    // Fire the initial setTimeout(poll, 0) and let poll's async chain complete
    jest.advanceTimersByTime(0)
    await flushPromises()
    streamer.stopStreaming()

    const partialMsgs = sender.messages.filter(
      (m) => m.type === 'BATCHES_LIST' && (m as { partial: boolean }).partial === true,
    )
    expect(partialMsgs).toHaveLength(1)
  })

  it('does not start polling loop when page > 1', async () => {
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    mockGetBatches.mockImplementation(async () => [
      fakeBatchItem({ id: 2 }),
      fakeBatchItem({ id: 3 }),
    ])
    mockCountBatches.mockImplementation(async () => 20)
    mockGetLatestUpdateTime.mockImplementation(async () => null)

    await streamer.startStreaming(undefined, undefined, 2, 10)

    // Advance past a full polling interval — no timer was scheduled so nothing fires
    jest.advanceTimersByTime(STREAM_INTERVAL_MS + 50)
    await flushPromises()
    streamer.stopStreaming()

    // Only the initial BATCHES_LIST should have been sent (no partial updates from polling)
    expect(mockGetBatchIdsWithRecentChanges).not.toHaveBeenCalled()
    const msgs = sender.messages.filter((m) => m.type === 'BATCHES_LIST')
    expect(msgs).toHaveLength(1)
    expect((msgs[0] as { partial: boolean }).partial).toBe(false)
  })

  it('does not send partial update when no batch ids changed', async () => {
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const t1 = new Date('2024-01-01T00:00:01.000Z')

    mockGetBatches.mockImplementation(async () => [fakeBatchItem({ id: 1 })])
    mockCountBatches.mockImplementation(async () => 1)
    mockGetLatestUpdateTime
      .mockImplementationOnce(async () => t0)
      .mockImplementationOnce(async () => t1)
    // No changed ids returned
    mockGetBatchIdsWithRecentChanges.mockImplementation(async () => [])

    await streamer.startStreaming(undefined, undefined, 1, 10)
    jest.advanceTimersByTime(0)
    await flushPromises()
    streamer.stopStreaming()

    const partialMsgs = sender.messages.filter(
      (m) => m.type === 'BATCHES_LIST' && (m as { partial: boolean }).partial === true,
    )
    expect(partialMsgs).toHaveLength(0)
  })
})

describe('OptimizedBatchStreamer — race condition: getLatestUpdateTime must precede getBatches', () => {
  it('fetches lastUpdateTime before the initial getBatches to close the drop window', async () => {
    // The race: if getBatches runs before getLatestUpdateTime, any change that lands
    // in that gap has its timestamp absorbed into lastUpdateTime, so the poll sees
    // current == lastUpdateTime and skips it — the change is silently dropped forever.
    // Fix: getLatestUpdateTime must run first so the poll will always detect those changes.
    const callOrder: string[] = []
    mockGetLatestUpdateTime.mockImplementation(async () => {
      callOrder.push('getLatestUpdateTime')
      return null
    })
    mockGetBatches.mockImplementation(async () => {
      callOrder.push('getBatches')
      return []
    })
    mockCountBatches.mockImplementation(async () => 0)

    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)
    await streamer.startStreaming(undefined, undefined, 1, 10)
    streamer.stopStreaming()

    const ltIdx = callOrder.indexOf('getLatestUpdateTime')
    const gbIdx = callOrder.indexOf('getBatches')
    expect(ltIdx).toBeLessThan(gbIdx)
  })

  it('delivers a new batch created in the gap (new batch scenario)', async () => {
    // With the fix, lastUpdateTime is set before getBatches runs.
    // A batch created after that point has updated_at > lastUpdateTime,
    // so the poll detects and delivers it.
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    const t1 = new Date('2024-01-01T00:00:01.000Z')

    mockGetBatches.mockImplementation(async () => [fakeBatchItem({ id: 1 })])
    mockCountBatches.mockImplementation(async () => 2)
    mockGetLatestUpdateTime
      .mockImplementationOnce(async () => null) // startStreaming: before batch2 exists
      .mockImplementation(async () => t1) // poll: batch2 now in DB
    mockGetBatchIdsWithRecentChanges.mockImplementation(async () => [2])
    mockGetBatchesMinimal.mockImplementation(async () => [fakeBatchItem({ id: 2 })])

    await streamer.startStreaming(undefined, undefined, 1, 10)
    jest.advanceTimersByTime(0)
    await flushPromises()
    streamer.stopStreaming()

    const allItems = sender.messages
      .filter((m) => m.type === 'BATCHES_LIST')
      .flatMap((m) => (m as { data: { items: { id: number }[] } }).data.items)
    expect(allItems.some((item) => item.id === 2)).toBe(true)
  })

  it('delivers a stale existing batch updated in the gap (existing batch scenario)', async () => {
    // Same ordering guarantee, existing batch: a stats update that lands after
    // lastUpdateTime is captured must reach the client via the poll.
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    const t1 = new Date('2024-01-01T00:00:01.000Z')
    const staleBatch = fakeBatchItem({ id: 1 })
    staleBatch.stats = {
      total: 1,
      queued: 1,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      duplicate: 0,
    }
    const freshBatch = fakeBatchItem({ id: 1 })
    freshBatch.stats = {
      total: 1,
      queued: 0,
      in_progress: 0,
      completed: 1,
      failed: 0,
      cancelled: 0,
      duplicate: 0,
    }

    mockGetBatches.mockImplementation(async () => [staleBatch])
    mockCountBatches.mockImplementation(async () => 1)
    mockGetLatestUpdateTime
      .mockImplementationOnce(async () => null) // startStreaming: before upload completed
      .mockImplementation(async () => t1) // poll: upload now completed
    mockGetBatchIdsWithRecentChanges.mockImplementation(async () => [1])
    mockGetBatchesMinimal.mockImplementation(async () => [freshBatch])

    await streamer.startStreaming(undefined, undefined, 1, 10)
    jest.advanceTimersByTime(0)
    await flushPromises()
    streamer.stopStreaming()

    const partialMsgs = sender.messages.filter(
      (m) => m.type === 'BATCHES_LIST' && (m as { partial: boolean }).partial === true,
    )
    expect(partialMsgs).toHaveLength(1)
    const updatedBatch = (partialMsgs[0] as { data: { items: (typeof freshBatch)[] } }).data
      .items[0]
    expect(updatedBatch?.stats.completed).toBe(1)
  })
})

describe('OptimizedBatchStreamer.stopStreaming', () => {
  it('stops the polling loop', async () => {
    const sender = makeSender()
    const streamer = new OptimizedBatchStreamer(sender, 'alice', fakeBatchService)

    const t0 = new Date('2024-01-01T00:00:00.000Z')
    const t1 = new Date('2024-01-01T00:00:01.000Z')

    mockGetBatches.mockImplementation(async () => [fakeBatchItem({ id: 1 })])
    mockCountBatches.mockImplementation(async () => 1)
    mockGetLatestUpdateTime
      .mockImplementationOnce(async () => t0)
      .mockImplementation(async () => t1)
    mockGetBatchIdsWithRecentChanges.mockImplementation(async () => [1])
    mockGetBatchesMinimal.mockImplementation(async () => [fakeBatchItem({ id: 1 })])

    await streamer.startStreaming(undefined, undefined, 1, 10)
    // Fire and complete one poll cycle
    jest.advanceTimersByTime(0)
    await flushPromises()
    streamer.stopStreaming()

    const callsAfterStop = mockGetLatestUpdateTime.mock.calls.length

    // Advance past another interval — the cleared timer must not re-fire
    jest.advanceTimersByTime(STREAM_INTERVAL_MS + 50)
    await flushPromises()
    expect(mockGetLatestUpdateTime.mock.calls.length).toBe(callsAfterStop)
  })
})
