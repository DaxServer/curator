<script setup lang="ts">
import { useBatchSelection } from '@frontend/composables/useBatchSelection'
import { useCollections } from '@frontend/composables/useCollections'
import { useCommons } from '@frontend/composables/useCommons'
import { useDataFilters } from '@frontend/composables/useDataFilters'
import { useUploadStatus } from '@frontend/composables/useUploadStatus'
import { useAuthStore } from '@frontend/stores/auth.store'
import { useCollectionsStore } from '@frontend/stores/collections.store'
import type { BatchStatsCard } from '@frontend/types/collections'
import { UPLOAD_STATUS } from '@frontend/types/image'

const batchId = useRouteParams('id', 0, { transform: Number })
const router = useRouter()

const authStore = useAuthStore()
const store = useCollectionsStore()
const { toLocalTimezoneString } = useCommons()

const {
  loadBatchUploads,
  retryUploads,
  cancelBatch,
  adminRetrySelectedUploads,
  sendSubscribeBatch,
  sendUnsubscribeBatch,
} = useCollections()
const { getStatusLabel, getStatusColor, getStatusSeverity, getStatusStyle } = useUploadStatus()

const {
  isSelectionMode,
  selectedCount,
  startSelectionMode,
  exitSelectionMode,
  toggleSelection,
  isSelected,
  selectAll,
  deselectAll,
  selectedIds,
} = useBatchSelection()

const columns = [
  { field: 'id', header: 'ID' },
  { field: 'key', header: 'Mapillary Image ID' },
  { field: 'status', header: 'Status' },
  { field: 'error', header: 'Error' },
  { field: 'filename', header: 'Filename' },
  { field: 'wikitext', header: 'Wikitext' },
]

const selectionColumns = computed(() => {
  if (isSelectionMode.value) {
    return [{ field: '_selected', header: 'Select' }, ...columns]
  }
  return columns
})

const statCards = computed((): BatchStatsCard[] => {
  const stats = store.batch?.stats
  return [
    {
      label: 'Total',
      count: stats?.total,
      color: getStatusColor('all'),
      value: 'all',
      alwaysActive: store.batch !== undefined,
    },
    {
      label: 'Uploaded',
      count: stats?.completed,
      color: getStatusColor(UPLOAD_STATUS.Completed),
      value: UPLOAD_STATUS.Completed,
    },
    {
      label: 'Failed',
      count: stats?.failed,
      color: getStatusColor(UPLOAD_STATUS.Failed),
      value: UPLOAD_STATUS.Failed,
    },
    {
      label: 'Duplicates',
      count: stats?.duplicate,
      color: getStatusColor(UPLOAD_STATUS.Duplicate),
      value: UPLOAD_STATUS.Duplicate,
    },
    {
      label: 'Processing',
      count: stats?.in_progress,
      color: getStatusColor(UPLOAD_STATUS.InProgress),
      value: UPLOAD_STATUS.InProgress,
    },
    {
      label: 'Queued',
      count: stats?.queued,
      color: getStatusColor(UPLOAD_STATUS.Queued),
      value: UPLOAD_STATUS.Queued,
    },
    {
      label: 'Cancelled',
      count: stats?.cancelled,
      color: getStatusColor(UPLOAD_STATUS.Cancelled),
      value: UPLOAD_STATUS.Cancelled,
    },
  ]
})

const { filterValue, searchText, filteredItems } = useDataFilters()

const hasPendingJobs = computed(() => {
  if (!store.batch) return false
  const { stats } = store.batch
  return stats.queued > 0 || stats.in_progress > 0
})

const handleAdminRetrySelectedUploads = async () => {
  await adminRetrySelectedUploads(Array.from(selectedIds.value), batchId.value)
  exitSelectionMode()
}

const isSubscribed = ref(false)

const load = (id: number) => {
  store.batch = undefined
  store.batchUploads = []
  loadBatchUploads(id)
}

onBeforeMount(() => {
  load(batchId.value)
})

watch(batchId, (newId) => {
  if (isSubscribed.value) {
    sendUnsubscribeBatch()
    isSubscribed.value = false
  }
  load(newId)
})

watch([hasPendingJobs, () => store.batchUploadsLoading], ([pending, loading]) => {
  if (pending && !loading && !isSubscribed.value) {
    sendSubscribeBatch(batchId.value)
    isSubscribed.value = true
  }
})

watch(
  () => store.retryNewBatchId,
  (newBatchId) => {
    if (newBatchId) {
      store.setRetryNewBatchId(null)
      // Unsubscribe from old batch before navigating (if subscribed)
      if (isSubscribed.value) {
        sendUnsubscribeBatch()
        isSubscribed.value = false
      }
      router.push(`/batches/${newBatchId}`)
    }
  },
)

