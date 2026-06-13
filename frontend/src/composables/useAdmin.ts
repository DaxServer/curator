import { api } from '@frontend/lib/apiClient'
import { useAdminStore } from '@frontend/stores/admin.store'
import type { AdminBatch, AdminPreset, AdminUploadRequest, AdminUser } from '@frontend/types/admin'
import { UPLOAD_STATUS } from '@frontend/types/image'

type PaginatedResult<T> = { items: T[]; total: number }

type UploadRequestsEden = {
  get: (opts: { query: Record<string, unknown> }) => Promise<{ data: unknown; status: number }>
  'bulk-cancel': {
    post: (b: {
      ids: number[]
    }) => Promise<{ data: { cancelled_count: number } | null; status: number }>
  }
  'bulk-fail': {
    post: (b: {
      ids: number[]
    }) => Promise<{ data: { failed_count: number } | null; status: number }>
  }
} & ((p: { id: number }) => { put: (b: Record<string, string>) => Promise<{ status: number }> })

export const useAdmin = () => {
  const store = useAdminStore()

  const uploadRequestsEden = api.api.admin.upload_requests as unknown as UploadRequestsEden

  const updateAdminUploadRequest = async (
    id: number,
    field: string,
    value: string,
  ): Promise<void> => {
    const { status } = await uploadRequestsEden({ id }).put({ [field]: value })
    if (status !== 200) throw new Error('Failed to update upload request')
  }

  const refreshAdminData = async () => {
    const { adminTable, adminParams, adminFilterText } = store
    const page = Math.floor(adminParams.first / adminParams.rows) + 1
    const limit = adminParams.rows

    store.adminLoading = true

    try {
      switch (adminTable) {
        case 'batches': {
          const { data } = await api.api.admin.batches.get({
            query: { page, limit, filter_text: adminFilterText || undefined },
          })
          if (data) {
            const result = data as unknown as PaginatedResult<AdminBatch>
            store.adminBatches = result.items
            store.adminTotal = result.total
          }
          break
        }
        case 'users': {
          const { data } = await api.api.admin.users.get({
            query: { page, limit, filter_text: adminFilterText || undefined },
          })
          if (data) {
            const result = data as unknown as PaginatedResult<AdminUser>
            store.adminUsers = result.items
            store.adminTotal = result.total
          }
          break
        }
        case 'upload_requests': {
          const statusFilter = store.adminStatusFilter.length ? store.adminStatusFilter : undefined
          const [dateFrom, dateTo] = store.adminDateRange ?? [null, null]
          const { data } = await api.api.admin.upload_requests.get({
            query: {
              page,
              limit,
              filter_text: adminFilterText || undefined,
              status: statusFilter,
              date_from: dateFrom?.toISOString().split('T')[0],
              date_to: dateTo?.toISOString().split('T')[0],
            },
          })
          if (data) {
            const result = data as unknown as PaginatedResult<AdminUploadRequest>
            store.adminUploadRequests = result.items
            store.adminTotal = result.total
          }
          break
        }
        case 'presets': {
          const { data } = await api.api.admin.presets.get({
            query: { page, limit, filter_text: adminFilterText || undefined },
          })
          if (data) {
            const result = data as unknown as PaginatedResult<AdminPreset>
            store.adminPresets = result.items
            store.adminTotal = result.total
          }
          break
        }
      }
    } finally {
      store.adminLoading = false
    }
  }

  const cancelSelected = async (): Promise<{ cancelled_count: number }> => {
    const ids = store.selectedUploadRequests
      .filter((r) => r.status === UPLOAD_STATUS.Queued || r.status === UPLOAD_STATUS.InProgress)
      .map((r) => r.id)
    const { data, status } = await uploadRequestsEden['bulk-cancel'].post({ ids })
    if (status !== 200 || !data) throw new Error('Failed to cancel upload requests')
    return data
  }

  const markSelectedAsFailed = async (): Promise<{ failed_count: number }> => {
    const ids = store.selectedUploadRequests
      .filter((r) => r.status !== UPLOAD_STATUS.Failed)
      .map((r) => r.id)
    const { data, status } = await uploadRequestsEden['bulk-fail'].post({ ids })
    if (status !== 200 || !data) throw new Error('Failed to mark upload requests as failed')
    return data
  }

  const clearText = () => {
    store.adminFilterText = ''
    store.selectedUploadRequests = []
  }

  const restartWorker = async (): Promise<void> => {
    const { status } = await api.api.admin['restart-worker'].post({})
    if (status !== 200) throw new Error('Failed to send restart signal')
  }

  const clearAll = () => {
    store.adminFilterText = ''
    store.adminStatusFilter = []
    store.adminDateRange = null
    store.selectedUploadRequests = []
  }

  return {
    updateAdminUploadRequest,
    refreshAdminData,
    cancelSelected,
    markSelectedAsFailed,
    restartWorker,
    clearText,
    clearAll,
  }
}
