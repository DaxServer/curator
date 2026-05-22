import { config } from '@backend/config'
import { reverseGeocodeBatch } from '@backend/core/geocoding'
import { mapillaryLogger } from '@backend/logger'
import { WIKIDATA_PROPERTY } from '@backend/mediawiki/sdc'
import type { ExistingPage, MediaImage } from '@backend/types/ws'

const MAPILLARY_FIELDS =
  'captured_at,compass_angle,creator,geometry,height,is_pano,make,model,thumb_256_url,thumb_1024_url,thumb_original_url,width'

interface MapillaryImage {
  id: string
  geometry: { type: string; coordinates: [number, number] }
  creator: { id: string; username: string }
  captured_at: number
  compass_angle?: number
  thumb_original_url?: string
  thumb_1024_url?: string
  thumb_256_url?: string
  width?: number
  height?: number
  is_pano?: boolean
  make?: string
  model?: string
}

export function fromMapillary(image: MapillaryImage): MediaImage | null {
  const { geometry, creator: owner, captured_at } = image

  if (!geometry) return null
  const coords = geometry.coordinates
  if (!coords || coords.length < 2) return null
  if (!owner) return null
  if (captured_at == null) return null

  const rawAngle = Number(image.compass_angle ?? 0)
  const compass_angle = rawAngle > 0 && rawAngle < 360 ? rawAngle : null

  const dt = new Date(Math.floor(captured_at / 1000) * 1000)
  const date = dt.toISOString().slice(0, 10)

  const make = image.make === 'none' ? null : (image.make ?? null)
  const model = image.model === 'none' ? null : (image.model ?? null)

  return {
    id: String(image.id),
    title: `Photo from Mapillary ${date} (${String(image.id)}).jpg`,
    dates: { taken: dt.toISOString() },
    creator: {
      id: String(owner.id),
      username: String(owner.username ?? 'Unknown'),
      profile_url: `https://www.mapillary.com/app/user/${owner.username ?? 'unknown'}`,
    },
    location: {
      latitude: coords[1],
      longitude: coords[0],
      compass_angle,
    },
    urls: {
      url: `https://www.mapillary.com/app/?pKey=${image.id}&focus=photo`,
      original: String(image.thumb_original_url ?? ''),
      preview: String(image.thumb_1024_url ?? ''),
      thumbnail: String(image.thumb_256_url ?? ''),
    },
    dimensions: {
      width: Number(image.width ?? 0),
      height: Number(image.height ?? 0),
    },
    camera: {
      make,
      model,
      is_pano: Boolean(image.is_pano),
    },
    existing: [],
  }
}

async function fetchSequenceData(sequenceId: string): Promise<MapillaryImage[]> {
  const url = new URL('https://graph.mapillary.com/images')
  url.searchParams.set('sequence_ids', sequenceId)
  url.searchParams.set('fields', MAPILLARY_FIELDS)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.mapillaryApiToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Mapillary API error: ${res.status}`)

  const data = (await res.json()) as { data: MapillaryImage[] }
  const images = data.data
  images.sort((a, b) => a.captured_at - b.captured_at)
  return images
}

async function getSequenceIds(sequenceId: string): Promise<string[]> {
  const url = new URL('https://graph.mapillary.com/images')
  url.searchParams.set('sequence_ids', sequenceId)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.mapillaryApiToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Mapillary API error: ${res.status}`)

  const data = (await res.json()) as { data: { id: string }[] }
  return data.data.map((i) => String(i.id))
}

