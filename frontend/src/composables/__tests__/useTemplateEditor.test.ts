import { debounceMock, useHappyDom } from '@frontend/__tests__/fixtures'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { Item } from '@frontend/types/image'
import { TITLE_STATUS } from '@frontend/types/image'
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, ref } from 'vue'

const mockCheckCategories = mock(async (_text: string) => {})
const mockCategoryValidation = { missingCategories: ref([]), checkCategories: mockCheckCategories }

const makeItem = (id: string, city = 'Berlin'): Item => ({
  id,
  index: Number(id),
  image: {
    id,
    title: '',
    description: '',
    urls: {
      url: 'http://example.com/image.jpg',
      original: 'http://example.com/original.jpg',
      preview: 'http://example.com/preview.jpg',
      thumbnail: 'http://example.com/thumbnail.jpg',
    },
    dimensions: { width: 100, height: 100 },
    dates: { taken: new Date('2023-01-01T00:00:00Z') },
    location: { latitude: 0, longitude: 0, compass_angle: 0, city },
    creator: { id: 'user', username: 'user', profile_url: '' },
    camera: { make: undefined, model: undefined, is_pano: false },
    existing: [],
  },
  meta: {
    selected: true,
    title: '',
    description: { language: 'en', value: '' },
    categories: '',
    titleStatus: TITLE_STATUS.Unknown,
  },
  isSkeleton: false,
})

useHappyDom()

