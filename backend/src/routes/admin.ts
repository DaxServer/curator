import { config } from '@backend/config'
import { encryptAccessToken } from '@backend/core/crypto'
import { logger } from '@backend/core/logger'
import { RATE_LIMIT_DEFAULT } from '@backend/core/rateLimiter'
import { sessionPlugin } from '@backend/core/session'
import { dbPlugin } from '@backend/db/plugin'
import { enqueueUpload } from '@backend/workers/queue'
import Elysia, { t } from 'elysia'

const requireAdmin = new Elysia({ name: 'require-admin' })
  .use(sessionPlugin)
  .derive({ as: 'scoped' }, ({ session }) => {
    if (!session.user) {
      throw new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (session.user.username !== config.xUsername) {
      throw new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
    return { user: session.user }
  })

export const adminRoutes = new Elysia({ name: 'admin-routes', prefix: '/api/admin' })
  .use(dbPlugin)
  .use(requireAdmin)

  .get(
    '/batches',
    async ({ batches, query }) => {
      const offset = ((query.page ?? 1) - 1) * (query.limit ?? 100)
      const [items, total] = await Promise.all([
        batches.getBatches({ offset, limit: query.limit ?? 100, filterText: query.filter_text }),
        batches.countBatches({ filterText: query.filter_text }),
      ])
      return { items, total }
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        filter_text: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/users',
    async ({ users, query }) => {
      const offset = ((query.page ?? 1) - 1) * (query.limit ?? 100)
      const [items, total] = await Promise.all([
        users.getUsers({ offset, limit: query.limit ?? 100, filterText: query.filter_text }),
        users.countUsers({ filterText: query.filter_text }),
      ])
      return { items, total }
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        filter_text: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/upload_requests',
    async ({ uploads, query }) => {
      const offset = ((query.page ?? 1) - 1) * (query.limit ?? 100)
      const statuses = query.status
        ? Array.isArray(query.status)
          ? query.status
          : [query.status]
        : undefined
      const dateFrom = query.date_from ? new Date(query.date_from) : undefined
      const dateTo = query.date_to ? new Date(query.date_to) : undefined
      const [items, total] = await Promise.all([
        uploads.getAllUploadRequests({
          offset,
          limit: query.limit ?? 100,
          filterText: query.filter_text,
          statuses,
          dateFrom,
          dateTo,
        }),
        uploads.countAllUploadRequests({
          filterText: query.filter_text,
          statuses,
          dateFrom,
          dateTo,
        }),
      ])
      return { items, total }
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        filter_text: t.Optional(t.String()),
        status: t.Optional(t.Union([t.String(), t.Array(t.String())])),
        date_from: t.Optional(t.String()),
        date_to: t.Optional(t.String()),
      }),
    },
  )

  .post(
    '/upload_requests/bulk-cancel',
    async ({ uploads, body, user }) => {
      const cancelled_count = await uploads.cancelUploadRequests(body.ids)
      logger.info(
        `[admin] ${user.username} bulk-cancelled ${cancelled_count} uploads (ids: ${body.ids.join(', ')})`,
      )
      return { cancelled_count }
    },
    { body: t.Object({ ids: t.Array(t.Number()) }) },
  )

  .post(
    '/upload_requests/bulk-fail',
    async ({ uploads, body, user }) => {
      const failed_count = await uploads.failUploadRequests(body.ids)
      logger.info(
        `[admin] ${user.username} bulk-failed ${failed_count} uploads (ids: ${body.ids.join(', ')})`,
      )
      return { failed_count }
    },
    { body: t.Object({ ids: t.Array(t.Number()) }) },
  )

  .get(
    '/presets',
    async ({ presets, query }) => {
      const offset = ((query.page ?? 1) - 1) * (query.limit ?? 100)
      const [items, total] = await Promise.all([
        presets.getAllPresets({ offset, limit: query.limit ?? 100, filterText: query.filter_text }),
        presets.countAllPresets({ filterText: query.filter_text }),
      ])
      return { items, total }
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        filter_text: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/failed_uploads',
    async ({ uploads, query }) => {
      const offset = ((query.page ?? 1) - 1) * (query.limit ?? 50)
      return uploads.getFailedUploadsGrouped({
        offset,
        limit: query.limit ?? 50,
        sortBy: query.sort_by as 'recent' | 'batchSize' | 'errorType' | 'user' | undefined,
        errorType: query.error_type,
        handler: query.handler,
        searchText: query.search_text,
      })
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric()),
        limit: t.Optional(t.Numeric()),
        sort_by: t.Optional(t.String()),
        error_type: t.Optional(t.String()),
        handler: t.Optional(t.String()),
        search_text: t.Optional(t.String()),
      }),
    },
  )

  .put(
    '/upload_requests/:id',
    async ({ uploads, params, body, set }) => {
      const ok = await uploads.updateUploadFields(Number(params.id), body)
      if (!ok) {
        set.status = 404
        return { message: 'Not found' }
      }
      return { message: 'Upload request updated successfully' }
    },
    {
      body: t.Object({
        status: t.Optional(t.String()),
        error: t.Optional(t.Any()),
      }),
    },
  )

  .post(
    '/retry',
    async ({ uploads, body, session, set }) => {
      const tokenPair = session.access_token
      if (!tokenPair) {
        set.status = 401
        return { message: 'No access token in session' }
      }
      const encryptedToken = encryptAccessToken(tokenPair)
      const { newUploadIds, editGroupId, newBatchId } =
        await uploads.retrySelectedUploadsToNewBatch(
          body.upload_ids,
          encryptedToken,
          session.user!.sub,
          session.user!.username,
        )
      let enqueuedCount = 0
      if (newUploadIds.length > 0 && editGroupId) {
        const results = await Promise.allSettled(
          newUploadIds.map((uploadId, i) =>
            enqueueUpload(
              {
                uploadId,
                batchId: newBatchId,
                editGroupId,
                userid: session.user!.sub,
                rateLimit: RATE_LIMIT_DEFAULT,
              },
              i * 1000,
            ).then(async (jobId) => {
              await uploads.updateJobTaskId(uploadId, jobId)
            }),
          ),
        )
        enqueuedCount = results.filter((r) => r.status === 'fulfilled').length
      }
      logger.info(
        `[admin] ${session.user!.username} retry: ${newUploadIds.length} uploads enqueued in batch ${newBatchId} (${enqueuedCount}/${newUploadIds.length} queued)`,
      )
      return {
        message: `Retrying ${newUploadIds.length} of ${body.upload_ids.length} requested uploads`,
        retried_count: newUploadIds.length,
        enqueued_count: enqueuedCount,
        requested_count: body.upload_ids.length,
        new_batch_id: newBatchId,
      }
    },
    { body: t.Object({ upload_ids: t.Array(t.Number()) }) },
  )
