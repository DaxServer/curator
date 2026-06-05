import type {
  BatchUploadItem,
  ClientMessage,
  MediaImage,
  ServerMessage,
  UploadCreatedItem,
  UploadUpdateItem,
} from '@backend/types/ws'
import { type Image, type Item, UPLOAD_STATUS } from '@frontend/types/image'
import { type Mock, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { ref } from 'vue'

type BatchesListData = Extract<ServerMessage, { type: 'BATCHES_LIST' }>['data']
type BatchUploadsListData = Extract<ServerMessage, { type: 'BATCH_UPLOADS_LIST' }>['data']
type UploadSliceMsg = Extract<ClientMessage, { type: 'UPLOAD_SLICE' }>

import { UPLOAD_SLICE_SIZE } from '@frontend/composables/useCollections'

// Mock useSocket
export const mockSocketData = ref<ServerMessage | null>(null)
export const mockSend = mock(() => {})

const mockSocketImpl = () => ({
  useSocket: {
    data: mockSocketData,
    send: mockSend,
  },
})

// Mock all possible paths
mock.module('@frontend/composables/useSocket', mockSocketImpl)
mock.module('../useSocket', mockSocketImpl)
mock.module(resolve(__dirname, '../useSocket.ts'), mockSocketImpl)

import { useCollectionsStore } from '@frontend/stores/collections.store'
import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'

// Import the code under test
import type { initCollectionsListeners as InitCollectionsListenersType } from '@frontend/composables/useCollections'
import { resolve } from 'node:path'

const createMockImage = (overrides: Partial<Image> = {}): Image => ({
  id: 'img1',
  title: '',
  description: '',
  urls: { url: '', original: '', preview: '', thumbnail: '' },
  dimensions: { width: 100, height: 100 },
  creator: { id: 'c1', username: 'u1', profile_url: '' },
  dates: { taken: new Date() },
  location: { latitude: 0, longitude: 0, compass_angle: 0 },
  camera: { make: undefined, model: undefined, is_pano: false },
  existing: [],
  ...overrides,
})

const createMockItem = (overrides: Partial<Item> = {}): Item => ({
  id: 'img1',
  index: 0,
  isSkeleton: false,
  image: createMockImage(),
  meta: {
    selected: true,
    description: { language: 'en', value: '' },
    categories: '',
    license: '',
    status: UPLOAD_STATUS.Queued,
  },
  ...overrides,
})

describe('useCollections Listeners', () => {
  let initCollectionsListeners: typeof InitCollectionsListenersType
  let listeners: ReturnType<typeof InitCollectionsListenersType>
  let store: ReturnType<typeof useCollectionsStore>

  beforeAll(async () => {
    const mod = await import('../useCollections')
    initCollectionsListeners = mod.initCollectionsListeners
  })

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    store = useCollectionsStore()
    mockSend.mockClear()
    listeners = initCollectionsListeners()
  })

  describe('onUploadsUpdate', () => {
    it('should update item status and stop checking if all done', () => {
      store.currentBatchId = 123
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            selected: true,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
          },
        }),
        img2: createMockItem({
          id: 'img2',
          index: 1,
          meta: {
            status: UPLOAD_STATUS.Queued,
            selected: true,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
          },
        }),
      })
      store.isStatusChecking = true

      const updateData: UploadUpdateItem[] = [
        {
          id: 1,
          key: 'img1',
          status: UPLOAD_STATUS.Completed,
          success: 'http://url',
          error: null,
          batchid: 123,
          handler: 'mapillary',
        },
        {
          id: 2,
          key: 'img2',
          status: UPLOAD_STATUS.Failed,
          error: { message: 'err', type: 'error' },
          success: null,
          batchid: 123,
          handler: 'mapillary',
        },
      ]

      listeners.onUploadsUpdate(updateData)

      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Completed)
      expect(store.items.img1!.meta.successUrl).toBe('http://url')
      expect(store.items.img2!.meta.status).toBe(UPLOAD_STATUS.Failed)
      expect(store.items.img2!.meta.statusReason).toBe('err')
      expect(store.isStatusChecking).toBe(false)
    })

    it('should match updates against batchId and set errorInfo', () => {
      store.batchId = 123
      store.isStatusChecking = true
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            selected: true,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
          },
        }),
      })

      const updateData: UploadUpdateItem[] = [
        {
          id: 1,
          key: 'img1',
          status: UPLOAD_STATUS.Failed,
          error: { message: 'err', type: 'error' },
          success: null,
          batchid: 123,
          handler: 'mapillary',
        },
      ]

      listeners.onUploadsUpdate(updateData)

      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Failed)
      expect(store.items.img1!.meta.statusReason).toBe('err')
      expect(store.items.img1!.meta.errorInfo).toEqual({ message: 'err', type: 'error' })
      expect(store.isStatusChecking).toBe(false)
    })

    it('should not stop status checking when nothing is selected', () => {
      store.currentBatchId = 123
      store.isStatusChecking = true
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            selected: false,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
          },
        }),
      })

      const updateData: UploadUpdateItem[] = [
        {
          id: 1,
          key: 'img1',
          status: UPLOAD_STATUS.Completed,
          success: 'url',
          error: null,
          batchid: 123,
          handler: 'mapillary',
        },
      ]

      listeners.onUploadsUpdate(updateData)

      expect(store.isStatusChecking).toBe(true)
    })

    it('should ignore updates for different batch', () => {
      store.currentBatchId = 123
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
      })
      const updateData: UploadUpdateItem[] = [
        {
          id: 1,
          key: 'img1',
          status: UPLOAD_STATUS.Completed,
          error: null,
          success: null,
          batchid: 999,
          handler: 'mapillary',
        },
      ]

      listeners.onUploadsUpdate(updateData)

      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Queued)
    })

    it('should update batchUploads list if present', () => {
      store.currentBatchId = 123
      const uploadItem = {
        id: 1,
        key: 'img1',
        status: UPLOAD_STATUS.Queued,
        filename: 'file.jpg',
        wikitext: '',
      } as unknown as BatchUploadItem
      store.batchUploads = [uploadItem]

      const updateData: UploadUpdateItem[] = [
        {
          id: 1,
          key: 'img1',
          status: UPLOAD_STATUS.Completed,
          success: 'url',
          error: null,
          batchid: 123,
          handler: 'mapillary',
        },
      ]

      listeners.onUploadsUpdate(updateData)

      expect(store.batchUploads[0]!.status).toBe(UPLOAD_STATUS.Completed)
      expect(store.batchUploads[0]!.success).toBe('url')
    })

    it('should handle empty update data array', () => {
      store.currentBatchId = 123
      store.replaceItems({
        img1: createMockItem({ id: 'img1', index: 0 }),
      })

      listeners.onUploadsUpdate([])

      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Queued)
      expect(store.isStatusChecking).toBe(false)
    })

    it('should handle duplicate status', () => {
      store.currentBatchId = 123
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            selected: true,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
          },
        }),
      })

      const updateData: UploadUpdateItem[] = [
        {
          id: 1,
          key: 'img1',
          status: UPLOAD_STATUS.Duplicate,
          error: null,
          success: null,
          batchid: 123,
          handler: 'mapillary',
        },
      ]

      listeners.onUploadsUpdate(updateData)

      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Duplicate)
      expect(store.isStatusChecking).toBe(false)
    })
  })

  describe('onUploadsComplete', () => {
    it('should stop status checking if batch matches', () => {
      store.currentBatchId = 123
      store.isStatusChecking = true

      listeners.onUploadsComplete(123)

      expect(store.isStatusChecking).toBe(false)
    })

    it('should not stop status checking if batch does not match', () => {
      store.currentBatchId = 123
      store.isStatusChecking = true

      listeners.onUploadsComplete(456)

      expect(store.isStatusChecking).toBe(true)
    })

    it('should stop status checking if batch matches batchId', () => {
      store.batchId = 123
      store.currentBatchId = 999
      store.isStatusChecking = true

      listeners.onUploadsComplete(123)

      expect(store.isStatusChecking).toBe(false)
    })
  })

  describe('onCollectionImages', () => {
    it('should replace items and update creator', () => {
      const creator = { id: 'c1', username: 'u1', profile_url: '' }
      const images: MediaImage[] = [
        {
          id: 'img1',
          title: '',
          description: 'desc',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: new Date().toISOString() },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          creator: { id: 'c1', username: 'u1', profile_url: '' },
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onCollectionImages(creator, images, 'seq1')

      expect(store.creator).toEqual(creator)
      expect(store.items.img1).toBeDefined()
      expect(store.items.img1!.id).toBe('img1')
      expect(store.stepper).toBe('2')
      expect(store.isLoading).toBe(false)
      expect(store.items.img1!.meta.description.value).toBe('Photo from Mapillary')
    })

    it('should coerce dates.taken into Date and default missing description', () => {
      const creator = { id: 'c1', username: 'u1', profile_url: '' }
      const takenIso = new Date('2024-01-01T00:00:00.000Z').toISOString()
      const images: MediaImage[] = [
        {
          id: 'img1',
          title: '',
          description: '',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: takenIso },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          creator,
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onCollectionImages(creator, images, 'seq1')

      expect(store.items.img1!.image.dates.taken).toBeInstanceOf(Date)
      expect(store.items.img1!.image.dates.taken.toISOString()).toBe(takenIso)
      expect(store.items.img1!.image.description).toBe('')
      expect(store.items.img1!.index).toBe(1)
    })

    it('should handle empty images object', () => {
      const creator = { id: 'c1', username: 'u1', profile_url: '' }
      const images: MediaImage[] = []

      listeners.onCollectionImages(creator, images, 'seq1')

      expect(store.creator).toEqual(creator)
      expect(Object.keys(store.items)).toHaveLength(0)
      expect(store.stepper).toBe('2')
      expect(store.isLoading).toBe(false)
    })
  })

  describe('onError', () => {
    it('should set error and stop loading', () => {
      store.isLoading = true

      listeners.onError('Some error')

      expect(store.error).toBe('Some error')
      expect(store.isLoading).toBe(false)
    })

    it('should set default error if empty', () => {
      listeners.onError('')
      expect(store.error).toBe('Failed')
    })

    it('should handle null error message', () => {
      listeners.onError(null as unknown as string)
      expect(store.error).toBe('Failed')
    })

    it('should handle undefined error message', () => {
      listeners.onError(undefined as unknown as string)
      expect(store.error).toBe('Failed')
    })

    it('should clear previous error state when new error occurs', () => {
      store.error = 'Previous error'
      store.isLoading = true

      listeners.onError('New error')

      expect(store.error).toBe('New error')
      expect(store.isLoading).toBe(false)
    })

    it('should handle very long error messages', () => {
      const longError = 'A'.repeat(1000)
      listeners.onError(longError)
      expect(store.error).toBe(longError)
    })

    it('should handle special characters in error messages', () => {
      const specialError = 'Error with special chars: !@#$%^&*()_+{}|:"<>?[]\\;\',./`~'
      listeners.onError(specialError)
      expect(store.error).toBe(specialError)
    })
  })

  describe('onUploadCreated', () => {
    it('should update item status and subscribe to batch', () => {
      store.isLoading = true
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
      })

      const items: UploadCreatedItem[] = [
        { id: 1, image_id: 'img1', batchid: 100, status: UPLOAD_STATUS.Queued, input: '' },
      ]

      listeners.onUploadCreated(items)

      expect(store.batchId).toBe(100)
      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Queued)
      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect(sentMsg).toMatchObject({
        type: 'SUBSCRIBE_BATCH',
        data: 100,
      })
      expect(store.isLoading).toBe(false)
    })

    it('should stop loading and not subscribe when items is empty', () => {
      store.isLoading = true

      listeners.onUploadCreated([])

      expect(store.isLoading).toBe(false)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should update multiple item statuses', () => {
      store.isLoading = true
      store.replaceItems({
        img1: createMockItem({
          id: 'img1',
          index: 0,
          meta: {
            status: UPLOAD_STATUS.Queued,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
        img2: createMockItem({
          id: 'img2',
          index: 1,
          meta: {
            status: UPLOAD_STATUS.Queued,
            description: { language: 'en', value: '' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
      })

      const items: UploadCreatedItem[] = [
        { id: 1, image_id: 'img1', batchid: 100, status: UPLOAD_STATUS.InProgress, input: '' },
        { id: 2, image_id: 'img2', batchid: 100, status: UPLOAD_STATUS.Queued, input: '' },
      ]

      listeners.onUploadCreated(items)

      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.InProgress)
      expect(store.items.img2!.meta.status).toBe(UPLOAD_STATUS.Queued)
    })
  })

  describe('onBatchesList', () => {
    it('should replace batches on full update', () => {
      const data: BatchesListData = {
        items: [
          {
            id: 1,
            created_at: '',
            updated_at: '',
            username: '',
            userid: '',
            edit_group_id: null,
            stats: {
              cancelled: 0,
              completed: 0,
              duplicate: 0,
              failed: 0,
              in_progress: 0,
              queued: 0,
              total: 0,
            },
          },
          {
            id: 2,
            created_at: '',
            updated_at: '',
            username: '',
            userid: '',
            edit_group_id: null,
            stats: {
              cancelled: 0,
              completed: 0,
              duplicate: 0,
              failed: 0,
              in_progress: 0,
              queued: 0,
              total: 0,
            },
          },
        ],
        total: 2,
      }

      listeners.onBatchesList(false, data)

      expect(store.batches).toEqual(data.items)
      expect(store.batchesTotal).toBe(2)
      expect(store.batchesLoading).toBe(false)
    })

    it('should merge batches on partial update', () => {
      store.batches = [
        {
          id: 1,
          created_at: '',
          updated_at: '',
          username: '',
          userid: '',
          edit_group_id: null,
          stats: {
            cancelled: 0,
            completed: 0,
            duplicate: 0,
            failed: 0,
            in_progress: 0,
            queued: 0,
            total: 0,
          },
        },
        {
          id: 2,
          created_at: '',
          updated_at: '',
          username: '',
          userid: '',
          edit_group_id: null,
          stats: {
            cancelled: 0,
            completed: 0,
            duplicate: 0,
            failed: 0,
            in_progress: 0,
            queued: 0,
            total: 0,
          },
        },
      ]
      const data: BatchesListData = {
        items: [
          {
            id: 2,
            created_at: 'updated',
            updated_at: '',
            username: '',
            userid: '',
            edit_group_id: null,
            stats: {
              cancelled: 0,
              completed: 0,
              duplicate: 0,
              failed: 0,
              in_progress: 0,
              queued: 0,
              total: 0,
            },
          },
          {
            id: 3,
            created_at: '',
            updated_at: '',
            username: '',
            userid: '',
            edit_group_id: null,
            stats: {
              cancelled: 0,
              completed: 0,
              duplicate: 0,
              failed: 0,
              in_progress: 0,
              queued: 0,
              total: 0,
            },
          },
        ],
        total: 3,
      }

      listeners.onBatchesList(true, data)

      expect(store.batches).toHaveLength(3)
      expect(store.batches[0]!.id).toBe(3)
      expect(store.batches.find((b) => b.id === 2)!.created_at).toBe('updated') // Should update existing
      expect(store.batches.find((b) => b.id === 3)).toBeDefined() // Should add new
      expect(store.batchesTotal).toBe(3)
      expect(store.batchesLoading).toBe(false)
    })

    it('should handle empty items array', () => {
      const data: BatchesListData = {
        items: [],
        total: 0,
      }

      listeners.onBatchesList(false, data)

      expect(store.batches).toEqual([])
      expect(store.batchesTotal).toBe(0)
      expect(store.batchesLoading).toBe(false)
    })
  })

  describe('onBatchUploadsList', () => {
    it('should update batch uploads if current batch matches', () => {
      store.currentBatchId = 123
      const data: BatchUploadsListData = {
        batch: {
          id: 123,
          created_at: '',
          updated_at: '',
          username: '',
          userid: '',
          edit_group_id: null,
          stats: {
            cancelled: 0,
            completed: 0,
            duplicate: 0,
            failed: 0,
            in_progress: 0,
            queued: 0,
            total: 0,
          },
        },
        uploads: [
          {
            id: 1,
            status: 'queued',
            filename: '',
            wikitext: '',
            batchid: 0,
            userid: '',
            key: '',
            handler: 'mapillary',
            labels: null,
            result: null,
            error: null,
            success: null,
            created_at: '',
            updated_at: '',
          },
        ],
      }

      listeners.onBatchUploadsList(data)

      expect(store.batch).toEqual(data.batch)
      expect(store.batchUploads).toEqual(data.uploads)
      expect(store.batchUploadsLoading).toBe(false)
    })

    it('should ignore batch uploads if current batch does not match', () => {
      store.currentBatchId = 123
      store.batchUploadsLoading = true
      store.batch = {
        id: 123,
        created_at: '',
        updated_at: '',
        username: '',
        userid: '',
        edit_group_id: null,
        stats: {
          cancelled: 0,
          completed: 0,
          duplicate: 0,
          failed: 0,
          in_progress: 0,
          queued: 0,
          total: 0,
        },
      }
      store.batchUploads = [
        { id: 1, status: '', filename: '', wikitext: '' } as unknown as BatchUploadItem,
      ]

      const data: BatchUploadsListData = {
        batch: {
          id: 999,
          created_at: '',
          updated_at: '',
          username: '',
          userid: '',
          edit_group_id: null,
          stats: {
            cancelled: 0,
            completed: 0,
            duplicate: 0,
            failed: 0,
            in_progress: 0,
            queued: 0,
            total: 0,
          },
        },
        uploads: [
          {
            id: 2,
            status: 'queued',
            filename: '',
            wikitext: '',
            batchid: 0,
            userid: '',
            key: '',
            handler: 'mapillary',
            labels: null,
            result: null,
            error: null,
            success: null,
            created_at: '',
            updated_at: '',
          },
        ],
      }

      listeners.onBatchUploadsList(data)

      expect(store.batch!.id).toBe(123)
      expect(store.batchUploads).toHaveLength(1)
      expect(store.batchUploadsLoading).toBe(true)
    })

    it('should handle batch id of 0', () => {
      store.currentBatchId = 0
      store.batchUploadsLoading = true
      const data: BatchUploadsListData = {
        batch: {
          id: 0,
          created_at: '',
          updated_at: '',
          username: '',
          userid: '',
          edit_group_id: null,
          stats: {
            cancelled: 0,
            completed: 0,
            duplicate: 0,
            failed: 0,
            in_progress: 0,
            queued: 0,
            total: 0,
          },
        },
        uploads: [
          {
            id: 1,
            status: 'queued',
            filename: '',
            wikitext: '',
            batchid: 0,
            userid: '',
            key: '',
            handler: 'mapillary',
            labels: null,
            result: null,
            error: null,
            success: null,
            created_at: '',
            updated_at: '',
          },
        ],
      }

      listeners.onBatchUploadsList(data)

      expect(store.batch!.id).toBe(0)
      expect(store.batchUploads).toHaveLength(1)
      expect(store.batchUploadsLoading).toBe(false)
    })
  })

  describe('onTryBatchRetrieval', () => {
    it('should set batch loading flags', () => {
      listeners.onTryBatchRetrieval('Loading')

      expect(store.isBatchLoading).toBe(true)
      expect(store.batchLoadingStatus).toBe('Loading')
    })
  })

  describe('onCollectionImageIds', () => {
    it('should create skeleton items', () => {
      const ids = ['1', '2']

      listeners.onCollectionImageIds(ids)

      expect(store.totalImageIds).toEqual(ids)
      expect(store.stepper).toBe('2')
      expect(store.isLoading).toBe(false)

      expect(Object.keys(store.items)).toHaveLength(2)
      expect(store.items['1']!.isSkeleton).toBe(true)
    })

    it('should assign 1-based indexes and clear previous items', () => {
      store.replaceItems({ old: createMockItem({ id: 'old', index: 0 }) })

      listeners.onCollectionImageIds(['1', '2'])

      expect(store.items.old).toBeUndefined()
      expect(store.items['1']!.index).toBe(1)
      expect(store.items['2']!.index).toBe(2)
    })

    it('should handle empty array', () => {
      store.replaceItems({ old: createMockItem({ id: 'old', index: 0 }) })

      listeners.onCollectionImageIds([])

      expect(store.items.old).toBeUndefined()
      expect(store.totalImageIds).toEqual([])
      expect(Object.keys(store.items)).toHaveLength(0)
    })
  })

  describe('onPartialCollectionImages', () => {
    it('should fill skeleton items with data', () => {
      // Setup skeleton item
      store.replaceItems({
        '1': createMockItem({
          id: '1',
          index: 0,
          isSkeleton: true,
          image: createMockImage({ id: '1', dimensions: { width: 0, height: 0 } }),
          meta: {
            description: { value: '', language: 'en' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
      })
      store.totalImageIds = ['1']
      store.isBatchLoading = true

      const images: MediaImage[] = [
        {
          id: '1',
          title: '',
          description: '',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: new Date().toISOString() },
          creator: { id: 'c1', username: 'u1', profile_url: '' },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onPartialCollectionImages(images)

      expect(store.items['1']!.isSkeleton).toBe(false)
      expect(store.creator.id).toBe('c1')
      expect(store.isBatchLoading).toBe(false)
      expect(store.batchLoadingStatus).toBe(null)
    })

    it('should keep batch loading true until all images are loaded', () => {
      store.replaceItems({
        '1': createMockItem({
          id: '1',
          index: 0,
          isSkeleton: true,
          image: createMockImage({ id: '1', dimensions: { width: 0, height: 0 } }),
          meta: {
            description: { value: '', language: 'en' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
        '2': createMockItem({
          id: '2',
          index: 1,
          isSkeleton: true,
          image: createMockImage({ id: '2', dimensions: { width: 0, height: 0 } }),
          meta: {
            description: { value: '', language: 'en' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
      })
      store.totalImageIds = ['1', '2']
      store.isBatchLoading = true
      store.batchLoadingStatus = 'Loading'

      const images: MediaImage[] = [
        {
          id: '1',
          title: '',
          description: '',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: new Date().toISOString() },
          creator: { id: 'c1', username: 'u1', profile_url: '' },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onPartialCollectionImages(images)

      expect(store.isBatchLoading).toBe(true)
      expect(store.batchLoadingStatus).toBe('Loading')
    })

    it('should not override creator when already set', () => {
      store.creator = { id: 'existing', username: 'u', profile_url: '' }
      store.replaceItems({
        '1': createMockItem({
          id: '1',
          index: 0,
          isSkeleton: true,
          image: createMockImage({ id: '1', dimensions: { width: 0, height: 0 } }),
          meta: {
            description: { value: '', language: 'en' },
            categories: '',
            license: '',
            selected: false,
          },
        }),
      })
      store.totalImageIds = ['1']
      store.isBatchLoading = true
      store.batchLoadingStatus = 'Loading'

      const images: MediaImage[] = [
        {
          id: '1',
          title: '',
          description: '',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: new Date().toISOString() },
          creator: { id: 'other', username: 'x', profile_url: '' },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onPartialCollectionImages(images)

      expect(store.creator.id).toBe('existing')
    })

    it('should handle unknown IDs gracefully', () => {
      store.replaceItems({})
      const images: MediaImage[] = [
        {
          id: 'unknown',
          title: '',
          description: '',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: new Date().toISOString() },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          creator: { id: '', username: '', profile_url: '' },
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onPartialCollectionImages(images)

      expect(store.error).toContain('unknown ID')
    })

    it('should handle when totalImageIds is empty', () => {
      store.totalImageIds = []
      store.isBatchLoading = true
      const images: MediaImage[] = [
        {
          id: '1',
          title: '',
          description: '',
          urls: { url: '', original: '', preview: '', thumbnail: '' },
          dimensions: { width: 100, height: 100 },
          dates: { taken: new Date().toISOString() },
          location: { latitude: 0, longitude: 0, compass_angle: 0 },
          creator: { id: '', username: '', profile_url: '' },
          camera: { make: undefined, model: undefined, is_pano: false },
          existing: [],
        },
      ]

      listeners.onPartialCollectionImages(images)

      // When totalImageIds is empty, loadedCount (0) >= totalImageIds.length (0), so isBatchLoading should be false
      expect(store.isBatchLoading).toBe(false)
      expect(store.batchLoadingStatus).toBe(null)
    })
  })

  describe('onBatchCreated', () => {
    it('should set batchId and send first slice', () => {
      // Mock selectedItems logic via items
      const newItems: Record<string, Item> = {}
      for (let i = 0; i < 15; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: '', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onBatchCreated(100)

      expect(store.batchId).toBe(100)
      expect(store.uploadSliceIndex).toBe(0)

      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect(sentMsg).toMatchObject({
        type: 'UPLOAD_SLICE',
        data: {
          sliceid: 0,
        },
      })
    })

    it('should subscribe immediately if there are no selected items', () => {
      store.isLoading = true

      listeners.onBatchCreated(100)

      expect(store.isLoading).toBe(false)
      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect(sentMsg).toMatchObject({
        type: 'SUBSCRIBE_BATCH',
        data: 100,
      })
    })

    it('should handle negative batch ID', () => {
      store.isLoading = true

      listeners.onBatchCreated(-1)

      expect(store.isLoading).toBe(false)
      expect(store.batchId).toBe(-1)
    })

    it('should handle zero batch ID', () => {
      store.isLoading = true

      listeners.onBatchCreated(0)

      expect(store.isLoading).toBe(true) // Loading remains true because batchId=0 is falsy
      expect(store.batchId).toBe(0)
    })

    it(`should handle exactly ${UPLOAD_SLICE_SIZE} selected items (one full slice)`, () => {
      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: '', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onBatchCreated(100)

      expect(store.batchId).toBe(100)
      expect(store.uploadSliceIndex).toBe(0)
      expect(store.isBatchCreated).toBe(false) // Not created yet, need to wait for ACK

      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect(sentMsg).toMatchObject({
        type: 'UPLOAD_SLICE',
        data: {
          sliceid: 0,
        },
      })
      expect((sentMsg as UploadSliceMsg).data.items).toHaveLength(UPLOAD_SLICE_SIZE)

      // After ACK, isBatchCreated should be true
      listeners.onUploadSliceAck(0, [])
      expect(store.isBatchCreated).toBe(true)
    })

    it(`should handle exactly ${UPLOAD_SLICE_SIZE * 2} selected items (two full slices)`, () => {
      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE * 2; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: '', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onBatchCreated(100)

      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect((sentMsg as UploadSliceMsg).data.items).toHaveLength(UPLOAD_SLICE_SIZE)
    })
  })

  describe('onUploadSliceAck', () => {
    it('should send next slice if index matches', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0

      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE + 5; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: '', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onUploadSliceAck(0, [])

      expect(store.uploadSliceIndex).toBe(1)
      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect(sentMsg).toMatchObject({
        type: 'UPLOAD_SLICE',
        data: {
          sliceid: 1,
        },
      })
    })

    it('should not send next slice if index does not match', () => {
      store.batchId = 100
      store.uploadSliceIndex = 1

      listeners.onUploadSliceAck(0, [])

      expect(store.uploadSliceIndex).toBe(1)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should update item statuses from ACK response', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0

      const newItems: Record<string, Item> = {}
      for (let i = 0; i < 5; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: '', language: 'en' },
            categories: '',
            status: UPLOAD_STATUS.Queued,
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      const ackItems = [
        { id: 'img0', status: UPLOAD_STATUS.Queued },
        { id: 'img1', status: UPLOAD_STATUS.Queued },
        { id: 'img2', status: UPLOAD_STATUS.InProgress },
      ]

      listeners.onUploadSliceAck(0, ackItems)

      expect(store.uploadSliceIndex).toBe(1)
      expect(store.items.img0!.meta.status).toBe(UPLOAD_STATUS.Queued)
      expect(store.items.img1!.meta.status).toBe(UPLOAD_STATUS.Queued)
      expect(store.items.img2!.meta.status).toBe(UPLOAD_STATUS.InProgress)
      expect(store.items.img3!.meta.status).toBe(UPLOAD_STATUS.Queued) // Unchanged
      expect(store.items.img4!.meta.status).toBe(UPLOAD_STATUS.Queued) // Unchanged
    })

    it('should send slice payload with batchid, handler, and up to UPLOAD_SLICE_SIZE items', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0
      store.input = 'input'
      store.globalLicense = ''

      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE * 2 + 5; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: 'd', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onUploadSliceAck(0, [])

      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const arg = calls[0]![0]
      const sentMsg = arg as ClientMessage
      expect((sentMsg as UploadSliceMsg).data.batchid).toBe(100)
      expect((sentMsg as UploadSliceMsg).data.handler).toBe('mapillary')
      expect((sentMsg as UploadSliceMsg).data.items).toHaveLength(UPLOAD_SLICE_SIZE)
      expect((sentMsg as UploadSliceMsg).data.items[0]).toMatchObject({
        input: 'input',
        labels: { value: 'd', language: 'en' },
        copyright_override: false,
      })
      expect(typeof (sentMsg as UploadSliceMsg).data.items[0]!.title).toBe('string')
      expect(typeof (sentMsg as UploadSliceMsg).data.items[0]!.wikitext).toBe('string')
    })

    it('should handle undefined slice ID', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0

      listeners.onUploadSliceAck(undefined as unknown as number, [])

      expect(store.uploadSliceIndex).toBe(0)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should handle null slice ID', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0

      listeners.onUploadSliceAck(null as unknown as number, [])

      expect(store.uploadSliceIndex).toBe(0)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should handle NaN slice ID', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0

      listeners.onUploadSliceAck(NaN, [])

      expect(store.uploadSliceIndex).toBe(0)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should handle negative slice ID', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0

      listeners.onUploadSliceAck(-1, [])

      expect(store.uploadSliceIndex).toBe(0)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should handle slice ID when no batch ID is set', () => {
      store.batchId = null
      store.uploadSliceIndex = 0

      listeners.onUploadSliceAck(0, [])

      expect(store.uploadSliceIndex).toBe(1) // Index gets incremented even when batchId is null
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should handle slice ID when uploadSliceIndex is negative', () => {
      store.batchId = 100
      store.uploadSliceIndex = -1

      listeners.onUploadSliceAck(0, [])

      expect(store.uploadSliceIndex).toBe(-1)
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('should complete all slices and subscribe to batch', () => {
      store.batchId = 100
      store.uploadSliceIndex = 1
      store.isLoading = true

      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE + 5; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: 'd', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onUploadSliceAck(1, [])

      expect(store.uploadSliceIndex).toBe(2)
      expect(store.isBatchCreated).toBe(true)
      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const arg = calls[calls.length - 1]![0]
      const sentMsg = arg as ClientMessage

      // With UPLOAD_SLICE_SIZE + 5 items, slice index 2 means start at UPLOAD_SLICE_SIZE * 2,
      // which is >= UPLOAD_SLICE_SIZE + 5, so it should complete
      if (sentMsg.type === 'UPLOAD_SLICE') {
        expect(sentMsg.data.items).toHaveLength(0) // Empty slice, should trigger subscription
      }
    })

    it('should handle copyright_override when license is set on item', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0
      store.input = 'input'
      store.globalLicense = ''

      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE + 5; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: 'CC-BY-SA-4.0',
            description: { value: 'd', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onUploadSliceAck(0, [])

      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      // Get the first UPLOAD_SLICE message
      const uploadSliceCall = calls.find((call) => {
        const msg = call[0] as ClientMessage
        return msg.type === 'UPLOAD_SLICE'
      })
      expect(uploadSliceCall).toBeDefined()
      const sentMsg = uploadSliceCall![0] as UploadSliceMsg
      expect(sentMsg.data.items.length).toBeGreaterThan(0)
      expect(sentMsg.data.items[0]!.copyright_override).toBe(true)
    })

    it('should handle copyright_override when globalLicense is set', () => {
      store.batchId = 100
      store.uploadSliceIndex = 0
      store.input = 'input'
      store.globalLicense = 'CC-BY-4.0'

      const newItems: Record<string, Item> = {}
      for (let i = 0; i < UPLOAD_SLICE_SIZE + 5; i++) {
        const id = `img${i}`
        newItems[id] = createMockItem({
          id,
          meta: {
            selected: true,
            license: '',
            description: { value: 'd', language: 'en' },
            categories: '',
          },
          image: createMockImage({ id }),
        })
      }
      store.replaceItems(newItems)

      listeners.onUploadSliceAck(0, [])

      expect(mockSend).toHaveBeenCalled()
      const calls = (mockSend as Mock<(data: unknown) => void>).mock.calls
      // Get the first UPLOAD_SLICE message
      const uploadSliceCall = calls.find((call) => {
        const msg = call[0] as ClientMessage
        return msg.type === 'UPLOAD_SLICE'
      })
      expect(uploadSliceCall).toBeDefined()
      const sentMsg = uploadSliceCall![0] as UploadSliceMsg
      expect(sentMsg.data.items.length).toBeGreaterThan(0)
      expect(sentMsg.data.items[0]!.copyright_override).toBe(true)
    })
  })
})
