import type { MediaImage } from '@backend/types/ws'

export const WIKIDATA_ENTITY = {
  CCBYSA40: 'Q18199165',
  Copyrighted: 'Q50423863',
  Degree: 'Q28390',
  FileAvailableOnInternet: 'Q74228490',
  Mapillary: 'Q17985544',
  MapillaryDatabase: 'Q26757498',
  Pixel: 'Q355198',
} as const

export const WIKIDATA_PROPERTY = {
  AuthorNameString: 'P2093',
  CommonsCategory: 'P373',
  CoordinatesOfThePointOfView: 'P1259',
  CopyrightLicense: 'P275',
  CopyrightStatus: 'P6216',
  Creator: 'P170',
  DescribedAtUrl: 'P973',
  Heading: 'P7787',
  Height: 'P2048',
  Inception: 'P571',
  MapillaryPhotoID: 'P1947',
  MapillaryUsername: 'P13988',
  Operator: 'P137',
  PublishedIn: 'P1433',
  SourceOfFile: 'P7482',
  Title: 'P1476',
  Url: 'P2699',
  Width: 'P2049',
} as const

function stringSnak(property: string, value: string): unknown {
  return { snaktype: 'value', property, datavalue: { value, type: 'string' } }
}

function externalIdSnak(property: string, value: string): unknown {
  return { snaktype: 'value', property, datavalue: { value, type: 'string' } }
}

function someValueSnak(property: string): unknown {
  return { snaktype: 'somevalue', property }
}

function wikibaseItemSnak(property: string, entityId: string): unknown {
  return {
    snaktype: 'value',
    property,
    datavalue: {
      value: { 'entity-type': 'item', 'numeric-id': parseInt(entityId.slice(1), 10) },
      type: 'wikibase-entityid',
    },
  }
}

function globeCoordinateSnak(
  property: string,
  lat: number,
  lon: number,
  precision = 1e-9,
): unknown {
  return {
    snaktype: 'value',
    property,
    datavalue: {
      value: {
        latitude: lat,
        longitude: lon,
        altitude: null,
        precision,
        globe: 'http://www.wikidata.org/entity/Q2',
      },
      type: 'globecoordinate',
    },
  }
}

function quantitySnak(property: string, amount: number, unitEntityId: string): unknown {
  return {
    snaktype: 'value',
    property,
    datavalue: {
      value: {
        amount: `+${amount}`,
        unit: `http://www.wikidata.org/entity/${unitEntityId}`,
      },
      type: 'quantity',
    },
  }
}