async function fetchImagesByIds(imageIds: string[]): Promise<MapillaryImage[]> {
  if (imageIds.length === 0) return []

  const url = new URL('https://graph.mapillary.com')
  url.searchParams.set('ids', imageIds.join(','))
  url.searchParams.set('fields', MAPILLARY_FIELDS)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${config.mapillaryApiToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Mapillary API error: ${res.status}`)

  const data = (await res.json()) as Record<string, MapillaryImage>
  return Object.values(data)
}

async function resolveSequenceIdFromImage(imageId: string): Promise<string | null> {
  const res = await fetch(`https://graph.mapillary.com/${imageId}?fields=sequence`, {
    headers: { Authorization: `Bearer ${config.mapillaryApiToken}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`Mapillary API error: ${res.status}`)

  const data = (await res.json()) as { sequence?: string }
  return data.sequence ?? null
}

export async function fetchExistingPages(
  imageIds: string[],
): Promise<Record<string, ExistingPage[]>> {
  const numericIds = imageIds.filter((id) => /^\d+$/.test(id))
  if (numericIds.length < imageIds.length) {
    mapillaryLogger.warn(
      { skipped: imageIds.length - numericIds.length },
      'Skipping non-numeric Mapillary IDs in SPARQL query',
    )
  }
  const validIds = [...new Set(numericIds)]
  if (validIds.length === 0) return {}

  const values = validIds.map((id) => `"${id}"`).join(' ')
  const query = `SELECT ?file ?id WHERE {
  VALUES ?id { ${values} }
  ?file wdt:${WIKIDATA_PROPERTY.MapillaryPhotoID} ?id.
}`

  const body = `query=${encodeURIComponent(query)}`
  const cookieJar: Record<string, string> = { wcqsOauth: config.wcqsOauthToken }
  let url = 'https://commons-query.wikimedia.org/sparql'

  mapillaryLogger.debug({ imageCount: imageIds.length, url }, 'WCQS query start')

  const request = () =>
    fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': config.userAgent,
        Cookie: Object.entries(cookieJar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
      },
      body,
      redirect: 'manual',
    })

  let res = await request()
  mapillaryLogger.debug({ status: res.status, url }, 'WCQS initial response')

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    const setCookies = res.headers.getSetCookie()
    mapillaryLogger.debug({ status: res.status, location, setCookies }, 'WCQS redirect')
    if (location) {
      for (const c of setCookies) {
        const nameValue = c.slice(0, c.indexOf(';') < 0 ? c.length : c.indexOf(';')).trim()
        const eq = nameValue.indexOf('=')
        if (eq > 0) cookieJar[nameValue.slice(0, eq)] = nameValue.slice(eq + 1)
      }
      url = new URL(location, url).toString()
      res = await request()
      mapillaryLogger.debug({ status: res.status, url }, 'WCQS post-redirect response')
    }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)')
    mapillaryLogger.error({ status: res.status, url, body }, 'WCQS SPARQL error')
    throw new Error(`WCQS SPARQL error: ${res.status}`)
  }

  const data = (await res.json()) as {
    results: { bindings: { file: { value: string }; id: { value: string } }[] }
  }

  const matchCount = data.results.bindings.length
  mapillaryLogger.debug({ imageCount: imageIds.length, matchCount }, 'WCQS query complete')

  const existing: Record<string, ExistingPage[]> = {}
  for (const binding of data.results.bindings) {
    const imageId = binding.id.value
    const fileUrl = binding.file.value
    if (!existing[imageId]) existing[imageId] = []
    existing[imageId].push({ url: fileUrl })
  }
  return existing
}

export class MapillaryHandler {
  readonly name = 'mapillary'

  async fetchCollection(input: string): Promise<{ images: MediaImage[]; sequenceId: string }> {
    let sequenceId = input

    if (input.startsWith('https://www.mapillary.com/app/') && input.includes('?')) {
      const params = new URLSearchParams(input.split('?')[1])
      const pKey = params.get('pKey')
      if (pKey) {
        const resolved = await resolveSequenceIdFromImage(pKey)
        if (resolved) sequenceId = resolved
      }
    }

    const raw = await fetchSequenceData(sequenceId)
    const images = raw.map(fromMapillary).filter((i): i is MediaImage => i !== null)

    await reverseGeocodeBatch(images)

    return { images, sequenceId }
  }

  async fetchCollectionIds(input: string): Promise<string[]> {
    return getSequenceIds(input)
  }

  async fetchImagesBatch(imageIds: string[], _input: string): Promise<MediaImage[]> {
    const raw = await fetchImagesByIds(imageIds)
    return raw.map(fromMapillary).filter((i): i is MediaImage => i !== null)
  }

  async fetchExistingPages(imageIds: string[]): Promise<Record<string, ExistingPage[]>> {
    return fetchExistingPages(imageIds)
  }
}
