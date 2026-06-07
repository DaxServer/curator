import { config } from '@backend/config'
import { elapsed, logger } from '@backend/core/logger'
import type { GeoLocation, MediaImage } from '@backend/types/ws'

class Semaphore {
  private count: number
  private queue: (() => void)[] = []

  constructor(count: number) {
    this.count = count
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--
      return
    }
    return new Promise((resolve) => this.queue.push(resolve))
  }

  release(): void {
    this.count++
    if (this.queue.length > 0) {
      this.count--
      const resolve = this.queue.shift()!
      resolve()
    }
  }
}

const semaphore = new Semaphore(Number(config.geocodingConcurrencyLimit))

async function reverseGeocode(
  lat: number,
  lon: number,
  semaphore: Semaphore,
): Promise<Partial<GeoLocation> | null> {
  await semaphore.acquire()
  try {
    const url = new URL(config.geocodingApiUrl)
    url.searchParams.set('lat', String(lat))
    url.searchParams.set('lon', String(lon))
    url.searchParams.set('zoom', '18')
    url.searchParams.set('format', 'jsonv2')

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = (await res.json()) as { address?: Record<string, string> }
    const address = data.address ?? {}
    return {
      city: address.city ?? address.town ?? null,
      county: address.county ?? null,
      state: address.state ?? null,
      country: address.country ?? null,
      country_code: address.country_code ?? null,
      postcode: address.postcode ?? null,
    }
  } catch {
    return null
  } finally {
    semaphore.release()
  }
}

export async function reverseGeocodeBatch(images: MediaImage[]): Promise<void> {
  const tasks = images
    .filter((img) => img.location?.latitude != null && img.location?.longitude != null)
    .map((img) => ({
      img,
      promise: reverseGeocode(img.location.latitude, img.location.longitude, semaphore),
    }))

  logger.info(`[geocoding] reverse geocoding ${tasks.length} images`)
  const start = process.hrtime.bigint()
  const results = await Promise.all(tasks.map((t) => t.promise))

  let geocoded = 0
  for (let i = 0; i < tasks.length; i++) {
    const { img } = tasks[i]!
    const result = results[i]
    if (result && img.location) {
      img.location.city = result.city ?? img.location.city
      img.location.county = result.county ?? img.location.county
      img.location.state = result.state ?? img.location.state
      img.location.country = result.country ?? img.location.country
      img.location.country_code = result.country_code ?? img.location.country_code
      img.location.postcode = result.postcode ?? img.location.postcode
      geocoded++
    }
  }
  logger.info(`[geocoding] geocoded ${geocoded}/${tasks.length} images | ${elapsed(start)}`)
}
