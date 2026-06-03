import {
  buildStatementsFromMapillaryImage,
  computeLabelsDelta,
  mergeSdcStatements,
} from '@backend/mediawiki/sdc'
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

// ---------------------------------------------------------------------------
// mergeSdcStatements — proves the deduplication bug: without this function the
// worker would call applySdc with ALL statements on every duplicate hit, causing
// wbeditentity to append duplicate claims (one per re-upload attempt).
// ---------------------------------------------------------------------------

// Simulates what fetchSdc() returns: the same statements but with Wikidata IDs
// added (as the real API would include for pre-existing statements).
function simulateExistingSdc(
  statements: unknown[],
): Record<string, unknown[]> {
  const existing: Record<string, unknown[]> = {}
  for (const stmt of statements as Array<{ mainsnak: { property: string }; [k: string]: unknown }>) {
    const prop = stmt.mainsnak.property
    if (!existing[prop]) existing[prop] = []
    existing[prop].push({ ...stmt, id: `M1$${prop}-fake-id` })
  }
  return existing
}

describe('mergeSdcStatements — bug: duplicate statements on repeated applySdc calls', () => {
  it('returns empty delta when all statements already exist — applySdc must NOT be called', () => {
    // This is the core bug: before the fix, the worker always sent all claims,
    // creating duplicates. After the fix, when existing SDC fully matches, the
    // delta is empty and applySdc is skipped.
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false)
    const existing = simulateExistingSdc(newStatements)
    const delta = mergeSdcStatements(existing, newStatements)
    expect(delta).toHaveLength(0)
  })

  it('returns all statements as delta when existing SDC is empty (first-time setup)', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false)
    const delta = mergeSdcStatements({}, newStatements)
    expect(delta).toHaveLength(newStatements.length)
  })

  it('returns only the missing statements when some properties are already set', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    // Pre-populate only P1947 (Mapillary Photo ID) in existing SDC
    const photoIdStmt = newStatements.find((s) => s.mainsnak?.property === 'P1947')!
    const existing: Record<string, unknown[]> = {
      P1947: [{ ...photoIdStmt, id: 'M1$P1947-fake' }],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    // P1947 already present — should not be duplicated
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1947')
    // All other properties should appear in the delta
    const otherProps = newStatements
      .map((s) => s.mainsnak?.property)
      .filter((p) => p !== 'P1947')
    for (const prop of otherProps) {
      expect(deltaProps).toContain(prop)
    }
  })

  it('does not overwrite a conflicting string value — keeps existing, skips new', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const photoIdStmt = newStatements.find((s) => s.mainsnak?.property === 'P1947')!
    // Existing SDC has a DIFFERENT photo ID for this property
    const existing: Record<string, unknown[]> = {
      P1947: [
        {
          ...photoIdStmt,
          id: 'M1$P1947-fake',
          mainsnak: {
            ...photoIdStmt.mainsnak,
            datavalue: { value: 'different-photo-id', type: 'string' },
          },
        },
      ],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    // The conflicting P1947 must not appear in the delta
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1947')
  })

  it('skips globe-coordinate statement when coordinates already exist on the file', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const coordStmt = newStatements.find((s) => s.mainsnak?.property === 'P1259')!
    // Existing SDC already has a coordinate (possibly from a prior upload)
    const existing: Record<string, unknown[]> = {
      P1259: [{ ...coordStmt, id: 'M1$P1259-fake' }],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1259')
  })

  it('merges missing qualifier into an existing matching statement', () => {
    // Creator (P170) is a somevalue snak with qualifiers.
    // Simulate existing SDC that has the P170 statement but is missing P13988 (Mapillary username).
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as Array<{
      mainsnak: { property: string; snaktype: string }
      qualifiers?: Record<string, unknown[]>
      'qualifiers-order'?: string[]
      [k: string]: unknown
    }>
    const creatorStmt = newStatements.find((s) => s.mainsnak?.property === 'P170')!

    // Strip P13988 from the existing version to simulate the missing qualifier
    const existingQualifiers: Record<string, unknown[]> = {}
    for (const [prop, snaks] of Object.entries(creatorStmt.qualifiers ?? {})) {
      if (prop !== 'P13988') existingQualifiers[prop] = snaks
    }
    const existingCreator = {
      ...creatorStmt,
      id: 'M1$P170-fake',
      qualifiers: existingQualifiers,
      'qualifiers-order': Object.keys(existingQualifiers),
    }
    const existing: Record<string, unknown[]> = { P170: [existingCreator] }

    const delta = mergeSdcStatements(existing, newStatements)
    const deltaProps = (delta as typeof newStatements).map((s) => s.mainsnak?.property)

    // P170 must be in the delta because qualifiers changed
    expect(deltaProps).toContain('P170')
    // The returned statement must carry the existing ID so wbeditentity updates rather than adds
    const updatedCreator = (delta as typeof newStatements).find(
      (s) => s.mainsnak?.property === 'P170',
    )!
    expect((updatedCreator as { id?: string }).id).toBe('M1$P170-fake')
    // P13988 must now be present in the merged qualifiers
    expect(Object.keys((updatedCreator as { qualifiers?: Record<string, unknown> }).qualifiers ?? {})).toContain('P13988')
  })
})

// ---------------------------------------------------------------------------
// computeLabelsDelta
// ---------------------------------------------------------------------------

describe('computeLabelsDelta', () => {
  it('returns null when newLabels is null', () => {
    expect(computeLabelsDelta({}, null)).toBeNull()
  })

  it('returns null when existing labels already match', () => {
    const existing = { en: { language: 'en', value: 'My photo' } }
    const newLabels = { en: { language: 'en', value: 'My photo' } }
    expect(computeLabelsDelta(existing, newLabels)).toBeNull()
  })

  it('returns delta when existing value differs', () => {
    const existing = { en: { language: 'en', value: 'Old title' } }
    const newLabels = { en: { language: 'en', value: 'New title' } }
    const delta = computeLabelsDelta(existing, newLabels)
    expect(delta).toEqual({ en: { language: 'en', value: 'New title' } })
  })

  it('returns label when existing has no entry for that language', () => {
    const existing = { fr: { language: 'fr', value: 'Bonjour' } }
    const newLabels = { en: { language: 'en', value: 'Hello' } }
    const delta = computeLabelsDelta(existing, newLabels)
    expect(delta).toEqual({ en: { language: 'en', value: 'Hello' } })
  })

  it('returns null when existing is null/undefined and newLabels is null', () => {
    expect(computeLabelsDelta(null, null)).toBeNull()
    expect(computeLabelsDelta(undefined, null)).toBeNull()
  })
})
