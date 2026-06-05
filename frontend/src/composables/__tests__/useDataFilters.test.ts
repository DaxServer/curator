import { createMockUploadItem, useHappyDom } from '@frontend/__tests__/fixtures'
import { useDataFilters } from '@frontend/composables/useDataFilters'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import { UPLOAD_STATUS } from '@frontend/types/image'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { createPinia, setActivePinia } from 'pinia'

describe('useDataFilters', () => {
  useHappyDom()

  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useCollectionsStore()

    store.batchUploads = [
      createMockUploadItem(1, UPLOAD_STATUS.Completed),
      createMockUploadItem(2, UPLOAD_STATUS.Failed, 'Upload failed'),
      createMockUploadItem(3, UPLOAD_STATUS.Queued),
      createMockUploadItem(4, UPLOAD_STATUS.InProgress),
      createMockUploadItem(5, UPLOAD_STATUS.Failed, 'Network error'),
    ]

    // Mock useUploadStatus
    mock.module('../useUploadStatus', () => ({
      useUploadStatus: () => ({
        isDuplicateStatus: (status: string) => {
          const duplicateStatuses = ['Duplicate', 'LocalDuplicate', 'RemoteDuplicate']
          return duplicateStatuses.includes(status)
        },
        getStatusLabel: (status: string) => status,
        getStatusColor: () => 'green',
        getStatusSeverity: () => 'success',
        getStatusStyle: () => ({}),
      }),
    }))
  })

  describe('initial state', () => {
    it('should initialize with empty search text', () => {
      const { searchText } = useDataFilters()
      expect(searchText.value).toBe('')
    })

    it('should initialize with "all" filter value', () => {
      const { filterValue } = useDataFilters()
      expect(filterValue.value).toBe('all')
    })

    it('should return all items when no filters are applied', () => {
      const { filteredItems } = useDataFilters()
      const store = useCollectionsStore()

      expect(filteredItems.value.length).toBe(store.batchUploads.length)
    })
  })

  describe('filter by status', () => {
    it('should filter items by Completed status', () => {
      const { filterValue, filteredItems } = useDataFilters()

      filterValue.value = UPLOAD_STATUS.Completed

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.id).toBe(1)
    })

    it('should filter items by Failed status', () => {
      const { filterValue, filteredItems } = useDataFilters()

      filterValue.value = UPLOAD_STATUS.Failed

      expect(filteredItems.value.length).toBe(2)
      expect(filteredItems.value.every((item) => item.status === UPLOAD_STATUS.Failed)).toBe(true)
    })

    it('should filter items by Queued status', () => {
      const { filterValue, filteredItems } = useDataFilters()

      filterValue.value = UPLOAD_STATUS.Queued

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.id).toBe(3)
    })

    it('should return all items when filter is "all"', () => {
      const { filterValue, filteredItems } = useDataFilters()
      const store = useCollectionsStore()

      filterValue.value = UPLOAD_STATUS.Completed
      expect(filteredItems.value.length).toBe(1)

      filterValue.value = 'all'
      expect(filteredItems.value.length).toBe(store.batchUploads.length)
    })
  })

  describe('search functionality', () => {
    it('should search by filename', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'file-2'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.filename).toBe('file-2.jpg')
    })

    it('should search by key', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'key-3'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.key).toBe('key-3')
    })

    it('should search by ID', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = '4'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.id).toBe(4)
    })

    it('should search by wikitext', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'text for 5'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.id).toBe(5)
    })

    it('should search by status', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'failed'

      expect(filteredItems.value.length).toBe(2)
      expect(filteredItems.value.every((item) => item.status === UPLOAD_STATUS.Failed)).toBe(true)
    })

    it('should search by error message', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'Network'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.error?.message).toContain('Network')
    })

    it('should be case insensitive', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'FILE-2'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.filename).toBe('file-2.jpg')
    })

    it('should return empty array when search matches nothing', () => {
      const { searchText, filteredItems } = useDataFilters()

      searchText.value = 'nonexistent'

      expect(filteredItems.value.length).toBe(0)
    })

    it('should return all items when search is empty', () => {
      const { searchText, filteredItems } = useDataFilters()
      const store = useCollectionsStore()

      searchText.value = 'file-1'
      expect(filteredItems.value.length).toBe(1)

      searchText.value = ''
      expect(filteredItems.value.length).toBe(store.batchUploads.length)
    })
  })

  describe('combined filters', () => {
    it('should apply both status filter and search', () => {
      const { filterValue, searchText, filteredItems } = useDataFilters()

      filterValue.value = UPLOAD_STATUS.Failed
      searchText.value = 'Upload'

      expect(filteredItems.value.length).toBe(1)
      expect(filteredItems.value[0]!.id).toBe(2)
      expect(filteredItems.value[0]!.error?.message).toContain('Upload')
    })

    it('should only apply status filter when search is empty', () => {
      const { filterValue, searchText, filteredItems } = useDataFilters()

      filterValue.value = UPLOAD_STATUS.Failed
      searchText.value = ''

      expect(filteredItems.value.length).toBe(2)
    })

    it('should only apply search when status filter is "all"', () => {
      const { filterValue, searchText, filteredItems } = useDataFilters()

      filterValue.value = 'all'
      searchText.value = 'file'

      expect(filteredItems.value.length).toBe(5)
    })
  })

  describe('filtered count', () => {
    it('should return correct count when filtered', () => {
      const { filterValue, filteredCount } = useDataFilters()

      filterValue.value = UPLOAD_STATUS.Failed

      expect(filteredCount.value).toBe(2)
    })

    it('should return zero when no items match', () => {
      const { searchText, filteredCount } = useDataFilters()

      searchText.value = 'nonexistent'

      expect(filteredCount.value).toBe(0)
    })
  })

  describe('total count', () => {
    it('should return total count of all items', () => {
      const { totalCount } = useDataFilters()
      const store = useCollectionsStore()

      expect(totalCount.value).toBe(store.batchUploads.length)
    })

    it('should not change when filters are applied', () => {
      const { filterValue, searchText, totalCount } = useDataFilters()
      const store = useCollectionsStore()

      filterValue.value = UPLOAD_STATUS.Failed
      searchText.value = 'test'

      expect(totalCount.value).toBe(store.batchUploads.length)
    })
  })

  describe('clear filters', () => {
    it('should reset all filters to default state', () => {
      const { filterValue, searchText, filteredItems, clearFilters } = useDataFilters()
      const store = useCollectionsStore()

      filterValue.value = UPLOAD_STATUS.Failed
      searchText.value = 'test'

      expect(filteredItems.value.length).toBeLessThan(store.batchUploads.length)

      clearFilters()

      expect(filterValue.value).toBe('all')
      expect(searchText.value).toBe('')
      expect(filteredItems.value.length).toBe(store.batchUploads.length)
    })
  })

  describe('reactivity', () => {
    it('should update filtered items when store changes', () => {
      const { filteredItems } = useDataFilters()
      const store = useCollectionsStore()

      expect(filteredItems.value.length).toBe(5)

      store.batchUploads = [createMockUploadItem(1, UPLOAD_STATUS.Completed)]

      expect(filteredItems.value.length).toBe(1)
    })

    it('should react to search text changes', () => {
      const { searchText, filteredItems } = useDataFilters()

      expect(filteredItems.value.length).toBe(5)

      searchText.value = 'file-1'

      expect(filteredItems.value.length).toBe(1)
    })

    it('should react to filter value changes', () => {
      const { filterValue, filteredItems } = useDataFilters()

      expect(filteredItems.value.length).toBe(5)

      filterValue.value = UPLOAD_STATUS.Completed

      expect(filteredItems.value.length).toBe(1)
    })
  })
})
