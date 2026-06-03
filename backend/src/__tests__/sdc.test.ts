import { buildStatementsFromMapillaryImage } from '@backend/mediawiki/sdc'
import type { MediaImage } from '@backend/types/ws'
import { describe, expect, it } from 'bun:test'

const baseImage: MediaImage = {
  id: 'img123',
  title: 'test.jpg',
  dates: { taken: '2023-06-15T10:30:00Z' },
  creator: { id: 'u1', username: 'testuser', profile_url: 'https://example.com' },
  location: { latitude: 48.85, longitude: 2.35, compass_angle: null },
  urls: {
    url: 'https://example.com/img',
    original: 'https://example.com/img',
    preview: 'https://example.com/img',
    thumbnail: 'https://example.com/img',
  },
  dimensions: { width: 1920, height: 1080 },
  camera: { make: null, model: null, is_pano: false },
  existing: [],
}

type AnyClaim = {
  mainsnak: {
    property?: string
    datavalue?: { value?: { time?: string } & Record<string, unknown>; type?: string }
  }
  qualifiers?: Record<string, { datavalue?: { type?: string } }[]>
}

describe('buildStatementsFromMapillaryImage / externalIdSnak', () => {
  it('uses datavalue type "string" not "external-id" (wbeditentity rejects external-id)', () => {
    const claims = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const externalIdClaims = claims.filter((c) => c.mainsnak?.datavalue?.type !== undefined)
    for (const claim of externalIdClaims) {
      expect(claim.mainsnak.datavalue!.type).not.toBe('external-id')
    }
    // MapillaryPhotoID claim must be type string
    const photoIdClaim = claims.find((c) => c.mainsnak?.property === 'P1947')
    expect(photoIdClaim?.mainsnak?.datavalue?.type).toBe('string')
  })

  it('qualifiers with external-id snaks also use type "string"', () => {
    const claims = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const creatorClaim = claims.find((c) => c.mainsnak?.property === 'P170')
    const qualifierSnaks = Object.values(creatorClaim?.qualifiers ?? {}).flat()
    for (const snak of qualifierSnaks) {
      if (snak.datavalue) expect(snak.datavalue.type).not.toBe('external-id')
    }
  })
})

describe('buildStatementsFromMapillaryImage / timeSnak', () => {
  it('produces the correct Wikidata time string for a Z-suffix date', () => {
    const claims = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const inceptionClaim = claims.find((c) => c.mainsnak?.datavalue?.value?.time !== undefined)
    expect(inceptionClaim?.mainsnak?.datavalue?.value?.time).toBe('+00000002023-06-15T00:00:00Z')
  })

  it('throws a descriptive error for an invalid date string', () => {
    const bad = { ...baseImage, dates: { taken: 'not-a-date' } }
    expect(() => buildStatementsFromMapillaryImage(bad, false)).toThrow(
      'Invalid date provided for SDC: not-a-date',
    )
  })
})
