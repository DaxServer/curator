import type {
  BatchItem,
  BatchUploadItem,
  Creator,
  MediaImage,
  PresetsList,
  SavePreset,
  UploadCreatedItem,
  UploadSliceAckItem,
  UploadStatus,
  UploadUpdateItem,
} from '@backend/types/ws'
import { useCommons } from '@frontend/composables/useCommons'
import { useSocket } from '@frontend/composables/useSocket'
import { useUploadStatus } from '@frontend/composables/useUploadStatus'
import { useAuthStore } from '@frontend/stores/auth.store'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { Image, Item } from '@frontend/types/image'
import { UPLOAD_STATUS } from '@frontend/types/image'
import { markRaw, watch } from 'vue'

export const UPLOAD_SLICE_SIZE = 18

const toImage = (mediaImage: MediaImage): Image => ({
  ...mediaImage,
  description: mediaImage.description ?? '',
  dates: {
    taken: new Date(mediaImage.dates.taken),
  },
})

const createItem = (image: Image, id: string, index: number, descriptionText: string): Item => ({
  id,
  index,
  image: markRaw(image),
  meta: {
    title: undefined,
    description: { language: 'en', value: descriptionText },
    categories: '',
    license: '',
    selected: false,
  },
  isSkeleton: false,
})

const createSkeletonItem = (id: string, index: number): Item => ({
  id,
  index,
  image: markRaw({
    id,
    title: '',
    creator: { id: '', username: '', profile_url: '' },
    dates: { taken: new Date() },
    location: { latitude: 0, longitude: 0, compass_angle: 0 },
    urls: {
      url: '',
      original: '',
      preview: '',
      thumbnail: '',
    },
    dimensions: {
      width: 0,
      height: 0,
    },
    camera: {
      make: undefined,
      model: undefined,
      is_pano: false,
    },
    existing: [],
    description: '',
  }),
  meta: {
    description: { language: 'en', value: '' },
    categories: '',
    license: '',
    selected: false,
  },
  isSkeleton: true,
})

