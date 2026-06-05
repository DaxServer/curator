import { createMockUploadItem, useHappyDom } from '@frontend/__tests__/fixtures'
import { useBatchSelection } from '@frontend/composables/useBatchSelection'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import { beforeEach, describe, expect, it } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'

describe('useBatchSelection', () => {
  useHappyDom()

  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useCollectionsStore()
    store.batchUploads = Array.from({ length: 5 }, (_, i) => createMockUploadItem(i + 1))
  })

  describe('initial state', () => {
    it('should initialize with selection mode off', () => {
      const { isSelectionMode } = useBatchSelection()
      expect(isSelectionMode.value).toBe(false)
    })

    it('should initialize with empty selection', () => {
      const { selectedIds, selectedCount } = useBatchSelection()
      expect(selectedIds.value.size).toBe(0)
      expect(selectedCount.value).toBe(0)
    })
  })

  describe('selection mode management', () => {
    it('should start selection mode and clear existing selections', () => {
      const { isSelectionMode, selectedIds, startSelectionMode } = useBatchSelection()

      // Manually add some selections
      selectedIds.value.add(1)
      selectedIds.value.add(2)

      startSelectionMode()

      expect(isSelectionMode.value).toBe(true)
      expect(selectedIds.value.size).toBe(0)
    })

    it('should exit selection mode and clear selections', () => {
      const { isSelectionMode, selectedIds, startSelectionMode, exitSelectionMode } =
        useBatchSelection()

      startSelectionMode()
      selectedIds.value.add(1)
      selectedIds.value.add(2)

      exitSelectionMode()

      expect(isSelectionMode.value).toBe(false)
      expect(selectedIds.value.size).toBe(0)
    })
  })

  describe('item selection', () => {
    it('should toggle item selection when not selected', () => {
      const { selectedIds, isSelected, toggleSelection } = useBatchSelection()

      expect(isSelected(1)).toBe(false)

      toggleSelection(1)

      expect(isSelected(1)).toBe(true)
      expect(selectedIds.value.has(1)).toBe(true)
    })

    it('should toggle item selection when already selected', () => {
      const { selectedIds, isSelected, toggleSelection } = useBatchSelection()

      toggleSelection(1)
      expect(isSelected(1)).toBe(true)

      toggleSelection(1)

      expect(isSelected(1)).toBe(false)
      expect(selectedIds.value.has(1)).toBe(false)
    })

    it('should track selected count correctly', () => {
      const { selectedCount, toggleSelection } = useBatchSelection()

      expect(selectedCount.value).toBe(0)

      toggleSelection(1)
      expect(selectedCount.value).toBe(1)

      toggleSelection(2)
      expect(selectedCount.value).toBe(2)

      toggleSelection(1)
      expect(selectedCount.value).toBe(1)
    })
  })

  describe('bulk selection', () => {
    it('should select all items from store', () => {
      const { selectedIds, selectedCount, selectAll } = useBatchSelection()
      const store = useCollectionsStore()

      selectAll()

      expect(selectedCount.value).toBe(store.batchUploads.length)
      for (const item of store.batchUploads) {
        expect(selectedIds.value.has(item.id)).toBe(true)
      }
    })

    it('should deselect all items', () => {
      const { selectedIds, selectedCount, selectAll, deselectAll } = useBatchSelection()

      selectAll()
      expect(selectedCount.value).toBe(5)

      deselectAll()

      expect(selectedCount.value).toBe(0)
      expect(selectedIds.value.size).toBe(0)
    })

    it('should handle selectAll when store is empty', () => {
      const { selectedIds, selectedCount, selectAll } = useBatchSelection()
      const store = useCollectionsStore()

      store.batchUploads = []
      selectAll()

      expect(selectedCount.value).toBe(0)
      expect(selectedIds.value.size).toBe(0)
    })
  })

  describe('selection state persistence', () => {
    it('should maintain selections across operations', () => {
      const { isSelected, toggleSelection, deselectAll } = useBatchSelection()

      toggleSelection(1)
      toggleSelection(2)
      toggleSelection(3)

      expect(isSelected(1)).toBe(true)
      expect(isSelected(2)).toBe(true)
      expect(isSelected(3)).toBe(true)
      expect(isSelected(4)).toBe(false)

      deselectAll()

      expect(isSelected(1)).toBe(false)
      expect(isSelected(2)).toBe(false)
      expect(isSelected(3)).toBe(false)
    })
  })
})
