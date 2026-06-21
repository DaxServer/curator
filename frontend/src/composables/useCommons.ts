import { WIKIDATA_ENTITY, WIKIDATA_PROPERTY } from '@backend/mediawiki/sdc'
import {
  createCopyrightLicenseClaim,
  createCopyrightStatusClaim,
  createCreatorClaim,
  createExternalIdSnak,
  createExternalIdStatement,
  createHeightClaim,
  createInceptionClaim,
  createPointOfViewClaim,
  createSourceOfFileClaim,
  createWidthClaim,
  createWikibaseItemStatement,
} from '@frontend/composables/sdc'
import { useTitleVerification } from '@frontend/composables/useTitleVerification'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { Image, Item, Metadata } from '@frontend/types/image'
import type { Statement } from '@frontend/types/wikidata'
import { applyFieldTemplate } from '@frontend/utils/titleTemplate'

export const useCommons = () => {
  const store = useCollectionsStore()
  const {
    buildTitle,
    cancelTitleVerification,
    findDuplicateTitles,
    getEffectiveTitle,
    getTemplateTitle,
    validateTitle,
    verifyTitles,
  } = useTitleVerification()

  const toLocalTimezoneString = (date: Date): string => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const nd = date.toLocaleString(undefined, { timeZone: tz, timeZoneName: 'short' })
    return nd
  }

  const applyMetaDefaults = (item: Item, fallbackTitle: string): Metadata => {
    const { meta, image } = item
    const title = meta.title?.trim() || fallbackTitle

    return {
      ...meta,
      title,
      description: {
        language: meta.description.language.trim() || store.globalLanguage.trim(),
        value:
          meta.description.value.trim() ||
          applyFieldTemplate(store.globalDescription, image, store.input),
      },
      categories: meta.categories || applyFieldTemplate(store.globalCategories, image, store.input),
    }
  }

  const buildWikitext = (item: Item): string => {
    const date = `${item.image.dates.taken.toISOString().split('.')[0]}Z`
    const source = sourceLink(item.id, store.input)
    let categories = item.meta.categories

    if (!categories.includes('Category:Images from Mapillary uploaded with Curator')) {
      categories = `${categories.trim()}\n[[Category:Images from Mapillary uploaded with Curator]]`
    }

    let additionalInfo = ''

    additionalInfo = `{{Location|${item.image.location.latitude}|${item.image.location.longitude}`
    if (item.image.location.compass_angle) {
      additionalInfo += `|heading:${item.image.location.compass_angle}`
    }
    additionalInfo += '}}'
    if (item.image.camera.is_pano === true) additionalInfo += '\n{{Pano360}}'

    categories = categories.trim()

    const license = item.meta.license?.trim() || store.globalLicense.trim() || '{{cc-by-sa-4.0}}'

    const dateTemplate = store.globalDateCategory
      ? `{{Taken on|cat=no|${date}}}`
      : `{{Taken on|${date}}}`

    const info = `== {{int:filedesc}} ==
{{Information
 | date         = ${dateTemplate}
 | source       = ${source}
 | other_fields = {{information field|Academic context|{{en|1=Geospatial street-level imagery from external site}}}}
}}
${additionalInfo}

== {{int:license-header}} ==
${license}

${categories}
`

    return info
  }

  const wikitext = (item: Item) => {
    const meta = applyMetaDefaults(item, getTemplateTitle(item.image))
    return buildWikitext({ ...item, meta: meta as Metadata })
  }

  const sourceLink = (id: string, sequenceId?: string): string => {
    return `{{Mapillary-source|key=${id}}} Sequence ID: ${sequenceId ?? ''}`
  }

  const buildDescription = (): string => {
    return 'Photo from Mapillary'
  }

  const buildSDC = (id: string, image: Image, license?: string): Statement[] => {
    const claims: Statement[] = []

    // Creator
    claims.push(
      createCreatorClaim(image.creator.username, [
        createExternalIdSnak(WIKIDATA_PROPERTY.MapillaryUsername, image.creator.username),
      ]),
    )

    // Mapillary ID
    claims.push(createExternalIdStatement(WIKIDATA_PROPERTY.MapillaryPhotoID, id))

    // Published in
    claims.push(
      createWikibaseItemStatement(WIKIDATA_PROPERTY.PublishedIn, WIKIDATA_ENTITY.MapillaryDatabase),
    )

    // Inception
    claims.push(createInceptionClaim(image.dates.taken))

    // Source of file
    claims.push(createSourceOfFileClaim(image.urls.url))

    // Coordinates of the point of view
    claims.push(createPointOfViewClaim(image.location))

    // Check for license override
    const hasLicenseOverride = (license?.trim() || store.globalLicense.trim()) !== ''

    if (!hasLicenseOverride) {
      // Copyright status
      claims.push(createCopyrightStatusClaim())

      // Copyright license
      claims.push(createCopyrightLicenseClaim())
    }

    // Width
    claims.push(createWidthClaim(image.dimensions.width))

    // Height
    claims.push(createHeightClaim(image.dimensions.height))

    return claims
  }

  return {
    applyMetaDefaults,
    buildDescription,
    buildSDC,
    buildWikitext,
    sourceLink,
    wikitext,
    buildTitle,
    cancelTitleVerification,
    findDuplicateTitles,
    getEffectiveTitle,
    getTemplateTitle,
    validateTitle,
    verifyTitles,
    toLocalTimezoneString,
  }
}