export const initCollectionsListeners = () => {
  const store = useCollectionsStore()
  const { buildDescription, getEffectiveTitle, wikitext } = useCommons()
  const { isDuplicateStatus } = useUploadStatus()
  const { data, send, connected } = useSocket

  const sendSubscribeBatch = (batchId: number) => {
    if (store.isStatusChecking) return
    store.isStatusChecking = true
    send({ type: 'SUBSCRIBE_BATCH', data: batchId })
  }

  const onUploadsUpdate = (data: UploadUpdateItem[]) => {
    const newBatchUploads = [...store.batchUploads]
    let batchUploadsChanged = false

    for (const update of data) {
      // Only process updates for the batch we are currently viewing or just uploaded
      const batchId = Number(update.batchid)
      if (batchId !== Number(store.currentBatchId) && batchId !== Number(store.batchId)) continue

      // Update current session items if they exist
      if (store.items[update.key]) {
        store.updateItem(update.key, 'status', update.status as UploadStatus)
        if (
          update.status === UPLOAD_STATUS.Failed ||
          isDuplicateStatus(update.status as UploadStatus)
        ) {
          store.updateItem(update.key, 'statusReason', update.error?.message)
          store.updateItem(update.key, 'errorInfo', update.error ?? undefined)
        }
        if (update.status === UPLOAD_STATUS.Completed) {
          store.updateItem(update.key, 'successUrl', update.success ?? undefined)
        }
      }

      // Update batch uploads list if present
      const index = newBatchUploads.findIndex((u) => u.id === update.id)
      if (index !== -1) {
        batchUploadsChanged = true
        const upload = { ...newBatchUploads[index] } as BatchUploadItem
        upload.status = update.status
        if (
          update.status === UPLOAD_STATUS.Failed ||
          isDuplicateStatus(update.status as UploadStatus)
        ) {
          upload.error = update.error
        }
        if (update.status === UPLOAD_STATUS.Completed) {
          upload.success = update.success
        }
        newBatchUploads[index] = upload
      }
    }

    if (batchUploadsChanged) {
      if (store.batch) {
        store.batch = {
          ...store.batch,
          stats: {
            ...store.batch.stats,
            queued: newBatchUploads.filter((u) => u.status === UPLOAD_STATUS.Queued).length,
            in_progress: newBatchUploads.filter((u) => u.status === UPLOAD_STATUS.InProgress)
              .length,
            completed: newBatchUploads.filter((u) => u.status === UPLOAD_STATUS.Completed).length,
            failed: newBatchUploads.filter((u) => u.status === UPLOAD_STATUS.Failed).length,
            cancelled: newBatchUploads.filter((u) => u.status === UPLOAD_STATUS.Cancelled).length,
            duplicate: newBatchUploads.filter((u) => isDuplicateStatus(u.status as UploadStatus))
              .length,
          },
        }
      }
      store.batchUploads = newBatchUploads
    }

    const allDone = store.selectedItems.every((i) => {
      const status = i.meta.status
      return (
        status === UPLOAD_STATUS.Completed ||
        status === UPLOAD_STATUS.Failed ||
        (status && isDuplicateStatus(status))
      )
    })
    if (allDone && store.selectedItems.length > 0) store.isStatusChecking = false
  }

  const onUploadsComplete = (batchId: number) => {
    batchId = Number(batchId)
    if (batchId === Number(store.currentBatchId) || batchId === Number(store.batchId)) {
      store.isStatusChecking = false
    }
  }

  const onCollectionImages = (creator: Creator, images: MediaImage[], sequenceId: string) => {
    store.creator = creator
    store.input = sequenceId
    const allItems: Record<string, Item> = {}
    let index = 0
    for (const image of images) {
      const img = toImage(image)
      index += 1
      const descriptionText = buildDescription()
      allItems[image.id] = createItem(img, image.id, index, descriptionText)
    }
    store.replaceItems(allItems)
    store.stepper = '2'
    store.isLoading = false
  }

  const onError = (error: string) => {
    store.error = error || 'Failed'
    store.isLoading = false
  }

  const onUploadCreated = (items: UploadCreatedItem[]) => {
    if (items.length > 0) {
      store.batchId = items[0]!.batchid
      for (const r of items) {
        store.updateItem(r.image_id, 'status', r.status as UploadStatus)
      }
      if (store.batchId) sendSubscribeBatch(store.batchId)
    }
    store.isLoading = false
  }

  const onBatchesList = (partial: boolean, data: { items: BatchItem[]; total: number }) => {
    if (partial) {
      // Partial update: update existing items instead of full replace
      const existingBatches = [...store.batches]
      const updatedBatchIds = new Set(data.items.map((item) => item.id))

      // Remove existing items that are being updated
      const filteredBatches = existingBatches.filter((batch) => !updatedBatchIds.has(batch.id))

      // Add updated items
      const newBatches = [...filteredBatches, ...data.items]

      // Sort by id to maintain consistent order
      store.batches = newBatches.sort((a, b) => b.id - a.id)
    } else {
      // Full replace
      store.batches = data.items
    }
    store.batchesTotal = data.total
    store.batchesLoading = false
  }

  const onBatchUploadsList = (data: {
    batch_id: number
    uploads: BatchUploadItem[]
    partial: boolean
  }) => {
    if (data.batch_id !== store.currentBatchId) return
    store.batchUploads = [...store.batchUploads, ...data.uploads]
    if (!data.partial) store.batchUploadsLoading = false
  }

  const onBatchInfo = (data: { batch: BatchItem }) => {
    if (data.batch.id !== store.currentBatchId) return
    store.batch = data.batch
  }

  const onTryBatchRetrieval = (batchLoadingStatus: string) => {
    store.isBatchLoading = true
    store.batchLoadingStatus = batchLoadingStatus
  }

  const onCollectionImageIds = (ids: string[]) => {
    store.totalImageIds = ids
    store.stepper = '2'
    store.isLoading = false

    const skeletonItems: Record<string, Item> = {}
    ids.forEach((id, index) => {
      skeletonItems[id] = createSkeletonItem(id, index + 1)
    })
    store.replaceItems(skeletonItems)
  }

  const onPartialCollectionImages = (images: MediaImage[]) => {
    for (const image of images) {
      const img = toImage(image)

      const skeletonItem = store.items[image.id]
      if (!skeletonItem) {
        store.error = `Received partial image data for an unknown ID: ${image.id}`
        continue
      }

      const index = skeletonItem.index
      const descriptionText = buildDescription()
      store.items[image.id] = createItem(img, image.id, index, descriptionText)
    }

    // Fill in creator from first item if not already set
    if (!store.creator.id && images.length > 0) {
      store.creator = images[0]!.creator
    }

    if (store.loadedCount >= store.totalImageIds.length) {
      store.isBatchLoading = false
      store.batchLoadingStatus = null
    }
  }

  const sendSlice = (sliceIndex: number) => {
    if (!store.batchId) return
    const start = sliceIndex * UPLOAD_SLICE_SIZE
    const end = Math.min(start + UPLOAD_SLICE_SIZE, store.selectedItems.length)
    const sliceItems = store.selectedItems.slice(start, end).map((item) => ({
      id: item.id,
      input: store.input,
      title: getEffectiveTitle(item),
      wikitext: wikitext(item),
      labels: item.meta.description,
      copyright_override: (item.meta.license?.trim() || store.globalLicense.trim()) !== '',
    }))
    send({
      type: 'UPLOAD_SLICE',
      data: {
        batchid: store.batchId,
        sliceid: sliceIndex,
        handler: store.handler,
        items: sliceItems,
      },
    })
  }

  const onBatchCreated = (batchId: number) => {
    store.batchId = batchId
    store.uploadSliceIndex = 0
    if (!batchId) return
    const totalSlices = Math.ceil(store.selectedItems.length / UPLOAD_SLICE_SIZE)
    if (totalSlices === 0) {
      store.isLoading = false
      store.isBatchCreated = true
      sendSubscribeBatch(batchId)
      return
    }
    for (let i = 0; i < totalSlices; i++) {
      sendSlice(i)
    }
  }

  const onUploadSliceAck = (sliceId: number, items: UploadSliceAckItem[]) => {
    if (sliceId !== store.uploadSliceIndex) return
    store.uploadSliceIndex += 1
    items.forEach(({ id, status }) => {
      store.updateItem(id, 'status', status as UploadStatus)
    })
    const totalSlices = Math.ceil(store.selectedItems.length / UPLOAD_SLICE_SIZE)
    if (store.uploadSliceIndex >= totalSlices) {
      store.isLoading = false
      store.isBatchCreated = true
      sendSubscribeBatch(store.batchId!)
    }
  }

  const onSocketReconnect = () => {
    if (!store.batchId || store.isBatchCreated) return
    const totalSlices = Math.ceil(store.selectedItems.length / UPLOAD_SLICE_SIZE)
    for (let i = store.uploadSliceIndex; i < totalSlices; i++) {
      sendSlice(i)
    }
  }

  watch(
    connected,
    (isConnected, wasConnected) => {
      if (isConnected && wasConnected === false) onSocketReconnect()
    },
    { flush: 'sync' },
  )

  const onRetryUploadsResponse = (newBatchId: number) => {
    store.setRetryNewBatchId(newBatchId)
  }

  const onPresetsList = (data: PresetsList['data']) => {
    if (data.handler === store.handler) {
      store.setPresets(data.presets)
    }
  }

  watch(data, (msg) => {
    if (!msg) return

    switch (msg.type) {
      case 'UPLOADS_UPDATE':
        onUploadsUpdate(msg.data)
        break
      case 'UPLOADS_COMPLETE':
        onUploadsComplete(msg.data)
        break
      case 'COLLECTION_IMAGES':
        onCollectionImages(msg.data.creator, msg.data.images, msg.data.sequence_id)
        break
      case 'ERROR':
        onError(msg.data)
        break
      case 'UPLOAD_CREATED':
        onUploadCreated(msg.data)
        break
      case 'BATCHES_LIST':
        onBatchesList(msg.partial, msg.data)
        break
      case 'BATCH_UPLOADS_LIST':
        onBatchUploadsList(msg.data)
        break
      case 'BATCH_INFO':
        onBatchInfo(msg.data)
        break
      case 'TRY_BATCH_RETRIEVAL':
        onTryBatchRetrieval(msg.data)
        break
      case 'COLLECTION_IMAGE_IDS':
        onCollectionImageIds(msg.data)
        break
      case 'PARTIAL_COLLECTION_IMAGES':
        onPartialCollectionImages(msg.data.images)
        break
      case 'BATCH_CREATED':
        onBatchCreated(msg.data)
        break
      case 'UPLOAD_SLICE_ACK':
        onUploadSliceAck(msg.sliceid, msg.data)
        break
      case 'RETRY_UPLOADS_RESPONSE':
        onRetryUploadsResponse(msg.data)
        break
      case 'PRESETS_LIST':
        onPresetsList(msg.data)
        break
    }
  })

  return {
    onUploadsUpdate,
    onUploadsComplete,
    onCollectionImages,
    onError,
    onUploadCreated,
    onBatchesList,
    onBatchUploadsList,
    onBatchInfo,
    onTryBatchRetrieval,
    onCollectionImageIds,
    onPartialCollectionImages,
    onBatchCreated,
    onUploadSliceAck,
    onSocketReconnect,
    onRetryUploadsResponse,
    onPresetsList,
  }
}

