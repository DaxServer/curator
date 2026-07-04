import { makeRedisMock } from '@backend/__tests__/helpers'
import {
  getNextUploadDelay,
  getRateLimitForBatch,
  type RateLimitInfo,
} from '@backend/core/rateLimiter'
import type { MediaWikiClient } from '@backend/mediawiki/client'
import { describe, expect, it, mock } from 'bun:test'

const makeMwClient = (
  overrides: Partial<Awaited<ReturnType<MediaWikiClient['getUserRateLimits']>>> = {},
) =>
  ({
    getUserRateLimits: mock(async () => ({
      ratelimits: {},
      rights: [],
      ...overrides,
    })),
  }) as unknown as MediaWikiClient

describe('getRateLimitForBatch', () => {
  it('returns cached value without calling MediaWiki on cache hit', async () => {
    const cached: RateLimitInfo = { uploadsPerPeriod: 20, periodSeconds: 30 }
    const { redis, getMock } = makeRedisMock(JSON.stringify(cached))
    const client = makeMwClient()

    const result = await getRateLimitForBatch('u1', client, redis)

    expect(result).toEqual(cached)
    expect(client.getUserRateLimits as ReturnType<typeof mock>).not.toHaveBeenCalled()
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('u1'))
  })

  it('calls MediaWiki and caches result with 1-hour TTL on cache miss', async () => {
    const { redis, setMock } = makeRedisMock(null)
    const client = makeMwClient({
      ratelimits: { upload: { user: { hits: 8, seconds: 60 } } },
      rights: [],
    })

    const result = await getRateLimitForBatch('u1', client, redis)

    expect(client.getUserRateLimits as ReturnType<typeof mock>).toHaveBeenCalledTimes(1)
    expect(setMock).toHaveBeenCalledTimes(1)
    const [key, value, ex, ttl] = (
      setMock.mock.calls as unknown as [string, string, string, number][]
    )[0]
    expect(key).toContain('u1')
    expect(JSON.parse(value)).toEqual(result)
    expect(ex).toBe('EX')
    expect(ttl).toBe(3600)
  })

  it('does not call MediaWiki again within the cache window', async () => {
    let stored: string | null = null
    const redis = {
      get: mock(async () => stored),
      set: mock(async (_k: string, v: string) => {
        stored = v
        return 'OK' as const
      }),
      del: mock(async () => 1),
    } as unknown as import('ioredis').Redis
    const client = makeMwClient()

    await getRateLimitForBatch('u1', client, redis)
    await getRateLimitForBatch('u1', client, redis)

    expect(client.getUserRateLimits as ReturnType<typeof mock>).toHaveBeenCalledTimes(1)
  })
})

describe('getNextUploadDelay', () => {
  it('returns the existing delay without updating Redis when uploadsPerPeriod is 0', async () => {
    const { redis, setMock } = makeRedisMock()
    const delay = await getNextUploadDelay('u1', { uploadsPerPeriod: 0, periodSeconds: 60 }, redis)
    expect(delay).toBe(0)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('returns a non-zero delay and skips Redis update when next_available is in the future and uploadsPerPeriod is 0', async () => {
    const futureTs = String(Date.now() / 1000 + 30)
    const { redis, setMock } = makeRedisMock(futureTs)
    const delay = await getNextUploadDelay('u1', { uploadsPerPeriod: 0, periodSeconds: 60 }, redis)
    expect(delay).toBeGreaterThan(0)
    expect(setMock).not.toHaveBeenCalled()
  })

  it('updates Redis next_available when uploadsPerPeriod is non-zero', async () => {
    const { redis, setMock } = makeRedisMock()
    await getNextUploadDelay('u1', { uploadsPerPeriod: 10, periodSeconds: 60 }, redis)
    expect(setMock).toHaveBeenCalledTimes(1)
    const [key, value] = (setMock.mock.calls as unknown as [string, string][])[0]
    expect(key).toContain('u1')
    expect(Number(value)).toBeGreaterThan(Date.now() / 1000)
  })
})
