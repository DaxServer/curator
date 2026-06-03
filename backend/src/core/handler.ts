import { config } from '@backend/config'
import type { WsSender } from '@backend/core/batchStreamer'
import { OptimizedBatchStreamer, STREAM_INTERVAL_MS, nonce } from '@backend/core/batchStreamer'
import { encryptAccessToken } from '@backend/core/crypto'
import { getNextUploadDelay, getRateLimitForBatch } from '@backend/core/rateLimiter'
import type { SessionUser } from '@backend/core/session'
import type { BatchService } from '@backend/db/dal/batches'
import type { PresetService } from '@backend/db/dal/presets'
import type { UploadRow, UploadService } from '@backend/db/dal/uploads'
import type { UserService } from '@backend/db/dal/users'
import { MapillaryHandler } from '@backend/handlers/mapillary'
import { logger } from '@backend/logger'
import { MediaWikiClient } from '@backend/mediawiki/client'
import { WikidataClient } from '@backend/mediawiki/wikidata'
import type {
  BatchUploadItem,
  PresetItem,
  UploadItem,
  UploadUpdateItem,
  Handler as WsHandler,
} from '@backend/types/ws'
import { enqueueUpload, removeUploadJob } from '@backend/workers/queue'
import type { Redis } from 'ioredis'

const UPLOAD_DONE_STATUSES = new Set([
  'completed',
  'failed',
  'duplicate',
  'duplicated_sdc_updated',
  'duplicated_sdc_not_updated',
])

const BATCH_RETRIEVAL_CHUNK_SIZE = 100

type SessionUserWithAuth = SessionUser & {
  access_token: [string, string]
}

export type Services = {
  batches: BatchService
  uploads: UploadService
  presets: PresetService
  users: UserService
}

export type RateLimiterFns = {
  getRateLimitForBatch: typeof getRateLimitForBatch
  getNextUploadDelay: typeof getNextUploadDelay
}

function presetRowToItem(p: {
  id: number
  title: string
  title_template: string
  labels: unknown
  categories: string | null
  exclude_from_date_category: boolean
  handler: string
  is_default: boolean
  created_at: Date
  updated_at: Date
}): PresetItem {
  return {
    id: p.id,
    title: p.title,
    title_template: p.title_template,
    labels: (typeof p.labels === 'string'
      ? JSON.parse(p.labels)
      : p.labels) as PresetItem['labels'],
    categories: p.categories ?? '',
    exclude_from_date_category: p.exclude_from_date_category,
    handler: p.handler as WsHandler,
    is_default: p.is_default,
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  }
}

function toUploadUpdateItem(u: UploadRow): UploadUpdateItem {
  return {
    id: u.id,
    batchid: u.batchid,
    status: u.status as UploadUpdateItem['status'],
    key: u.key,
    handler: u.handler as UploadUpdateItem['handler'],
    error: u.error as UploadUpdateItem['error'],
    success: u.success,
  }
}

export class Handler {
  private user: SessionUserWithAuth
  private username: string
  private userid: string
  private sender: WsSender
  private redis: Redis
  private services: Services
  private uploadsInterval: ReturnType<typeof setTimeout> | null = null
  private batchesListInterval: ReturnType<typeof setInterval> | null = null
  private batchStreamer: OptimizedBatchStreamer
  private rateLimiter: RateLimiterFns

  constructor(
    user: SessionUserWithAuth,
    sender: WsSender,
    redis: Redis,
    services: Services,
    rateLimiter?: RateLimiterFns,
  ) {
    this.user = user
    this.username = user.username
    this.userid = user.sub
    this.sender = sender
    this.redis = redis
    this.services = services
    this.batchStreamer = new OptimizedBatchStreamer(sender, this.username, services.batches)
    this.rateLimiter = rateLimiter ?? { getRateLimitForBatch, getNextUploadDelay }
  }

  cancelTasks(): void {
    if (this.uploadsInterval) {
      clearTimeout(this.uploadsInterval)
      this.uploadsInterval = null
    }
    if (this.batchesListInterval) {
      clearInterval(this.batchesListInterval)
      this.batchesListInterval = null
    }
    this.batchStreamer.stopStreaming()
  }

  private sendError(message: string): void {
    this.sender.send({ type: 'ERROR', data: message, nonce: nonce() })
  }