export const useCollections = () => {
  const store = useCollectionsStore()
  const { send } = useSocket

  const sendSubscribeBatch = (batchId: number) => {
    if (store.isStatusChecking) return
    store.isStatusChecking = true
    send({ type: 'SUBSCRIBE_BATCH', data: batchId })
  }

  const sendUnsubscribeBatch = () => {
    store.isStatusChecking = false
    send({ type: 'UNSUBSCRIBE_BATCH' })
  }

  const subscribeBatchesList = (userid?: string, filter?: string) => {
    send({
      type: 'SUBSCRIBE_BATCHES_LIST',
      data: { userid, filter },
    })
  }

  const unsubscribeBatchesList = () => {
    send({ type: 'UNSUBSCRIBE_BATCHES_LIST' })
  }

  const loadCollection = () => {
    store.$reset()
    fetchPresets()
    store.isLoading = true
    const fetchImagesMsg = {
      type: 'FETCH_IMAGES' as const,
      data: store.input,
      handler: store.handler,
    }
    send(fetchImagesMsg)
  }

  const loadBatches = (page: number, rows: number, userid?: string, filter?: string) => {
    store.batchesLoading = true
    store.batches = []
    store.batchesTotal = 0
    send({
      type: 'FETCH_BATCHES',
      data: {
        page: page / rows + 1,
        limit: rows,
        userid,
        filter,
      },
    })
  }

  const refreshBatches = () => {
    const authStore = useAuthStore()
    const userid =
      store.batchesSelectedFilter?.value === 'my' && authStore.userid ? authStore.userid : undefined
    loadBatches(
      store.batchesParams.first,
      store.batchesParams.rows,
      userid,
      store.batchesFilterText,
    )
  }

  const loadBatchUploads = (batchId: number) => {
    store.batchUploadsLoading = true
    store.batchUploads = []
    store.currentBatchId = batchId
    store.batch = store.batches.find((b) => b.id === batchId)
    send({ type: 'FETCH_BATCH', data: batchId })
    send({
      type: 'FETCH_BATCH_UPLOADS',
      data: { batch_id: batchId, page_size: store.uploadPageSize },
    })
  }

  const retryUploads = (batchId: number) => {
    send({
      type: 'RETRY_UPLOADS',
      data: batchId,
    })
  }

  const cancelBatch = (batchId: number) => {
    send({
      type: 'CANCEL_BATCH',
      data: batchId,
    })
  }

  const adminRetrySelectedUploads = async (uploadIds: number[], batchId: number) => {
    try {
      const response = await fetch('/api/admin/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_ids: uploadIds }),
      })
      if (!response.ok) {
        throw new Error('Failed to retry uploads')
      }
      const data = await response.json()
      if (data.new_batch_id) {
        store.setRetryNewBatchId(data.new_batch_id)
        // Don't reload current batch since we're navigating away
        return
      }
    } catch {
      store.error = 'Failed to retry uploads'
    } finally {
      // Only reload if we're not navigating to a new batch
      if (!store.retryNewBatchId) {
        loadBatchUploads(batchId)
        sendSubscribeBatch(batchId)
      }
    }
  }

  const startUploadProcess = () => {
    store.isLoading = true
    send({ type: 'CREATE_BATCH' })
  }

  const submitUpload = () => {
    store.error = null
    if (store.selectedCount === 0) {
      store.error = 'Please select at least one image to upload'
      return
    }
    store.stepper = '5'
  }

  const fetchPresets = () => {
    const fetchPresetsMsg = {
      type: 'FETCH_PRESETS' as const,
      data: { handler: store.handler },
    }
    send(fetchPresetsMsg)
  }

  const savePreset = (preset: SavePreset['data']) => {
    send({
      type: 'SAVE_PRESET',
      data: preset,
    })
  }

  const deletePreset = (presetId: number) => {
    send({
      type: 'DELETE_PRESET',
      data: { preset_id: presetId },
    })
  }

  return {
    loadCollection,
    submitUpload,
    startUploadProcess,
    loadBatches,
    refreshBatches,
    loadBatchUploads,
    retryUploads,
    cancelBatch,
    adminRetrySelectedUploads,
    sendSubscribeBatch,
    sendUnsubscribeBatch,
    subscribeBatchesList,
    unsubscribeBatchesList,
    fetchPresets,
    savePreset,
    deletePreset,
  }
}