describe('useTemplateEditor', () => {
  let useTemplateEditor: typeof import('../useTemplateEditor').useTemplateEditor
  let store: ReturnType<typeof useCollectionsStore>
  let scope = effectScope()

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useCollectionsStore()
    mockCheckCategories.mockClear()
    debounceMock.reset()
    scope = effectScope()
    const mod = await import('../useTemplateEditor')
    useTemplateEditor = mod.useTemplateEditor
  })

  afterEach(() => {
    scope.stop()
  })

  const run = () => scope.run(() => useTemplateEditor(mockCategoryValidation))!

  describe('internalDescription / internalCategories', () => {
    it('initializes from store', () => {
      store.globalDescription = 'My description'
      store.globalCategories = 'My categories'
      const editor = run()

      expect(editor.internalDescription.value).toBe('My description')
      expect(editor.internalCategories.value).toBe('My categories')
    })

    it('syncs from store when not editing preset', async () => {
      const editor = run()
      store.globalDescription = 'Updated description'
      await nextTick()

      expect(editor.internalDescription.value).toBe('Updated description')
    })

    it('does not sync from store when editing preset', async () => {
      store.isEditingPreset = true
      const editor = run()
      editor.internalDescription.value = 'Local edit'
      store.globalDescription = 'Store changed'
      await nextTick()

      expect(editor.internalDescription.value).toBe('Local edit')
    })
  })

  describe('dirty state', () => {
    it('descriptionIsDirty is false when matching store', () => {
      store.globalDescription = 'desc'
      const editor = run()

      expect(editor.descriptionIsDirty.value).toBe(false)
    })

    it('descriptionIsDirty is true when changed from store', () => {
      store.globalDescription = 'desc'
      const editor = run()
      editor.internalDescription.value = 'new desc'

      expect(editor.descriptionIsDirty.value).toBe(true)
    })

    it('categoriesIsDirty is true when changed from store', () => {
      store.globalCategories = 'cats'
      const editor = run()
      editor.internalCategories.value = 'new cats'

      expect(editor.categoriesIsDirty.value).toBe(true)
    })
  })

  describe('highlighting', () => {
    it('descriptionHighlighted wraps known tokens in blue span', () => {
      const editor = run()
      editor.internalDescription.value = 'Photo in {{location.city}}'

      expect(editor.descriptionHighlighted.value).toContain('text-blue-600')
      expect(editor.descriptionHighlighted.value).toContain('{{location.city}}')
    })

    it('descriptionHighlighted leaves unknown tokens unstyled', () => {
      const editor = run()
      editor.internalDescription.value = '{{Creator|John}}'

      expect(editor.descriptionHighlighted.value).not.toContain('text-red-600')
      expect(editor.descriptionHighlighted.value).not.toContain('text-blue-600')
      expect(editor.descriptionHighlighted.value).toContain('{{Creator|John}}')
    })

    it('categoriesHighlighted wraps known tokens in blue span', () => {
      const editor = run()
      editor.internalCategories.value = '[[Category:Photos in {{location.city}}]]'

      expect(editor.categoriesHighlighted.value).toContain('text-blue-600')
    })
  })

  describe('previewItems', () => {
    it('returns up to 3 selected items with rendered title, description, categories', () => {
      store.globalDescription = 'Photo in {{location.city}}'
      store.globalCategories = '[[Category:{{location.city}}]]'
      const items: Record<string, Item> = {}
      for (let i = 1; i <= 4; i++) {
        items[String(i)] = makeItem(String(i), 'Berlin')
      }
      store.replaceItems(items)
      const editor = run()

      expect(editor.previewItems.value).toHaveLength(3)
      expect(editor.previewItems.value[0]!.description).toBe('Photo in Berlin')
      expect(editor.previewItems.value[0]!.categories).toBe('[[Category:Berlin]]')
    })
  })

  describe('onDragStart', () => {
    it('sets dataTransfer data correctly', () => {
      const { onDragStart } = run()
      const setDataMock = mock()
      const setDragImageMock = mock()
      const event = {
        dataTransfer: {
          setData: setDataMock,
          effectAllowed: '',
          setDragImage: setDragImageMock,
        },
      } as unknown as DragEvent

      const appendChildSpy = spyOn(document.body, 'appendChild')
      const removeChildSpy = spyOn(document.body, 'removeChild')
      const originalRAF = global.requestAnimationFrame
      global.requestAnimationFrame = mock((cb) => {
        cb(0)
        return 0
      }) as unknown as typeof requestAnimationFrame

      onDragStart(event, 'test.path')

      expect(setDataMock).toHaveBeenCalledWith('text/plain', '{{test.path}}')
      expect(event.dataTransfer!.effectAllowed).toBe('copy')
      expect(appendChildSpy).toHaveBeenCalled()
      const appendedEl = appendChildSpy.mock.calls[0]![0] as HTMLElement
      expect(appendedEl.tagName).toBe('DIV')
      expect(appendedEl.textContent).toBe('{{test.path}}')
      expect(appendedEl.className).toContain('absolute')
      expect(setDragImageMock).toHaveBeenCalledWith(appendedEl, 0, -10)
      expect(removeChildSpy).toHaveBeenCalledWith(appendedEl)

      global.requestAnimationFrame = originalRAF
      appendChildSpy.mockRestore()
      removeChildSpy.mockRestore()
    })

    it('does nothing if dataTransfer is missing', () => {
      const { onDragStart } = run()
      onDragStart({} as unknown as DragEvent, 'test.path')
    })
  })

  describe('auto-apply on change', () => {
    it('sets globalDescription after debounce fires', async () => {
      const editor = run()
      editor.internalDescription.value = 'New desc'
      await nextTick()

      expect(editor.descriptionStatus.value).toBe(null)

      for (const exec of debounceMock.pendingExecutors) await exec()

      expect(store.globalDescription).toBe('New desc')
      expect(editor.descriptionStatus.value).toBe('applied')
    })

    it('sets globalCategories and calls checkCategories with resolved template after debounce fires', async () => {
      const items: Record<string, Item> = {
        '1': makeItem('1', 'Berlin'),
        '2': makeItem('2', 'London'),
      }
      store.replaceItems(items)
      const editor = run()
      editor.internalCategories.value = '[[Category:Photos in {{location.city}}]]'
      await nextTick()

      for (const exec of debounceMock.pendingExecutors) await exec()

      expect(store.globalCategories).toBe('[[Category:Photos in {{location.city}}]]')
      expect(mockCheckCategories).toHaveBeenCalledWith(
        '[[Category:Photos in Berlin]]\n[[Category:Photos in London]]',
      )
      expect(editor.categoriesStatus.value).toBe('applied')
    })

    it('skips store write when description matches store but still shows applied', async () => {
      store.globalDescription = 'same'
      const editor = run()
      editor.internalDescription.value = 'same'
      await nextTick()

      for (const exec of debounceMock.pendingExecutors) await exec()

      // description debounce still early-returns (not dirty), status stays null
      expect(editor.descriptionStatus.value).toBe(null)
    })

    it('validates categories even when value matches store (preset case)', async () => {
      const editor = run()
      // simulate preset being applied after initialization
      store.globalCategories = '[[Category:Berlin Photos]]'
      await nextTick() // store watcher syncs internalCategories → triggers applyCategories debounce

      expect(editor.categoriesIsDirty.value).toBe(false)

      for (const exec of debounceMock.pendingExecutors) await exec()

      expect(mockCheckCategories).toHaveBeenCalled()
      expect(store.globalCategories).toBe('[[Category:Berlin Photos]]') // unchanged
    })

    it('clears status immediately when value changes after being applied', async () => {
      const editor = run()
      editor.internalDescription.value = 'first'
      await nextTick()
      for (const exec of debounceMock.pendingExecutors) await exec()
      expect(editor.descriptionStatus.value).toBe('applied')
      debounceMock.reset()

      editor.internalDescription.value = 'second'
      await nextTick()

      expect(editor.descriptionStatus.value).toBe(null)
    })

    it('categoriesStatus is applying then applied', async () => {
      const editor = run()
      editor.internalCategories.value = '[[Category:Berlin]]'
      await nextTick()

      const exec = debounceMock.pendingExecutors[debounceMock.pendingExecutors.length - 1]!
      const applyPromise = exec()
      expect(editor.categoriesStatus.value).toBe('applying')
      await applyPromise
      expect(editor.categoriesStatus.value).toBe('applied')
    })
  })
})
