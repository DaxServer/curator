import { debounceMock } from '@frontend/__tests__/debounce-mock'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { Image, Item } from '@frontend/types/image'
import { TITLE_STATUS } from '@frontend/types/image'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'

describe('useCommons', () => {
  let useCommons: typeof import('../useCommons').useCommons

  beforeEach(async () => {
    setActivePinia(createPinia())
    mock.restore()
    debounceMock.reset()

    const module = await import('../useCommons')
    useCommons = module.useCommons
  })

  const createMockItem = (id: string, title: string = ''): Item => ({
    id,
    index: 1,
    image: {
      id,
      title: 'Original Title',
      description: 'Original Description',
      urls: {
        url: 'http://example.com/image.jpg',
        original: 'http://example.com/original.jpg',
        preview: 'http://example.com/preview.jpg',
        thumbnail: 'http://example.com/thumbnail.jpg',
      },
      dimensions: { width: 100, height: 100 },
      dates: { taken: new Date('2023-01-01T00:00:00Z') },
      location: { latitude: 0, longitude: 0, compass_angle: 0 },
      creator: { id: 'user', username: 'user', profile_url: '' },
      camera: { make: undefined, model: undefined, is_pano: false },
      existing: [],
    },
    meta: {
      selected: true,
      title,
      description: { language: 'en', value: '' },
      categories: '',
      titleStatus: TITLE_STATUS.Unknown,
    },
    isSkeleton: false,
  })

  it('immediate verifyTitles updates status to checking then available', async () => {
    const store = useCollectionsStore()
    const item = createMockItem('1', 'Test Title')
    store.replaceItems({ '1': item })

    const { verifyTitles } = useCommons()

    // Mock fetch response for available title (missing: true)
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            query: {
              pages: {
                '123': { missing: true, title: 'File:Test Title.jpeg' },
              },
            },
          }),
      }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    await verifyTitles([{ id: '1', title: 'Test Title.jpeg', image: item.image }])

    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Available)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('immediate verifyTitles updates status to checking then taken', async () => {
    const store = useCollectionsStore()
    const item = createMockItem('1', 'Taken Title.jpeg')
    store.replaceItems({ '1': item })

    const { verifyTitles } = useCommons()

    // Mock fetch response for taken title (revisions exist)
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            query: {
              pages: {
                '123': { title: 'File:Taken Title.jpeg', revisions: [{}] },
              },
            },
          }),
      }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    await verifyTitles([{ id: '1', title: 'Taken Title.jpeg', image: item.image }])

    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Taken)
  })

  it('handles normalized titles from Commons API (underscore to space)', async () => {
    const store = useCollectionsStore()
    const item = createMockItem(
      '1',
      'Mapillary (l1QCIHNgZvYUfjRse09ybX) (osmplus_org) 2025-12-11 11H36M26S400.jpg',
    )
    store.replaceItems({ '1': item })

    const { verifyTitles } = useCommons()

    // Mock fetch response with normalized title (underscore converted to space)
    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            batchcomplete: true,
            query: {
              normalized: [
                {
                  fromencoded: false,
                  from: 'File:Mapillary (l1QCIHNgZvYUfjRse09ybX) (osmplus_org) 2025-12-11 11H36M26S400.jpg',
                  to: 'File:Mapillary (l1QCIHNgZvYUfjRse09ybX) (osmplus org) 2025-12-11 11H36M26S400.jpg',
                },
              ],
              pages: {
                '123': {
                  ns: 6,
                  title:
                    'File:Mapillary (l1QCIHNgZvYUfjRse09ybX) (osmplus org) 2025-12-11 11H36M26S400.jpg',
                  missing: true,
                },
              },
            },
          }),
      }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    await verifyTitles([
      {
        id: '1',
        title: 'Mapillary (l1QCIHNgZvYUfjRse09ybX) (osmplus_org) 2025-12-11 11H36M26S400.jpg',
        image: item.image,
      },
    ])

    // Should correctly identify as Available since the normalized page has missing: true
    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Available)
  })

  it('debounce verifyTitles waits before calling API', async () => {
    const store = useCollectionsStore()
    const item = createMockItem('1', 'Debounce Title')
    store.replaceItems({ '1': item })

    const { verifyTitles } = useCommons()

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            query: {
              pages: {
                '123': { missing: true, title: 'File:Debounce Title.jpeg' },
              },
            },
          }),
      }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    // Call with debounce
    verifyTitles([{ id: '1', title: 'Debounce Title.jpeg', image: item.image }], { debounce: true })

    // Status should be checking immediately
    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Checking)

    // Fetch should not be called immediately (it's debounced)
    expect(mockFetch).not.toHaveBeenCalled()

    // Flush debounce
    expect(debounceMock.pendingExecutors.length).toBe(1)
    for (const exec of debounceMock.pendingExecutors) {
      await exec()
    }
    debounceMock.reset()

    expect(mockFetch).toHaveBeenCalled()
    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Available)
  })

  it('cancelTitleVerification prevents debounced checks from calling API', async () => {
    const store = useCollectionsStore()
    const item = createMockItem('1', 'Debounce Title')
    store.replaceItems({ '1': item })

    const { verifyTitles, cancelTitleVerification } = useCommons()

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            query: {
              pages: {
                '123': { missing: true, title: 'File:Debounce Title.jpeg' },
              },
            },
          }),
      }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    verifyTitles([{ id: '1', title: 'Debounce Title.jpeg', image: item.image }], { debounce: true })
    cancelTitleVerification()

    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Unknown)

    expect(debounceMock.pendingExecutors.length).toBe(1)
    for (const exec of debounceMock.pendingExecutors) {
      await exec()
    }
    debounceMock.reset()

    expect(mockFetch).not.toHaveBeenCalled()
    expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Unknown)
  })

  it('cancelTitleVerification stops bulk checks after first 50-title chunk', async () => {
    const store = useCollectionsStore()

    const itemsToVerify: { id: string; title: string; image: Image }[] = []
    const pages: Record<string, { missing?: boolean; title: string; revisions?: unknown[] }> = {}

    for (let i = 0; i < 51; i += 1) {
      const id = String(i + 1)
      const title = `Title ${id}.jpeg`

      const item = createMockItem(id, title)
      store.items[id] = item
      itemsToVerify.push({ id, title, image: item.image })

      if (i < 50) {
        pages[id] = { missing: true, title: `File:${title}` }
      }
    }

    const { verifyTitles, cancelTitleVerification } = useCommons()

    const mockFetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => {
          cancelTitleVerification()
          return Promise.resolve({ query: { pages } })
        },
      }),
    )
    global.fetch = mockFetch as unknown as typeof fetch

    await verifyTitles(itemsToVerify)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(store.items['51']!.meta.titleStatus).toBe(TITLE_STATUS.Unknown)
  })

  describe('validateTitle', () => {
    it('returns invalid for files without valid extension', () => {
      const { validateTitle } = useCommons()
      const item = createMockItem('1', 'noextension')
      const duplicates = new Set<string>()

      const result = validateTitle(
        { id: item.id, title: 'noextension', image: item.image },
        duplicates,
      )

      expect(result).toBe(TITLE_STATUS.Invalid)
    })

    it('returns blacklisted for blacklisted titles', () => {
      const { validateTitle } = useCommons()
      const item = createMockItem('1', ' lowercase.jpg')
      const duplicates = new Set<string>()

      const result = validateTitle(
        { id: item.id, title: ' lowercase.jpg', image: item.image },
        duplicates,
      )

      expect(result).toBe(TITLE_STATUS.Blacklisted)
    })

    it('returns duplicate for duplicate titles', () => {
      const { validateTitle } = useCommons()
      const item = createMockItem('1', 'Photo.jpg')
      const duplicates = new Set<string>(['Photo.jpg'])

      const result = validateTitle(
        { id: item.id, title: 'Photo.jpg', image: item.image },
        duplicates,
      )

      expect(result).toBe(TITLE_STATUS.Duplicate)
    })

    it('returns null for valid unique title', () => {
      const { validateTitle } = useCommons()
      const item = createMockItem('1', 'Valid Photo.jpg')
      const duplicates = new Set<string>()

      const result = validateTitle(
        { id: item.id, title: 'Valid Photo.jpg', image: item.image },
        duplicates,
      )

      expect(result).toBeNull()
    })

    it('prioritizes invalid check over duplicate check', () => {
      const { validateTitle } = useCommons()
      const item = createMockItem('1', 'noextension')
      const duplicates = new Set<string>(['noextension'])

      const result = validateTitle(
        { id: item.id, title: 'noextension', image: item.image },
        duplicates,
      )

      expect(result).toBe(TITLE_STATUS.Invalid)
    })

    it('prioritizes invalid check over blacklist check', () => {
      const { validateTitle } = useCommons()
      const item = createMockItem('1', ' noextension')
      const duplicates = new Set<string>()

      const result = validateTitle(
        { id: item.id, title: ' noextension', image: item.image },
        duplicates,
      )

      expect(result).toBe(TITLE_STATUS.Invalid)
    })

    it('returns invalid for empty title before checking duplicates', () => {
      const { validateTitle } = useCommons()

      const item = createMockItem('1', '')
      // Empty title is invalid before duplicate check
      const result = validateTitle({ id: item.id, title: '', image: item.image }, new Set<string>())

      expect(result).toBe(TITLE_STATUS.Invalid)
    })

    it('uses effective title from getTemplateTitle when duplicate check is needed', () => {
      const { validateTitle } = useCommons()

      const item = createMockItem('1', 'Photo.jpg')
      // buildTitle generates "Photo from Mapillary 2023-01-01 (1).jpg"
      const defaultTitle = 'Photo from Mapillary 2023-01-01 (1).jpg'
      const duplicates = new Set<string>([defaultTitle])

      const result = validateTitle(
        { id: item.id, title: 'Photo.jpg', image: item.image },
        duplicates,
      )

      expect(result).toBeNull() // Photo.jpg is valid and not in duplicates
    })
  })

  describe('findDuplicateTitles', () => {
    it('returns empty set when no duplicates', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Photo1.jpg')
      const item2 = createMockItem('2', 'Photo2.jpg')
      store.replaceItems({ '1': item1, '2': item2 })

      const duplicates = findDuplicateTitles()

      expect(duplicates.size).toBe(0)
    })

    it('finds duplicate titles across selected items', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Photo.jpg')
      const item2 = createMockItem('2', 'Photo.jpg')
      const item3 = createMockItem('3', 'Other.jpg')
      store.replaceItems({ '1': item1, '2': item2, '3': item3 })

      const duplicates = findDuplicateTitles()

      expect(duplicates.size).toBe(1)
      expect(duplicates.has('Photo.jpg')).toBe(true)
      expect(duplicates.has('Other.jpg')).toBe(false)
    })

    it('finds multiple duplicate groups', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'A.jpg')
      const item2 = createMockItem('2', 'A.jpg')
      const item3 = createMockItem('3', 'B.jpg')
      const item4 = createMockItem('4', 'B.jpg')
      const item5 = createMockItem('5', 'C.jpg')
      store.replaceItems({ '1': item1, '2': item2, '3': item3, '4': item4, '5': item5 })

      const duplicates = findDuplicateTitles()

      expect(duplicates.size).toBe(2)
      expect(duplicates.has('A.jpg')).toBe(true)
      expect(duplicates.has('B.jpg')).toBe(true)
      expect(duplicates.has('C.jpg')).toBe(false)
    })

    it('finds triple duplicates', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Photo.jpg')
      const item2 = createMockItem('2', 'Photo.jpg')
      const item3 = createMockItem('3', 'Photo.jpg')
      store.replaceItems({ '1': item1, '2': item2, '3': item3 })

      const duplicates = findDuplicateTitles()

      expect(duplicates.size).toBe(1)
      expect(duplicates.has('Photo.jpg')).toBe(true)
    })

    it('ignores unselected items', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Photo.jpg')
      const item2 = createMockItem('2', 'Photo.jpg')
      item2.meta.selected = false
      const item3 = createMockItem('3', 'Other.jpg')
      store.replaceItems({ '1': item1, '2': item2, '3': item3 })

      const duplicates = findDuplicateTitles()

      expect(duplicates.size).toBe(0)
    })

    it('uses effective title from template', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      // Set items with same explicit title to simulate template collision
      const item1 = createMockItem('1', 'Same Title.jpg')
      const item2 = createMockItem('2', 'Same Title.jpg')
      const item3 = createMockItem('3', 'Same Title.jpg')
      store.replaceItems({ '1': item1, '2': item2, '3': item3 })

      const duplicates = findDuplicateTitles()

      // All items have the same title, so they should all be duplicates
      expect(duplicates.size).toBe(1)
      expect(duplicates.has('Same Title.jpg')).toBe(true)
    })

    it('handles empty selected items', () => {
      const { findDuplicateTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Photo.jpg')
      item1.meta.selected = false
      const item2 = createMockItem('2', 'Other.jpg')
      item2.meta.selected = false
      store.replaceItems({ '1': item1, '2': item2 })

      const duplicates = findDuplicateTitles()

      expect(duplicates.size).toBe(0)
    })
  })

  describe('verifyTitles with duplicate detection', () => {
    it('marks duplicate titles with duplicate status', async () => {
      const { verifyTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Photo.jpg')
      const item2 = createMockItem('2', 'Photo.jpg')
      store.replaceItems({ '1': item1, '2': item2 })

      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              query: { pages: {} },
            }),
        }),
      )
      global.fetch = mockFetch as unknown as typeof fetch

      await verifyTitles([
        { id: '1', title: 'Photo.jpg', image: item1.image },
        { id: '2', title: 'Photo.jpg', image: item2.image },
      ])

      expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Duplicate)
      expect(store.items['2']!.meta.titleStatus).toBe(TITLE_STATUS.Duplicate)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('only checks non-duplicate titles against API', async () => {
      const { verifyTitles } = useCommons()
      const store = useCollectionsStore()

      const item1 = createMockItem('1', 'Duplicate.jpg')
      const item2 = createMockItem('2', 'Duplicate.jpg')
      const item3 = createMockItem('3', 'Unique.jpg')
      store.replaceItems({ '1': item1, '2': item2, '3': item3 })

      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              query: {
                pages: {
                  '123': { missing: true, title: 'File:Unique.jpg' },
                },
              },
            }),
        }),
      )
      global.fetch = mockFetch as unknown as typeof fetch

      await verifyTitles([
        { id: '1', title: 'Duplicate.jpg', image: item1.image },
        { id: '2', title: 'Duplicate.jpg', image: item2.image },
        { id: '3', title: 'Unique.jpg', image: item3.image },
      ])

      expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Duplicate)
      expect(store.items['2']!.meta.titleStatus).toBe(TITLE_STATUS.Duplicate)
      expect(store.items['3']!.meta.titleStatus).toBe(TITLE_STATUS.Available)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('handles two items with different titles that normalize to the same title', async () => {
      const { verifyTitles } = useCommons()
      const store = useCollectionsStore()

      // Two items with different titles (underscores in different places)
      // that normalize to the same title on Commons
      // Example: "Photo_one_two" vs "Photo one_two" both normalize to "Photo one two"
      const item1 = createMockItem('1', 'Photo_one_two.jpg')
      const item2 = createMockItem('2', 'Photo one_two.jpg')
      store.replaceItems({ '1': item1, '2': item2 })

      // Mock API response where both titles normalize to the SAME Commons title
      // This simulates the situation where Commons normalizes underscores to spaces
      // and both inputs end up with the same normalized form
      const mockFetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              batchcomplete: true,
              query: {
                normalized: [
                  {
                    fromencoded: false,
                    from: 'File:Photo_one_two.jpg',
                    to: 'File:Photo one two.jpg',
                  },
                  {
                    fromencoded: false,
                    from: 'File:Photo one_two.jpg',
                    to: 'File:Photo one two.jpg',
                  },
                ],
                pages: {
                  '-1': {
                    ns: 6,
                    title: 'File:Photo one two.jpg',
                    missing: true,
                  },
                },
              },
            }),
        }),
      )
      global.fetch = mockFetch as unknown as typeof fetch

      await verifyTitles([
        { id: '1', title: 'Photo_one_two.jpg', image: item1.image },
        { id: '2', title: 'Photo one_two.jpg', image: item2.image },
      ])

      // Both items should be marked as Available since Commons shows the normalized
      // title as missing (not taken on Commons)
      // The test verifies that the normalization lookup correctly maps both
      // different input titles to the same normalized title
      expect(store.items['1']!.meta.titleStatus).toBe(TITLE_STATUS.Available)
      expect(store.items['2']!.meta.titleStatus).toBe(TITLE_STATUS.Available)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('applyMetaDefaults', () => {
    it('applies template substitution to description when falling back to global', async () => {
      const store = useCollectionsStore()
      store.globalDescription = 'Photo in {{location.city}}'
      const { applyMetaDefaults } = useCommons()
      const item = createMockItem('1')
      item.image.location = { ...item.image.location, city: 'Berlin' }

      const result = applyMetaDefaults(item, 'fallback title')

      expect(result.description.value).toBe('Photo in Berlin')
    })

    it('applies template substitution to categories when falling back to global', async () => {
      const store = useCollectionsStore()
      store.globalCategories = '[[Category:Photos in {{location.city}}]]'
      const { applyMetaDefaults } = useCommons()
      const item = createMockItem('1')
      item.image.location = { ...item.image.location, city: 'Berlin' }

      const result = applyMetaDefaults(item, 'fallback title')

      expect(result.categories).toBe('[[Category:Photos in Berlin]]')
    })

    it('passes through wikitext templates untouched in categories', async () => {
      const store = useCollectionsStore()
      store.globalCategories = '{{Taken on|2023}}\n[[Category:Photos in {{location.city}}]]'
      const { applyMetaDefaults } = useCommons()
      const item = createMockItem('1')
      item.image.location = { ...item.image.location, city: 'Berlin' }

      const result = applyMetaDefaults(item, 'fallback title')

      expect(result.categories).toBe('{{Taken on|2023}}\n[[Category:Photos in Berlin]]')
    })

    it('uses item meta description when set (no template applied)', async () => {
      const store = useCollectionsStore()
      store.globalDescription = 'Photo in {{location.city}}'
      const { applyMetaDefaults } = useCommons()
      const item = createMockItem('1')
      item.meta.description.value = 'My own description'
      item.image.location = { ...item.image.location, city: 'Berlin' }

      const result = applyMetaDefaults(item, 'fallback title')

      expect(result.description.value).toBe('My own description')
    })

    it('uses item meta categories when set (no template applied)', async () => {
      const store = useCollectionsStore()
      store.globalCategories = '[[Category:Photos in {{location.city}}]]'
      const { applyMetaDefaults } = useCommons()
      const item = createMockItem('1')
      item.meta.categories = 'My own category'
      item.image.location = { ...item.image.location, city: 'Berlin' }

      const result = applyMetaDefaults(item, 'fallback title')

      expect(result.categories).toBe('My own category')
    })
  })

  describe('buildWikitext', () => {
    it('should use default license when no overrides provided', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{cc-by-sa-4.0}}')
    })

    it('should use global license override when provided', () => {
      const store = useCollectionsStore()
      store.globalLicense = '{{cc-zero}}'

      const { buildWikitext } = useCommons()
      const item = createMockItem('1')

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{cc-zero}}')
      expect(wikitext).not.toContain('{{cc-by-sa-4.0}}')
    })

    it('should use item specific license override when provided', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.meta.license = '{{cc-by-3.0}}'

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{cc-by-3.0}}')
      expect(wikitext).not.toContain('{{cc-by-sa-4.0}}')
    })

    it('should prioritize item license over global license', () => {
      const store = useCollectionsStore()
      store.globalLicense = '{{cc-zero}}'

      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.meta.license = '{{cc-by-3.0}}'

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{cc-by-3.0}}')
      expect(wikitext).not.toContain('{{cc-zero}}')
      expect(wikitext).not.toContain('{{cc-by-sa-4.0}}')
    })

    it('should handle whitespace in license strings', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.meta.license = '  {{cc-by-3.0}}  '

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{cc-by-3.0}}')
      expect(wikitext).not.toContain('  {{cc-by-3.0}}  ')
    })

    it('should include heading parameter when compass_angle is defined', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.location.compass_angle = 180

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('|heading:180}}')
    })

    it('should not include heading parameter when compass_angle is undefined', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.location.compass_angle = undefined

      const wikitext = buildWikitext(item)
      expect(wikitext).not.toContain('|heading:')
    })

    it('should not include heading parameter when compass_angle is 0', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.location.compass_angle = 0

      const wikitext = buildWikitext(item)
      expect(wikitext).not.toContain('|heading:0')
    })

    it('should include heading with decimal precision', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.location.compass_angle = 45.5

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('|heading:45.5}}')
    })

    it('should include heading with different coordinates', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.location.latitude = 37.7749
      item.image.location.longitude = -122.4194
      item.image.location.compass_angle = 90

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{Location|37.7749|-122.4194|heading:90}}')
    })

    it('should include Pano360 template when is_pano is true', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.camera.is_pano = true

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{Pano360}}')
    })

    it('should not include Pano360 template when is_pano is false', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.camera.is_pano = false

      const wikitext = buildWikitext(item)
      expect(wikitext).not.toContain('{{Pano360}}')
    })

    it('should include both heading and pano360 when applicable', () => {
      const { buildWikitext } = useCommons()
      const item = createMockItem('1')
      item.image.location.compass_angle = 270
      item.image.camera.is_pano = true

      const wikitext = buildWikitext(item)
      expect(wikitext).toContain('{{Location|0|0|heading:270}}')
      expect(wikitext).toContain('{{Pano360}}')
    })
    describe('buildSDC', () => {
      it('should include copyright claims when no override provided', () => {
        const { buildSDC } = useCommons()
        const item = createMockItem('1')

        const claims = buildSDC(item.id, item.image, item.meta.license)

        const hasCopyrightStatus = claims.some(
          (c) => c.mainsnak.property === 'P6216', // Copyright status
        )
        const hasCopyrightLicense = claims.some(
          (c) => c.mainsnak.property === 'P275', // Copyright license
        )

        expect(hasCopyrightStatus).toBe(true)
        expect(hasCopyrightLicense).toBe(true)
      })

      it('should not include copyright claims when global override provided', () => {
        const store = useCollectionsStore()
        store.globalLicense = '{{cc-zero}}'

        const { buildSDC } = useCommons()
        const item = createMockItem('1')

        const claims = buildSDC(item.id, item.image, item.meta.license)

        const hasCopyrightStatus = claims.some((c) => c.mainsnak.property === 'P6216')
        const hasCopyrightLicense = claims.some((c) => c.mainsnak.property === 'P275')

        expect(hasCopyrightStatus).toBe(false)
        expect(hasCopyrightLicense).toBe(false)
      })

      it('should not include copyright claims when item override provided', () => {
        const { buildSDC } = useCommons()
        const item = createMockItem('1')
        item.meta.license = '{{cc-by-3.0}}'

        const claims = buildSDC(item.id, item.image, item.meta.license)

        const hasCopyrightStatus = claims.some((c) => c.mainsnak.property === 'P6216')
        const hasCopyrightLicense = claims.some((c) => c.mainsnak.property === 'P275')

        expect(hasCopyrightStatus).toBe(false)
        expect(hasCopyrightLicense).toBe(false)
      })

      it('should handle whitespace in override check', () => {
        const { buildSDC } = useCommons()
        const item = createMockItem('1')
        item.meta.license = '  ' // Empty but with whitespace

        const claims = buildSDC(item.id, item.image, item.meta.license)

        const hasCopyrightStatus = claims.some((c) => c.mainsnak.property === 'P6216')
        const hasCopyrightLicense = claims.some((c) => c.mainsnak.property === 'P275')

        expect(hasCopyrightStatus).toBe(true)
        expect(hasCopyrightLicense).toBe(true)
      })
    })
  })
})