  private async safe(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn()
    } catch (e) {
      logger.error({ name, username: this.username, err: e }, 'Handler error')
      this.sendError('Internal server error — please notify User:DaxServer')
    }
  }

  async fetchBatches(data: {
    page: number
    limit: number
    userid?: string
    filter?: string
  }): Promise<void> {
    await this.safe('fetchBatches', async () => {
      this.batchStreamer.stopStreaming()
      this.batchStreamer = new OptimizedBatchStreamer(
        this.sender,
        this.username,
        this.services.batches,
      )
      await this.batchStreamer.startStreaming(data.userid, data.filter, data.page, data.limit)
    })
  }

  async fetchBatchUploads(batchid: number): Promise<void> {
    await this.safe('fetchBatchUploads', async () => {
      const batch = await this.services.batches.getBatch(batchid)
      if (!batch) {
        this.sendError(`Batch ${batchid} not found`)
        return
      }
      const uploads = await this.services.uploads.getUploadsByBatch(batchid)
      logger.info(
        `[ws] [resp] Sending batch ${batchid} and ${uploads.length} uploads for ${this.username}`,
      )
      this.sender.send({
        type: 'BATCH_UPLOADS_LIST',
        data: {
          batch: { ...batch, username: batch.username ?? '' },
          uploads: uploads.map((u) => ({
            id: u.id,
            batchid: u.batchid,
            userid: u.userid,
            status: u.status as BatchUploadItem['status'],
            key: u.key,
            handler: u.handler as BatchUploadItem['handler'],
            filename: u.filename,
            wikitext: u.wikitext,
            labels: u.labels as BatchUploadItem['labels'],
            result: u.result,
            error: u.error as BatchUploadItem['error'],
            success: u.success,
            created_at: u.created_at.toISOString(),
            updated_at: u.updated_at.toISOString(),
          })),
        },
        nonce: nonce(),
      })
    })
  }

  async retryUploads(batchid: number): Promise<void> {
    await this.safe('retryUploads', async () => {
      const encryptedAccessToken = encryptAccessToken(this.user.access_token)
      const all = await this.services.uploads.getUploadsByBatch(batchid)
      const failedIds = all.filter((u) => u.status === 'failed').map((u) => u.id)
      if (failedIds.length === 0) {
        logger.info(
          `[ws] [resp] No failed uploads to retry for batch ${batchid} for ${this.username}`,
        )
        this.sendError('No failed uploads to retry')
        return
      }
      const { newUploadIds, editGroupId, newBatchId } =
        await this.services.uploads.retrySelectedUploadsToNewBatch(
          failedIds,
          encryptedAccessToken,
          this.userid,
          this.username,
        )
      if (newUploadIds.length === 0 || !editGroupId) {
        logger.info(
          `[ws] [resp] No failed uploads to retry for batch ${batchid} for ${this.username}`,
        )
        this.sendError('No failed uploads to retry')
        return
      }
      const mwRetry = new MediaWikiClient(this.user.access_token)
      const rateLimitRetry = await this.rateLimiter.getRateLimitForBatch(this.userid, mwRetry)
      for (const uploadId of newUploadIds) {
        const delayMs = await this.rateLimiter.getNextUploadDelay(
          this.userid,
          rateLimitRetry,
          this.redis,
        )
        const jobId = await enqueueUpload(
          { uploadId, batchId: newBatchId, editGroupId, userid: this.userid },
          delayMs,
        )
        await this.services.uploads.updateJobTaskId(uploadId, jobId)
      }
      logger.info(
        `[ws] [resp] Retried ${newUploadIds.length} uploads for batch ${batchid} for ${this.username}`,
      )
      this.sender.send({
        type: 'RETRY_UPLOADS_RESPONSE',
        data: newBatchId,
        nonce: nonce(),
      })
    })
  }

  async cancelBatch(batchid: number): Promise<void> {
    await this.safe('cancelBatch', async () => {
      const isAdmin = this.username === config.xUsername
      const userid = isAdmin ? undefined : this.userid
      let cancelled: Map<number, string | null>
      try {
        cancelled = await this.services.uploads.cancelBatch(batchid, userid)
      } catch (e) {
        const msg = (e as Error).message
        if (msg.includes('not found')) {
          this.sendError(`Batch ${batchid} not found`)
          return
        }
        if (msg.includes('Permission')) {
          this.sendError('Permission denied')
          return
        }
        throw e
      }
      if (cancelled.size === 0) {
        logger.info(
          `[ws] [resp] No queued items to cancel for batch ${batchid} for ${this.username}`,
        )
        this.sendError('No queued items to cancel')
        return
      }
      logger.info(
        `[ws] [resp] Cancelled ${cancelled.size} uploads for batch ${batchid} for ${this.username}`,
      )
      await Promise.all(
        [...cancelled.values()]
          .filter((taskId): taskId is string => !!taskId)
          .map((taskId) => removeUploadJob(taskId)),
      )
    })
  }

  async subscribeBatch(batchid: number): Promise<void> {
    await this.safe('subscribeBatch', async () => {
      if (this.uploadsInterval) clearTimeout(this.uploadsInterval)
      this.uploadsInterval = this.startUploadStream(batchid)
      logger.info(`[ws] [resp] Subscribed to batch ${batchid} for ${this.username}`)
      this.sender.send({ type: 'SUBSCRIBED', data: batchid, nonce: nonce() })
    })
  }

  async unsubscribeBatch(): Promise<void> {
    if (this.uploadsInterval) {
      clearTimeout(this.uploadsInterval)
      this.uploadsInterval = null
    }
    logger.info(`[ws] [resp] Unsubscribed from batch updates for ${this.username}`)
  }

  async subscribeBatchesList(data: { userid?: string; filter?: string }): Promise<void> {
    await this.safe('subscribeBatchesList', async () => {
      this.batchStreamer.stopStreaming()
      this.batchStreamer = new OptimizedBatchStreamer(
        this.sender,
        this.username,
        this.services.batches,
      )
      await this.batchStreamer.startStreaming(data.userid, data.filter, 1, 100)
    })
  }

  async unsubscribeBatchesList(): Promise<void> {
    this.batchStreamer.stopStreaming()
    logger.info(`[ws] [resp] Unsubscribed from batches list for ${this.username}`)
  }

  async createBatch(): Promise<void> {
    await this.safe('createBatch', async () => {
      await this.services.users.ensureUser(this.userid, this.username)
      const batch = await this.services.batches.createBatch(this.userid, this.username)
      logger.info(`[ws] [resp] Batch ${batch.id} created for ${this.username}`)
      this.sender.send({ type: 'BATCH_CREATED', data: batch.id, nonce: nonce() })
    })
  }

  async deletePreset(presetId: number): Promise<void> {
    await this.safe('deletePreset', async () => {
      const ok = await this.services.presets.deletePreset(presetId, this.userid)
      if (!ok) {
        this.sendError('Preset not found or permission denied')
        return
      }
      logger.info(`[ws] [resp] Deleted preset ${presetId} for ${this.username}`)
      await this.fetchPresets('mapillary')
    })
  }

  async fetchImages(collection: string, _handlerType: 'mapillary'): Promise<void> {
    await this.safe('fetchImages', async () => {
      const handler = new MapillaryHandler()
      try {
        const { images, sequenceId } = await handler.fetchCollection(collection)
        if (images.length === 0) {
          this.sendError('Collection not found')
          return
        }
        logger.info(
          `[mapillary] Found ${images.length} images in collection ${collection} for ${this.username}`,
        )
        try {
          const existingPages = await handler.fetchExistingPages(images.map((i) => i.id))
          for (const img of images) {
            const pages = existingPages[img.id]
            if (pages) img.existing = pages
          }
        } catch (e) {
          logger.warn({ collection, err: e }, 'WCQS existing pages fetch failed')
        }
        const first = images[0]!
        this.sender.send({
          type: 'COLLECTION_IMAGES',
          data: { images, creator: first.creator, sequence_id: sequenceId },
          nonce: nonce(),
        })
      } catch (e) {
        const msg = (e as Error).message
        if (msg.includes('timeout') || msg.includes('500') || msg.includes('aborted')) {
          await this.fetchImagesInBatches(collection, handler)
          return
        }
        logger.error({ collection, err: e }, 'API error')
        this.sendError(`Mapillary API Error: ${msg}`)
      }
    })
  }

  private async fetchImagesInBatches(collection: string, handler: MapillaryHandler): Promise<void> {
    logger.warn(
      `[mapillary] Attempting batch retrieval for ${collection} for ${this.username}`,
    )
    this.sender.send({
      type: 'TRY_BATCH_RETRIEVAL',
      data: 'Large collection detected. Loading in batches...',
      nonce: nonce(),
    })
    try {
      const ids = await handler.fetchCollectionIds(collection)
      if (ids.length === 0) {
        this.sendError('Collection has no images')
        return
      }
      logger.info(
        `[mapillary] Found ${ids.length} images in collection ${collection} for ${this.username}`,
      )
      this.sender.send({ type: 'COLLECTION_IMAGE_IDS', data: ids, nonce: nonce() })
      for (let i = 0; i < ids.length; i += BATCH_RETRIEVAL_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + BATCH_RETRIEVAL_CHUNK_SIZE)
        const batchImages = await handler.fetchImagesBatch(chunk, collection)
        try {
          const existingPages = await handler.fetchExistingPages(batchImages.map((i) => i.id))
          for (const img of batchImages) {
            const pages = existingPages[img.id]
            if (pages) img.existing = pages
          }
        } catch (e) {
          logger.warn({ collection, err: e }, 'WCQS existing pages fetch failed')
        }
        this.sender.send({
          type: 'PARTIAL_COLLECTION_IMAGES',
          data: { images: batchImages, collection },
          nonce: nonce(),
        })
      }
    } catch (e) {
      logger.error({ collection, err: e }, 'Batch retrieval failed')
      this.sendError(`Batch retrieval failed: ${(e as Error).message}`)
    }
  }

  async fetchPresets(handlerType: 'mapillary'): Promise<void> {
    await this.safe('fetchPresets', async () => {
      const rows = await this.services.presets.getPresetsForHandler(this.userid, handlerType)
      logger.info(
        `[ws] [resp] Sending ${rows.length} presets for ${this.username} handler=${handlerType}`,
      )
      this.sender.send({
        type: 'PRESETS_LIST',
        data: {
          handler: handlerType,
          presets: rows.map(presetRowToItem),
        },
        nonce: nonce(),
      })
    })
  }

  async savePreset(data: {
    preset_id?: number
    title: string
    title_template: string
    labels?: PresetItem['labels'] | null
    categories: string
    exclude_from_date_category?: boolean
    is_default?: boolean
    handler: string
  }): Promise<void> {
    await this.safe('savePreset', async () => {
      if (data.preset_id) {
        const updated = await this.services.presets.updatePreset(data.preset_id, this.userid, {
          title: data.title,
          title_template: data.title_template,
          labels: data.labels,
          categories: data.categories,
          exclude_from_date_category: data.exclude_from_date_category,
          is_default: data.is_default,
        })
        if (!updated) {
          this.sendError('Preset not found or permission denied')
          return
        }
      } else {
        await this.services.presets.createPreset({
          userid: this.userid,
          handler: data.handler,
          title: data.title,
          title_template: data.title_template,
          labels: data.labels,
          categories: data.categories,
          exclude_from_date_category: data.exclude_from_date_category,
          is_default: data.is_default,
        })
      }
      await this.fetchPresets(data.handler as 'mapillary')
    })
  }

  async uploadSlice(data: {
    batchid: number
    sliceid: number
    items: UploadItem[]
    handler?: WsHandler
  }): Promise<void> {
    await this.safe('uploadSlice', async () => {
      logger.info(
        `[ws] Creating upload slice ${data.sliceid} with ${data.items.length} items for ${this.username} in batch ${data.batchid}`,
      )
      const batch = await this.services.batches.getBatch(data.batchid)
      if (!batch) {
        this.sendError(`Batch ${data.batchid} not found`)
        return
      }
      if (!batch.edit_group_id) {
        this.sendError(`Batch ${data.batchid} has no edit_group_id`)
        return
      }
      const encryptedAccessToken = encryptAccessToken(this.user.access_token)
      const handlerName = data.handler ?? 'mapillary'
      const created = await this.services.uploads.createUploadRequestsForBatch({
        userid: this.userid,
        username: this.username,
        batchid: data.batchid,
        items: data.items,
        handler: handlerName,
        encryptedAccessToken,
      })
      if (created.length > 0) {
        const mw = new MediaWikiClient(this.user.access_token)
        const rateLimit = await this.rateLimiter.getRateLimitForBatch(this.userid, mw)
        for (const c of created) {
          const delayMs = await this.rateLimiter.getNextUploadDelay(
            this.userid,
            rateLimit,
            this.redis,
          )
          const jobId = await enqueueUpload(
            {
              uploadId: c.id,
              batchId: data.batchid,
              editGroupId: batch.edit_group_id!,
              userid: this.userid,
            },
            delayMs,
          )
          await this.services.uploads.updateJobTaskId(c.id, jobId)
        }
      }
      logger.info(
        `[ws] [resp] Slice ${data.sliceid} of batch ${data.batchid} (${created.length} uploads) enqueued for ${this.username}`,
      )
      this.sender.send({
        type: 'UPLOAD_SLICE_ACK',
        data: created.map((c) => ({ id: c.key, status: c.status })),
        sliceid: data.sliceid,
        nonce: nonce(),
      })
    })
  }

  async checkCategoriesDeleted(titles: string[]): Promise<void> {
    await this.safe('checkCategoriesDeleted', async () => {
      const mw = new MediaWikiClient(this.user.access_token)
      const results = await Promise.all(titles.map((t) => mw.isCategoryDeleted(t)))
      const deleted = titles.filter((_, i) => results[i])
      if (deleted.length > 0) {
        logger.info(
          `[ws] [resp] Categories ${deleted.join(', ')} are deleted for ${this.username}`,
        )
        this.sender.send({
          type: 'CATEGORIES_DELETED_RESPONSE',
          data: { deleted },
          nonce: nonce(),
        })
      }
    })
  }

  async createCategory(title: string, text: string, wikidataQid?: string): Promise<void> {
    await this.safe('createCategory', async () => {
      const mw = new MediaWikiClient(this.user.access_token)
      let createdTitle: string
      try {
        createdTitle = await mw.createPage(`Category:${title}`, text)
      } catch (e) {
        this.sendError((e as Error).message)
        return
      }
      const normalized = createdTitle.replace(/ /g, '_')
      logger.info(`[ws] [resp] Created category ${createdTitle} for ${this.username}`)
      this.sender.send({
        type: 'CATEGORY_CREATED_RESPONSE',
        data: { title: normalized },
        nonce: nonce(),
      })
      if (wikidataQid) {
        try {
          const wd = new WikidataClient(this.user.access_token)
          await wd.addCommonsCategory(wikidataQid, title)
          logger.info(`[ws] Added P373 and sitelink for ${wikidataQid} → Category:${title}`)
        } catch (e) {
          logger.error({ wikidataQid, err: e }, 'Wikidata edit failed')
        }
      }
    })
  }

  async recategorizeFiles(source: string, target: string): Promise<void> {
    await this.safe('recategorizeFiles', async () => {
      const mw = new MediaWikiClient(this.user.access_token)
      const titles = await mw.getCategoryMembers(source)
      let count = 0
      for (const t of titles) {
        const replaced = await mw.replaceCategoryInPage(t, source, target)
        if (replaced) count++
      }
      logger.info(
        `[ws] [resp] Recategorized ${count}/${titles.length} files from [[Category:${source}]] to [[Category:${target}]] for ${this.username}`,
      )
      this.sender.send({
        type: 'RECATEGORIZE_FILES_RESPONSE',
        data: { source, count },
        nonce: nonce(),
      })
    })
  }

  private startUploadStream(batchid: number): ReturnType<typeof setTimeout> {
    let lastSerialized: string | null = null
    const poll = async () => {
      try {
        const items = await this.services.uploads.getUploadsByBatch(batchid)
        const updateItems = items.map(toUploadUpdateItem)
        const serialized = JSON.stringify(updateItems)
        if (serialized !== lastSerialized) {
          this.sender.send({
            type: 'UPLOADS_UPDATE',
            data: updateItems,
            nonce: nonce(),
          })
          lastSerialized = serialized
        }
        const total = await this.services.batches.countUploadsInBatch(batchid)
        const completed = items.filter((i) => UPLOAD_DONE_STATUSES.has(i.status)).length
        if (total > 0 && completed >= total) {
          this.sender.send({
            type: 'UPLOADS_COMPLETE',
            data: batchid,
            nonce: nonce(),
          })
          if (this.uploadsInterval) {
            clearTimeout(this.uploadsInterval)
            this.uploadsInterval = null
          }
          return
        }
      } catch (e) {
        logger.error({ batchid, err: e }, 'Upload stream error')
      }
      this.uploadsInterval = setTimeout(poll, STREAM_INTERVAL_MS)
    }
    return setTimeout(poll, 0)
  }
}