onUnmounted(() => {
  store.batch = undefined
  store.batchUploads = []
  store.currentBatchId = null
  if (isSubscribed.value) {
    sendUnsubscribeBatch()
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col items-start gap-4">
      <Button
        as="router-link"
        to="/batches"
        icon="pi pi-arrow-left"
        text
        class="mr-2"
        label="Back to batches"
      />
      <Card>
        <template #title>
          <div class="flex items-center gap-3 justify-between">
            <div class="flex items-end gap-3">
              <span>Batch #{{ batchId }}</span>
              <span class="text-sm font-normal text-gray-500">
                <template v-if="store.batch">
                  {{ toLocalTimezoneString(new Date(store.batch.created_at)) }}
                </template>
                <Skeleton v-else />
              </span>
            </div>
            <template v-if="store.batch">
              <Tag
                v-if="hasPendingJobs"
                severity="info"
                value="Processing Updates..."
                icon="pi pi-spin pi-spinner"
              />
              <Button
                v-if="store.batch.stats.failed > 0 && authStore.userid === store.batch.userid"
                icon="pi pi-refresh"
                severity="danger"
                label="Retry Failed"
                size="small"
                @click="retryUploads(Number(batchId))"
              />
              <Button
                v-if="
                  store.batch.stats.queued > 0 &&
                  (authStore.userid === store.batch.userid || authStore.isAdmin)
                "
                icon="pi pi-times"
                severity="danger"
                label="Cancel Queued"
                size="small"
                @click="cancelBatch(Number(batchId))"
              />
              <template v-if="isSelectionMode">
                <Button
                  icon="pi pi-check"
                  severity="success"
                  :label="`Retry (${selectedCount})`"
                  :disabled="selectedCount === 0"
                  size="small"
                  class="ml-2"
                  @click="handleAdminRetrySelectedUploads()"
                />
                <Button
                  icon="pi pi-times"
                  severity="secondary"
                  label="Cancel"
                  size="small"
                  @click="exitSelectionMode()"
                />
              </template>
              <Button
                v-else-if="authStore.isAdmin"
                icon="pi pi-refresh"
                severity="warning"
                label="Retry Selected"
                size="small"
                class="ml-2"
                @click="startSelectionMode()"
              />
            </template>
          </div>
        </template>
        <template #subtitle>
          <div class="flex items-center gap-2 mt-1">
            <i class="pi pi-user text-sm"></i>
            <span v-if="store.batch">{{ store.batch.username }}</span>
            <Skeleton v-else />
          </div>
        </template>
        <template #content>
          <div class="grid grid-cols-7 gap-4 mt-2">
            <BatchStatsCard
              v-for="stat in statCards"
              :key="stat.label"
              :label="stat.label"
              :count="stat.count"
              :color="stat.color"
              :always-active="stat.alwaysActive"
              :selected="filterValue === stat.value"
              @click="filterValue = stat.value"
            />
          </div>
        </template>
      </Card>
    </div>

    <!-- Selection mode toolbar -->
    <div
      v-if="isSelectionMode"
      class="flex gap-2"
    >
      <Button
        label="Select All (Current Page)"
        size="small"
        severity="secondary"
        @click="selectAll()"
      />
      <Button
        label="Deselect All"
        size="small"
        severity="secondary"
        @click="deselectAll()"
      />
    </div>

    <SharedDataTable
      :loading="store.batchUploadsLoading"
      :value="filteredItems"
      :columns="selectionColumns"
      :row-class="() => ({ 'align-top': true })"
      :rows="store.uploadPageSize"
      :rows-per-page-options="[10, 20, 50, 100]"
      @page="store.uploadPageSize = $event.rows"
    >
      <template #header>
        <FilterHeader
          v-model:filter-text="searchText"
          :filter-info="`(${filteredItems.length} of ${store.batchUploads.length} uploads)`"
          search-placeholder="Search uploads..."
          search-id="search-uploads"
          @clear="searchText = ''"
        />
      </template>
      <template #body-cell="{ col, data }">
        <template v-if="col.field === '_selected'">
          <Checkbox
            :model-value="isSelected(data.id)"
            binary
            @update:model-value="() => toggleSelection(data.id)"
          />
        </template>
        <template v-else-if="col.field === 'key'">
          <ExternalLink :href="`https://www.mapillary.com/app/?pKey=${data.key}&focus=photo`">
            {{ data.key }}&nbsp;
          </ExternalLink>
        </template>
        <template v-else-if="col.field === 'status'">
          <Tag
            :severity="getStatusSeverity(data.status)"
            :style="getStatusStyle(data.status)"
          >
            {{ getStatusLabel(data.status) }}
          </Tag>
        </template>
        <template v-else-if="col.field === 'error'">
          <ErrorDisplay
            v-if="data.error"
            :error="data.error"
          />
        </template>
        <template v-else-if="col.field === 'filename' && data.status === UPLOAD_STATUS.Completed">
          <ExternalLink
            :href="decodeURIComponent(data.success)"
            class="text-green-600"
          >
            {{ data.filename }}
          </ExternalLink>
        </template>
        <template v-else-if="col.field === 'wikitext'">
          <pre class="text-xs">{{ data[col.field] }}</pre>
        </template>
        <template v-else>
          {{ data[col.field] }}
        </template>
      </template>
    </SharedDataTable>
  </div>
</template>
