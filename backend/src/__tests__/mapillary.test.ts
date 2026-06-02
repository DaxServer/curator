import { fetchExistingPages, fromMapillary } from '@backend/handlers/mapillary'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

const BASE = {
  id: 'img123',
  geometry: { type: 'Point', coordinates: [-73.985, 40.748] as [number, number] },
  creator: { id: 'u1', username: 'alice' },
  captured_at: 1_700_000_000_000,
  compass_angle: 90,
  thumb_original_url: 'https://example.com/orig.jpg',
  thumb_1024_url: 'https://example.com/1024.jpg',
  thumb_256_url: 'https://example.com/256.jpg',
  width: 4000,
  height: 3000,
  is_pano: false,
  make: 'Sony',
  model: 'RX1',
}

describe('fetchExistingPages', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns existing pages from SPARQL bindings', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: {
            bindings: [
              {
                file: { value: 'https://commons.wikimedia.org/entity/M123' },
                id: { value: '111111111' },
              },
            ],
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const result = await fetchExistingPages(['111111111'])

    expect(result).toEqual({
      '111111111': [{ url: 'https://commons.wikimedia.org/entity/M123' }],
    })
  })

  it('skips non-numeric IDs and returns {} without fetching', async () => {
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchExistingPages(['img1', '} UNION { ?x ?y ?z'])

    expect(fetchCalled).toBe(false)
    expect(result).toEqual({})
  })

  it('filters non-numeric IDs and only queries valid ones', async () => {
    let capturedBody = ''
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = init?.body as string
      return new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 })
    }) as unknown as typeof fetch

    await fetchExistingPages(['222222222', 'bad} injection', '333333333'])

    const decoded = decodeURIComponent(capturedBody)
    expect(decoded).toContain('"222222222"')
    expect(decoded).toContain('"333333333"')
    expect(decoded).not.toContain('bad')
  })

  it('follows WCQS redirect and re-sends wcqsOauth plus Set-Cookie cookies', async () => {
    let callCount = 0
    const capturedCookies: string[] = []

    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      callCount++
      capturedCookies.push((init?.headers as Record<string, string>).Cookie ?? '')

      if (callCount === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: 'https://commons-query.wikimedia.org/sparql',
            'Set-Cookie': 'WMF-Last-Access=17-May-2026; Path=/; HttpOnly',
          },
        })
      }
      return new Response(JSON.stringify({ results: { bindings: [] } }), { status: 200 })
    }) as unknown as typeof fetch

    await fetchExistingPages(['111111111'])

    expect(callCount).toBe(2)
    expect(capturedCookies[1]).toContain('wcqsOauth=')
    expect(capturedCookies[1]).toContain('WMF-Last-Access=17-May-2026')
  })
})

describe('fromMapillary', () => {
  it('converts a full image record correctly', () => {
    const result = fromMapillary(BASE)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('img123')
    expect(result!.creator.username).toBe('alice')
    expect(result!.location.longitude).toBe(-73.985)
    expect(result!.location.latitude).toBe(40.748)
    expect(result!.location.compass_angle).toBe(90)
    expect(result!.camera.make).toBe('Sony')
    expect(result!.camera.model).toBe('RX1')
    expect(result!.camera.is_pano).toBe(false)
    expect(result!.dimensions.width).toBe(4000)
    expect(result!.dimensions.height).toBe(3000)
    expect(result!.urls.original).toBe('https://example.com/orig.jpg')
    expect(result!.urls.preview).toBe('https://example.com/1024.jpg')
    expect(result!.urls.thumbnail).toBe('https://example.com/256.jpg')
    expect(result!.existing).toEqual([])
  })

  it('builds title from date and id', () => {
    const result = fromMapillary(BASE)
    expect(result!.title).toBe('Photo from Mapillary 2023-11-14 (img123).jpg')
  })

  it.each([
    [0, null],
    [360, null],
    [359, 359],
  ] as const)('maps compass_angle=%s to %s', (angle, expected) => {
    const result = fromMapillary({ ...BASE, compass_angle: angle })
    expect(result!.location.compass_angle).toBe(expected)
  })

  it.each(['make', 'model'] as const)('strips camera.%s="none" to null', (field) => {
    const result = fromMapillary({ ...BASE, [field]: 'none' })
    expect(result!.camera[field]).toBeNull()
  })

  it.each([
    ['geometry is missing', { geometry: null as never }],
    [
      'coords has fewer than 2 elements',
      { geometry: { type: 'Point', coordinates: [-73.985] as never } },
    ],
    ['creator is missing', { creator: null as never }],
    ['captured_at is null', { captured_at: null as never }],
  ])('returns null when %s', (_, override) => {
    const result = fromMapillary({ ...BASE, ...override })
    expect(result).toBeNull()
  })

  it('falls back to "Unknown" when creator username is missing', () => {
    const result = fromMapillary({ ...BASE, creator: { id: 'u1', username: null as never } })
    expect(result!.creator.username).toBe('Unknown')
  })

  it('millisecond timestamp is floored to nearest second', () => {
    const result = fromMapillary({ ...BASE, captured_at: 1_700_000_000_999 })
    expect(result!.dates.taken).toBe(new Date(1_700_000_000_000).toISOString())
  })
})
