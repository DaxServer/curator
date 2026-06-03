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
// mergeSdcStatements — additive non-destructive merge of Wikidata statements.
//
// Converts the flat list from buildStatementsFromMapillaryImage into a delta
// that can be sent directly to wbeditentity: statements with an existing id
// are qualifier-updates, statements without an id are new additions.  Nothing
// is ever removed or overwritten.
// ---------------------------------------------------------------------------

// Mirrors what fetchSdc() returns: statements with Wikidata IDs already present.
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

describe('mergeSdcStatements', () => {
  it('returns empty delta when all statements already exist', () => {
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

  it('returns only absent properties in delta when some are already present', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const photoIdStmt = newStatements.find((s) => s.mainsnak?.property === 'P1947')!
    const existing: Record<string, unknown[]> = {
      P1947: [{ ...photoIdStmt, id: 'M1$P1947-fake' }],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1947')
    const otherProps = newStatements
      .map((s) => s.mainsnak?.property)
      .filter((p) => p !== 'P1947')
    for (const prop of otherProps) {
      expect(deltaProps).toContain(prop)
    }
  })

  it('skips a conflicting value — keeps existing, omits new', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const photoIdStmt = newStatements.find((s) => s.mainsnak?.property === 'P1947')!
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
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1947')
  })

  it('skips the globe-coordinate property whenever it already exists, regardless of value', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const coordStmt = newStatements.find((s) => s.mainsnak?.property === 'P1259')!
    const existing: Record<string, unknown[]> = {
      P1259: [{ ...coordStmt, id: 'M1$P1259-fake' }],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1259')
  })

  it('merges missing qualifier into an existing matching statement', () => {
    type StmtWithQuals = {
      mainsnak: { property: string; snaktype: string }
      qualifiers?: Record<string, unknown[]>
      'qualifiers-order'?: string[]
      [k: string]: unknown
    }
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as StmtWithQuals[]
    const creatorStmt = newStatements.find((s) => s.mainsnak?.property === 'P170')!

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

    const delta = mergeSdcStatements({ P170: [existingCreator] }, newStatements)
    const deltaProps = (delta as StmtWithQuals[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).toContain('P170')

    const updatedCreator = (delta as StmtWithQuals[]).find((s) => s.mainsnak?.property === 'P170')!
    expect((updatedCreator as { id?: string }).id).toBe('M1$P170-fake')
    expect(
      Object.keys((updatedCreator as { qualifiers?: Record<string, unknown> }).qualifiers ?? {}),
    ).toContain('P13988')
  })

  it('skips the globe-coordinate property even when the new coords differ from existing', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const coordStmt = newStatements.find((s) => s.mainsnak?.property === 'P1259')!
    const existing: Record<string, unknown[]> = {
      P1259: [
        {
          ...coordStmt,
          id: 'M1$P1259-fake',
          mainsnak: {
            ...coordStmt.mainsnak,
            datavalue: {
              value: { latitude: 51.5, longitude: -0.1, altitude: null, precision: 1e-9, globe: 'http://www.wikidata.org/entity/Q2' },
              type: 'globecoordinate',
            },
          },
        },
      ],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1259')
  })

  it('matches the correct statement when multiple exist for the same property', () => {
    // Two P1433 (Published In) statements: one for an unrelated database (Q123, first),
    // and one for Mapillary (Q26757498, second). The merge must skip the non-matching first
    // statement and find the match in the second — neither needs updating here.
    // (P170 is unsuitable for this test because all somevalue mainsnaks compare equal.)
    type Stmt = {
      mainsnak: { property: string; snaktype: string; datavalue?: { value: unknown; type: string } }
      qualifiers?: Record<string, unknown[]>
      'qualifiers-order'?: string[]
      [k: string]: unknown
    }
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as Stmt[]
    const publishedInStmt = newStatements.find((s) => s.mainsnak.property === 'P1433')!

    const otherDb = {
      mainsnak: { snaktype: 'value', property: 'P1433', datavalue: { value: { 'entity-type': 'item', 'numeric-id': 123 }, type: 'wikibase-entityid' } },
      type: 'statement', rank: 'normal', id: 'M1$P1433-other',
    }
    const mapillaryDb = { ...publishedInStmt, id: 'M1$P1433-mapillary' }

    const delta = mergeSdcStatements({ P1433: [otherDb, mapillaryDb] }, newStatements)
    const p1433Deltas = (delta as Stmt[]).filter((s) => s.mainsnak.property === 'P1433')
    expect(p1433Deltas).toHaveLength(0)

    const deltaIds = (delta as Array<{ id?: string }>).map((s) => s.id)
    expect(deltaIds).not.toContain('M1$P1433-other')
    expect(deltaIds).not.toContain('M1$P1433-mapillary')
  })

  it('adds only the absent qualifier when qualifiers partially overlap', () => {
    type StmtWithQuals = {
      mainsnak: { property: string; snaktype: string }
      qualifiers?: Record<string, unknown[]>
      'qualifiers-order'?: string[]
      [k: string]: unknown
    }
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as StmtWithQuals[]
    const creatorStmt = newStatements.find((s) => s.mainsnak.property === 'P170')!

    const existingQualifiers: Record<string, unknown[]> = {}
    for (const [prop, snaks] of Object.entries(creatorStmt.qualifiers ?? {})) {
      if (prop === 'P2093') existingQualifiers[prop] = snaks
    }
    const existingCreator = {
      ...creatorStmt,
      id: 'M1$P170-fake',
      qualifiers: existingQualifiers,
      'qualifiers-order': ['P2093'],
    }

    const delta = mergeSdcStatements({ P170: [existingCreator] }, newStatements)
    const updatedCreator = (delta as StmtWithQuals[]).find((s) => s.mainsnak.property === 'P170')!
    const mergedQuals = (updatedCreator as { qualifiers?: Record<string, unknown[]> }).qualifiers ?? {}

    expect(Object.keys(mergedQuals)).toContain('P13988')
    expect(mergedQuals['P2093']).toHaveLength(1)
  })

  it('preserves existing qualifiers absent from the new statement', () => {
    // Existing P170 has an extra qualifier P373 that was added manually.
    // The new statement has only P2093 + P13988. After merge, P373 must still be present.
    type StmtWithQuals = {
      mainsnak: { property: string; snaktype: string }
      qualifiers?: Record<string, unknown[]>
      'qualifiers-order'?: string[]
      [k: string]: unknown
    }
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as StmtWithQuals[]
    const creatorStmt = newStatements.find((s) => s.mainsnak.property === 'P170')!

    const extraSnak = { snaktype: 'value', property: 'P373', datavalue: { value: 'Mapillary', type: 'string' } }
    const existingCreator = {
      ...creatorStmt,
      id: 'M1$P170-fake',
      qualifiers: { ...(creatorStmt.qualifiers ?? {}), P373: [extraSnak] },
      'qualifiers-order': [...(creatorStmt['qualifiers-order'] ?? []), 'P373'],
    }

    const delta = mergeSdcStatements({ P170: [existingCreator] }, newStatements)
    const deltaProps = (delta as StmtWithQuals[]).map((s) => s.mainsnak.property)

    expect(deltaProps).not.toContain('P170')

    const otherProps = newStatements.map((s) => s.mainsnak.property).filter((p) => p !== 'P170')
    for (const prop of otherProps) {
      expect(deltaProps).toContain(prop)
    }
  })

  it('treats a property mapped to an empty array the same as absent', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false)
    const delta = mergeSdcStatements({ P1947: [] }, newStatements)
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).toContain('P1947')
  })

  it('emits nothing for a matching statement that has no qualifiers', () => {
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as AnyClaim[]
    const photoIdStmt = newStatements.find((s) => s.mainsnak?.property === 'P1947')!
    const existing: Record<string, unknown[]> = {
      P1947: [{ ...photoIdStmt, id: 'M1$P1947-fake' }],
    }
    const delta = mergeSdcStatements(existing, newStatements)
    const deltaProps = (delta as AnyClaim[]).map((s) => s.mainsnak?.property)
    expect(deltaProps).not.toContain('P1947')
  })

  it('appends new qualifier property to qualifiers-order', () => {
    type StmtWithQuals = {
      mainsnak: { property: string; snaktype: string }
      qualifiers?: Record<string, unknown[]>
      'qualifiers-order'?: string[]
      [k: string]: unknown
    }
    const newStatements = buildStatementsFromMapillaryImage(baseImage, false) as StmtWithQuals[]
    const creatorStmt = newStatements.find((s) => s.mainsnak.property === 'P170')!

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

    const delta = mergeSdcStatements({ P170: [existingCreator] }, newStatements)
    const updated = (delta as StmtWithQuals[]).find((s) => s.mainsnak.property === 'P170')!
    const order = (updated as { 'qualifiers-order'?: string[] })['qualifiers-order'] ?? []

    expect(order).toContain('P13988')
    expect(order.indexOf('P13988')).toBeGreaterThan(order.indexOf('P2093'))
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

  it('returns all labels when existing is null/undefined (first-time label application)', () => {
    const newLabels = { en: { language: 'en', value: 'My photo' } }
    expect(computeLabelsDelta(null, newLabels)).toEqual(newLabels)
    expect(computeLabelsDelta(undefined, newLabels)).toEqual(newLabels)
  })

  it('returns only the differing and absent entries when multiple languages are present', () => {
    const existing = {
      en: { language: 'en', value: 'Matching title' },
      fr: { language: 'fr', value: 'Old French title' },
    }
    const newLabels = {
      en: { language: 'en', value: 'Matching title' }, // unchanged — must be excluded
      fr: { language: 'fr', value: 'New French title' }, // changed — must be included
      de: { language: 'de', value: 'Neues Bild' }, // absent — must be included
    }
    const delta = computeLabelsDelta(existing, newLabels)
    expect(delta).not.toBeNull()
    expect(Object.keys(delta!)).not.toContain('en')
    expect(delta!['fr']?.value).toBe('New French title')
    expect(delta!['de']?.value).toBe('Neues Bild')
  })
})
