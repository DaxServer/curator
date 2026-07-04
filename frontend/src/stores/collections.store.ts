import type { BatchItem, BatchUploadItem, Creator, Handler, PresetItem } from '@backend/types/ws'
import type { Layout } from '@frontend/types/collections'
import { ImageHandler } from '@frontend/types/collections'
import type { Item, Metadata, MetadataKey } from '@frontend/types/image'
import { TITLE_ERROR_STATUSES } from '@frontend/types/image'
import type { FilterItem } from '@frontend/utils/filterSelection'
import {
  selectByMinInterval as filterByMinInterval,
  selectByTraversalDistance as filterByTraversalDistance,
  selectEveryNth as filterEveryNth,
  selectByStraightLineDistance,
} from '@frontend/utils/filterSelection'
import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'

export const useCollectionsStore = defineStore('collections', () => {
  const handler = ref<Handler>(ImageHandler.MAPILLARY)
  const input = ref<string>('')
  const creator = ref<Creator>({ id: '', username: '', profile_url: '' })

  const isLoading = ref(false)
  const error = ref<string | null>(null)

  const clearError = () => {
    error.value = null
  }
  const items = reactive<Record<string, Item>>({})
  const isStatusChecking = ref<boolean>(false)
  const batchId = ref<number | null>(null)
  const stepper = ref('1')
  const isBatchLoading = ref(false)
  const batchLoadingStatus = ref<string | null>(null)
  const totalImageIds = ref<string[]>([])
  const ackedSliceIds = ref<Set<number>>(new Set())
  const isBatchCreated = ref(false)
  const showSelectedOnly = ref(true)
  const viewMode = ref<Layout>('list')
  const gridPage = ref<number>(1)
  const gridItemsPerPage = ref<number>(24)
  const page = ref<number>(1)
  const itemsPerPage = ref<number>(10)

  const globalDescription = ref<string>('')
  const globalLanguage = ref<string>('en')
  const globalCategories = ref<string>('')
  const globalLicense = ref<string>('')
  const globalDateCategory = ref<boolean>(false)
  const globalTitleTemplate = ref<string>('')

  // Presets state
  const presets = ref<PresetItem[]>([])
  const currentPresetId = ref<number | null>(null)
  const isEditingPreset = ref(false)
  const isAccordionOpen = ref(false)

  // Batches state
  const batches = shallowRef<BatchItem[]>([])
  const batchesTotal = ref<number>(0)
  const batchesLoading = ref(false)
  const batch = ref<BatchItem>()
  const batchUploads = shallowRef<BatchUploadItem[]>([])
  const batchUploadsLoading = ref(false)
  const uploadPageSize = ref(100)
  const currentBatchId = ref<number | null>(null)
  const retryNewBatchId = ref<number | null>(null)
  const batchesFilter = ref([
    { label: 'My uploads', value: 'my' },
    { label: 'All uploads', value: 'all' },
  ])
  const batchesSelectedFilter = ref(batchesFilter.value[0])
  const batchesFilterText = ref('')
  const batchesParams = ref({
    first: 0,
    rows: 100,
    page: 1,
  })

  const itemsArray = computed(() => Object.values(items))
  const chronoItems = computed(() =>
    [...itemsArray.value].sort(
      (a, b) => a.image.dates.taken.getTime() - b.image.dates.taken.getTime(),
    ),
  )
  const totalImages = computed(() => itemsArray.value.length)
  const selectedItems = computed(() => itemsArray.value.filter((i) => i.meta.selected))
  const selectedCount = computed(() => selectedItems.value.length)
  const itemsWithErrorsCount = computed(
    () =>
      selectedItems.value.filter(
        (i) => i.meta.titleStatus && TITLE_ERROR_STATUSES.includes(i.meta.titleStatus),
      ).length,
  )
  const itemsWithExistingTitlesCount = computed(
    () => selectedItems.value.filter((i) => i.image.existing.length > 0).length,
  )
  const anyItemsWithExistingFiles = computed(() =>
    itemsArray.value.some((i) => i.image.existing.length > 0),
  )

  // Preset getters
  const defaultPreset = computed(() => presets.value.find((p) => p.is_default))
  const hasPresets = computed(() => presets.value.length > 0)
  const currentPreset = computed(() => {
    if (!currentPresetId.value) return null
    return presets.value.find((p) => p.id === currentPresetId.value) ?? null
  })
  const setLoading = (loading: boolean) => {
    isLoading.value = loading
  }

  const clearItems = () => {
    for (const id in items) {
      delete items[id]
    }
  }

  const replaceItems = (nextItems: Record<string, Item>) => {
    clearItems()
    Object.assign(items, nextItems)
  }

  const updateItem = <K extends MetadataKey>(id: string, key: K, value: Metadata[K]) => {
    items[id]!.meta[key] = value
  }

  const updateSelected = (ids: (string | number)[]) => {
    const idsSet = new Set(ids)
    for (const id in items) {
      const item = items[id]
      if (!item) continue
      item.meta.selected = idsSet.has(item.id)
    }
  }

  const selectAll = () => {
    for (const item of itemsArray.value) {
      item.meta.selected = true
    }
  }

  const deselectAll = () => {
    for (const item of itemsArray.value) {
      item.meta.selected = false
    }
  }

  const selectUnuploaded = () => {
    for (const item of itemsArray.value) {
      item.meta.selected = item.image.existing.length === 0
    }
  }

  const toFilterItems = (storeItems: typeof chronoItems.value): FilterItem[] =>
    storeItems.map((item) => ({
      capturedAt: item.image.dates.taken,
      latitude: item.image.location.latitude,
      longitude: item.image.location.longitude,
    }))

  const applySelection = (
    storeItems: typeof chronoItems.value,
    selected: boolean[],
    add: boolean,
  ) => {
    if (!add) deselectAll()
    storeItems.forEach((item, i) => {
      if (selected[i]) item.meta.selected = true
    })
  }

  const selectEveryNth = (n: number, add: boolean) => {
    const items = chronoItems.value
    applySelection(items, filterEveryNth(toFilterItems(items), n), add)
  }

  const selectByMinDistance = (minMeters: number, add: boolean) => {
    const items = chronoItems.value
    applySelection(items, selectByStraightLineDistance(toFilterItems(items), minMeters), add)
  }

  const selectByTraversalDistance = (minMeters: number, add: boolean) => {
    const items = chronoItems.value
    applySelection(items, filterByTraversalDistance(toFilterItems(items), minMeters), add)
  }

  const selectByMinInterval = (minSeconds: number, add: boolean) => {
    const items = chronoItems.value
    applySelection(items, filterByMinInterval(toFilterItems(items), minSeconds * 1000), add)
  }

  const selectPage = (start: number, rows: number) => {
    const end = start + rows
    const pageItems = itemsArray.value.slice(start, end)
    for (const item of pageItems) {
      item.meta.selected = true
    }
  }

  const setGlobalDescription = (value: string) => {
    globalDescription.value = value
  }

  const setGlobalLanguage = (value: string) => {
    globalLanguage.value = value
  }

  const setGlobalCategories = (value: string) => {
    globalCategories.value = value
  }

  const setGlobalLicense = (value: string) => {
    globalLicense.value = value
  }

  const setGlobalDateCategory = (value: boolean) => {
    globalDateCategory.value = value
  }

  const setGlobalTitleTemplate = (value: string) => {
    globalTitleTemplate.value = value
  }

  // Preset actions
  const setPresets = (newPresets: PresetItem[]) => {
    presets.value = newPresets
  }

  const setActivePreset = (id: number | null) => {
    currentPresetId.value = id
  }

  const setEditingPreset = (editing: boolean) => {
    isEditingPreset.value = editing
  }

  const setAccordionOpen = (open: boolean) => {
    isAccordionOpen.value = open
  }

  const toggleAccordion = () => {
    isAccordionOpen.value = !isAccordionOpen.value
  }

  const applyPreset = (preset: PresetItem) => {
    globalTitleTemplate.value = preset.title_template
    globalDescription.value = preset.labels?.value ?? ''
    globalLanguage.value = preset.labels?.language ?? 'en'
    globalCategories.value = preset.categories ?? ''
    globalDateCategory.value = !preset.exclude_from_date_category
    setActivePreset(preset.id)
  }

  const setRetryNewBatchId = (batchId: number | null) => {
    retryNewBatchId.value = batchId
  }

  const setViewMode = (mode: Layout) => {
    viewMode.value = mode
  }

  const toggleViewMode = () => {
    viewMode.value = viewMode.value === 'list' ? 'grid' : 'list'
  }

  const setGridPage = (p: number) => {
    gridPage.value = p
  }

  const setGridItemsPerPage = (n: number) => {
    gridItemsPerPage.value = n
  }

  const setPage = (p: number) => {
    page.value = p
  }

  const setItemsPerPage = (n: number) => {
    itemsPerPage.value = n
  }

  const setHandler = (h: Handler) => {
    handler.value = h
  }

  const setInput = (v: string) => {
    input.value = v
  }

  const loadedCount = computed(() => itemsArray.value.filter((i) => !i.isSkeleton).length)

  const $reset = () => {
    clearItems()
    error.value = null
    batchId.value = null
    isStatusChecking.value = false
    isLoading.value = false
    showSelectedOnly.value = true
    viewMode.value = 'list'
    gridPage.value = 1
    gridItemsPerPage.value = 12
    page.value = 1
    itemsPerPage.value = 10
    globalDescription.value = ''
    globalLanguage.value = 'en'
    globalCategories.value = ''
    globalLicense.value = ''
    globalDateCategory.value = false
    stepper.value = '1'
    globalTitleTemplate.value = ''
    creator.value = { id: '', username: '', profile_url: '' }
    batches.value = []
    batchesTotal.value = 0
    batchesLoading.value = false
    batch.value = undefined
    batchUploads.value = []
    batchUploadsLoading.value = false
    currentBatchId.value = null
    isBatchLoading.value = false
    batchLoadingStatus.value = null
    totalImageIds.value = []
    ackedSliceIds.value = new Set()
    isBatchCreated.value = false
    retryNewBatchId.value = null
    // Don't clear presets - they are user-specific, not collection-specific
    // presets.value = []
    currentPresetId.value = null
    isEditingPreset.value = false
  }

  const resetBatches = () => {
    batches.value = []
    batchesTotal.value = 0
    batchesLoading.value = false
    batchesSelectedFilter.value = batchesFilter.value[0]
    batchesFilterText.value = ''
    batchesParams.value = {
      first: 0,
      rows: 100,
      page: 1,
    }
  }

  return {
    handler,
    input,
    creator,
    isLoading,
    error,
    items,
    isStatusChecking,
    batchId,
    stepper,
    showSelectedOnly,
    viewMode,
    gridPage,
    gridItemsPerPage,
    page,
    itemsPerPage,
    globalDescription,
    globalLanguage,
    globalCategories,
    globalLicense,
    globalDateCategory,
    globalTitleTemplate,
    itemsArray,
    chronoItems,
    totalImages,
    selectedCount,
    selectedItems,
    itemsWithErrorsCount,
    itemsWithExistingTitlesCount,
    anyItemsWithExistingFiles,
    batches,
    batchesTotal,
    batchesLoading,
    batch,
    batchUploads,
    batchUploadsLoading,
    uploadPageSize,
    currentBatchId,
    retryNewBatchId,
    batchesFilter,
    batchesSelectedFilter,
    batchesFilterText,
    batchesParams,
    isBatchLoading,
    batchLoadingStatus,
    totalImageIds,
    loadedCount,
    ackedSliceIds,
    isBatchCreated,
    presets,
    currentPresetId,
    isEditingPreset,
    isAccordionOpen,
    defaultPreset,
    hasPresets,
    currentPreset,

    clearError,
    setAccordionOpen,
    toggleAccordion,
    setLoading,
    setGlobalDescription,
    setGlobalLanguage,
    setGlobalCategories,
    setGlobalLicense,
    setGlobalDateCategory,
    setGlobalTitleTemplate,
    setRetryNewBatchId,
    setPresets,
    setActivePreset,
    setEditingPreset,
    applyPreset,
    updateItem,
    updateSelected,
    selectAll,
    deselectAll,
    selectUnuploaded,
    selectEveryNth,
    selectByMinInterval,
    selectByMinDistance,
    selectByTraversalDistance,
    selectPage,
    setViewMode,
    toggleViewMode,
    setGridPage,
    setGridItemsPerPage,
    setPage,
    setItemsPerPage,
    setHandler,
    setInput,
    replaceItems,
    resetBatches,
    $reset,
  }
})
