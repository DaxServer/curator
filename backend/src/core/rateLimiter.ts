import type { MediaWikiClient } from '@backend/mediawiki/client'
import type { Redis } from 'ioredis'

export interface RateLimitInfo {
  uploadsPerPeriod: number
  periodSeconds: number
}

const RATE_LIMIT_DEFAULT_NORMAL = 10
const RATE_LIMIT_DEFAULT_PERIOD = 60
const NEXT_AVAILABLE_KEY = 'ratelimit:{userid}:next_available'
const NO_RATE_LIMIT: RateLimitInfo = { uploadsPerPeriod: 9999, periodSeconds: 60 }

export const RATE_LIMIT_DEFAULT: RateLimitInfo = {
  uploadsPerPeriod: RATE_LIMIT_DEFAULT_NORMAL,
  periodSeconds: RATE_LIMIT_DEFAULT_PERIOD,
}

function mostPermissive(
  limits: Record<string, { hits: number; seconds: number }>,
): [number, number] | null {
  let best: [number, number] | null = null
  let bestRate = -1.0
  for (const limit of Object.values(limits)) {
    const rate = limit.hits / limit.seconds
    if (rate > bestRate) {
      bestRate = rate
      best = [limit.hits, limit.seconds]
    }
  }
  return best
}

function moreRestrictive(
  a: [number, number] | null,
  b: [number, number] | null,
): [number, number] | null {
  if (a === null) return b
  if (b === null) return a
  return a[0] / a[1] <= b[0] / b[1] ? a : b
}

export async function getRateLimitForBatch(
  _userid: string,
  client: MediaWikiClient,
): Promise<RateLimitInfo> {
  const { ratelimits, rights } = await client.getUserRateLimits()

  if (rights.includes('noratelimit')) {
    return NO_RATE_LIMIT
  }

  const uploadLimits = ratelimits.upload ?? {}
  const editLimits = ratelimits.edit ?? {}

  const bestUpload = mostPermissive(uploadLimits)
  const bestEdit = mostPermissive(editLimits)

  const adjustedEdit =
    bestEdit !== null
      ? ([Math.max(1, Math.floor(bestEdit[0] / 2)), bestEdit[1]] as [number, number])
      : null

  const effective = moreRestrictive(bestUpload, adjustedEdit)

  if (effective === null) {
    return {
      uploadsPerPeriod: RATE_LIMIT_DEFAULT_NORMAL,
      periodSeconds: RATE_LIMIT_DEFAULT_PERIOD,
    }
  }

  return {
    uploadsPerPeriod: effective[0],
    periodSeconds: effective[1],
  }
}

export async function getNextUploadDelay(
  userid: string,
  rateLimit: RateLimitInfo,
  redis: Redis,
): Promise<number> {
  const cacheKey = NEXT_AVAILABLE_KEY.replace('{userid}', userid)
  const currentTime = Date.now() / 1000

  const nextAvailableStr = await redis.get(cacheKey)
  const nextAvailable = nextAvailableStr ? parseFloat(nextAvailableStr) : currentTime

  const delay = Math.max(0.0, nextAvailable - currentTime)
  if (rateLimit.uploadsPerPeriod === 0) return delay * 1000
  const spacing = (rateLimit.periodSeconds / rateLimit.uploadsPerPeriod) * 1.5

  const newNextAvailable = Math.max(currentTime, nextAvailable) + spacing
  await redis.set(cacheKey, String(newNextAvailable))

  return delay * 1000
}
