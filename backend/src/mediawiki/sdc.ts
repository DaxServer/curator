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