function timeSnak(property: string, isoDatetime: string): unknown {
  const normalized = isoDatetime.endsWith('Z') ? `${isoDatetime.slice(0, -1)}+00:00` : isoDatetime
  const dt = new Date(normalized)
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid date provided for SDC: ${isoDatetime}`)
  }
  const year = dt.getUTCFullYear().toString().padStart(4, '0')
  const month = (dt.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = dt.getUTCDate().toString().padStart(2, '0')
  const timeString = `+0000000${year}-${month}-${day}T00:00:00Z`
  return {
    snaktype: 'value',
    property,
    datavalue: {
      value: {
        time: timeString,
        timezone: 0,
        before: 0,
        after: 0,
        precision: 11,
        calendarmodel: 'http://www.wikidata.org/entity/Q1985727',
      },
      type: 'time',
    },
  }
}

function createStatement(mainsnak: unknown, qualifiers?: unknown[]): unknown {
  if (!qualifiers || qualifiers.length === 0) {
    return { mainsnak, type: 'statement', rank: 'normal' }
  }

  const grouped: Record<string, unknown[]> = {}
  const order: string[] = []
  for (const snak of qualifiers) {
    const prop = (snak as { property: string }).property
    if (!grouped[prop]) {
      grouped[prop] = []
      order.push(prop)
    }
    grouped[prop].push(snak)
  }

  return {
    mainsnak,
    type: 'statement',
    rank: 'normal',
    qualifiers: grouped,
    'qualifiers-order': order,
  }
}

type RawSnak = {
  snaktype: string
  property: string
  datavalue?: { value: unknown; type: string }
}

type RawStatement = {
  mainsnak: RawSnak
  type: string
  rank: string
  id?: string
  qualifiers?: Record<string, RawSnak[]>
  'qualifiers-order'?: string[]
}

function normalizedSnakKey(snak: RawSnak): string {
  if (snak.snaktype === 'somevalue') return 'somevalue'
  if (snak.snaktype === 'novalue') return 'novalue'
  const dv = snak.datavalue
  if (!dv) return 'unknown'
  const v = dv.value
  switch (dv.type) {
    case 'string':
      return `string:${v}`
    case 'wikibase-entityid': {
      const e = v as { 'numeric-id'?: number; id?: string }
      return `entity:${e['numeric-id'] ?? e.id}`
    }
    case 'time':
      return `time:${(v as { time: string }).time}`
    case 'globecoordinate': {
      const c = v as { latitude: number; longitude: number }
      return `coord:${c.latitude}:${c.longitude}`
    }
    case 'quantity': {
      const q = v as { amount: string; unit: string }
      return `qty:${q.amount}:${q.unit}`
    }
    default:
      return JSON.stringify(v)
  }
}

function snaksEqual(s1: RawSnak, s2: RawSnak): boolean {
  if (s1.snaktype !== s2.snaktype) return false
  return normalizedSnakKey(s1) === normalizedSnakKey(s2)
}

function mergeQualifiersInto(existingStmt: RawStatement, newStmt: RawStatement): RawStatement | null {
  const newQuals = newStmt.qualifiers
  if (!newQuals || Object.keys(newQuals).length === 0) return null

  const merged = { ...(existingStmt.qualifiers ?? {}) } as Record<string, RawSnak[]>
  const order = [...(existingStmt['qualifiers-order'] ?? [])]
  let changed = false

  for (const [prop, snaks] of Object.entries(newQuals)) {
    for (const newSnak of snaks as RawSnak[]) {
      const existingSnaks = merged[prop] ?? []
      if (!existingSnaks.some((s) => snaksEqual(s, newSnak))) {
        merged[prop] = [...existingSnaks, newSnak]
        if (!order.includes(prop)) order.push(prop)
        changed = true
      }
    }
  }

  if (!changed) return null
  return { ...existingStmt, qualifiers: merged, 'qualifiers-order': order }
}

/**
 * Merge new SDC statements into existing ones — additive and non-destructive.
 *
 * - Property absent in existing → add the new statement (no id).
 * - Property present, matching mainsnak value → merge qualifiers additively; include
 *   the existing statement (with its id) only if qualifiers actually changed.
 * - Property present, conflicting value → skip (never overwrite).
 * - Globe-coordinate statements → skip if the property already exists.
 *
 * Returns only the statements that need to be sent to wbeditentity as a delta.
 */
export function mergeSdcStatements(
  existing: Record<string, unknown[]>,
  newStatements: unknown[],
): unknown[] {
  const result: unknown[] = []

  for (const stmt of newStatements as RawStatement[]) {
    const prop = stmt.mainsnak.property
    const existingForProp = (existing[prop] ?? []) as RawStatement[]

    if (existingForProp.length === 0) {
      result.push(stmt)
      continue
    }

    // Globe-coordinate statements: preserve whatever is already on the file.
    if (stmt.mainsnak.datavalue?.type === 'globecoordinate') continue

    const matchIdx = existingForProp.findIndex((s) => snaksEqual(s.mainsnak, stmt.mainsnak))
    if (matchIdx === -1) continue // conflicting value — never overwrite

    const updated = mergeQualifiersInto(existingForProp[matchIdx]!, stmt)
    if (updated) result.push(updated)
  }

  return result
}

/**
 * Compute only the labels that differ from existing ones.
 * Returns null when there is nothing to update.
 */
export function computeLabelsDelta(
  existing: Record<string, unknown> | undefined | null,
  newLabels: Record<string, { language: string; value: string }> | null,
): Record<string, { language: string; value: string }> | null {
  if (!newLabels) return null
  const delta: Record<string, { language: string; value: string }> = {}
  for (const [lang, label] of Object.entries(newLabels)) {
    const existingValue = (existing?.[lang] as { value?: string } | undefined)?.value
    if (existingValue !== label.value) delta[lang] = label
  }
  return Object.keys(delta).length > 0 ? delta : null
}

export function buildStatementsFromMapillaryImage(
  image: MediaImage,
  includeDefaultCopyright: boolean,
): unknown[] {
  const claims: unknown[] = []

  claims.push(
    createStatement(someValueSnak(WIKIDATA_PROPERTY.Creator), [
      stringSnak(WIKIDATA_PROPERTY.AuthorNameString, image.creator.username),
      externalIdSnak(WIKIDATA_PROPERTY.MapillaryUsername, image.creator.username),
    ]),
  )

  claims.push(createStatement(externalIdSnak(WIKIDATA_PROPERTY.MapillaryPhotoID, image.id)))

  claims.push(
    createStatement(
      wikibaseItemSnak(WIKIDATA_PROPERTY.PublishedIn, WIKIDATA_ENTITY.MapillaryDatabase),
    ),
  )

  claims.push(createStatement(timeSnak(WIKIDATA_PROPERTY.Inception, image.dates.taken)))

  claims.push(
    createStatement(
      wikibaseItemSnak(WIKIDATA_PROPERTY.SourceOfFile, WIKIDATA_ENTITY.FileAvailableOnInternet),
      [
        wikibaseItemSnak(WIKIDATA_PROPERTY.Operator, WIKIDATA_ENTITY.Mapillary),
        stringSnak(WIKIDATA_PROPERTY.DescribedAtUrl, image.urls.url),
      ],
    ),
  )

  const headingQualifiers: unknown[] = []
  if (image.location.compass_angle != null) {
    headingQualifiers.push(
      quantitySnak(WIKIDATA_PROPERTY.Heading, image.location.compass_angle, WIKIDATA_ENTITY.Degree),
    )
  }

  claims.push(
    createStatement(
      globeCoordinateSnak(
        WIKIDATA_PROPERTY.CoordinatesOfThePointOfView,
        image.location.latitude,
        image.location.longitude,
      ),
      headingQualifiers,
    ),
  )

  if (includeDefaultCopyright) {
    claims.push(
      createStatement(
        wikibaseItemSnak(WIKIDATA_PROPERTY.CopyrightStatus, WIKIDATA_ENTITY.Copyrighted),
      ),
    )
    claims.push(
      createStatement(
        wikibaseItemSnak(WIKIDATA_PROPERTY.CopyrightLicense, WIKIDATA_ENTITY.CCBYSA40),
      ),
    )
  }

  claims.push(
    createStatement(
      quantitySnak(WIKIDATA_PROPERTY.Width, image.dimensions.width, WIKIDATA_ENTITY.Pixel),
    ),
  )

  claims.push(
    createStatement(
      quantitySnak(WIKIDATA_PROPERTY.Height, image.dimensions.height, WIKIDATA_ENTITY.Pixel),
    ),
  )

  return claims
}
