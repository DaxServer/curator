import { makeRedisMock } from '@backend/__tests__/helpers'
import { getNextUploadDelay } from '@backend/core/rateLimiter'
import { describe, expect, it } from 'bun:test'

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
