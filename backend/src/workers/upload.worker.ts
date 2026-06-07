import { config } from '@backend/config'
import { decryptAccessToken } from '@backend/core/crypto'
import {
  DuplicateUploadError,
  HashLockError,
  SourceCdnError,
  StorageError,
} from '@backend/core/errors'
import { logger } from '@backend/core/logger'
import type { RateLimitInfo } from '@backend/core/rateLimiter'
import { getNextUploadDelay as defaultGetNextUploadDelay } from '@backend/core/rateLimiter'
import { lazyDb } from '@backend/db/client'
import { UploadService } from '@backend/db/dal/uploads'
import { MapillaryHandler } from '@backend/handlers/mapillary'
import { MediaWikiClient } from '@backend/mediawiki/client'
import {
  buildStatementsFromMapillaryImage,
  computeLabelsDelta,
  mergeSdcStatements,
} from '@backend/mediawiki/sdc'
import {
  enqueueUpload as defaultEnqueueUpload,
  removeUploadJob as defaultRemoveUploadJob,
  type UploadJobData,
} from '@backend/workers/queue'
import { Worker } from 'bullmq'
import type { Redis } from 'ioredis'

const buildEditSummary = (imageKey: string, batchId: number, editGroupId: string) =>
  `Uploaded via Curator from Mapillary image ${imageKey} (batch ${batchId}) ([[:toolforge:editgroups-commons/b/curator/${editGroupId}|details]])`

const MAX_STORAGE_REQUEUE_COUNT = 5

export type WorkerDeps = {
  makeClient?: (token: [string, string]) => MediaWikiClient
  makeHandler?: () => MapillaryHandler
  decryptToken?: (cipher: string) => [string, string]
  enqueueUpload?: (data: UploadJobData, delayMs: number) => Promise<string>
  removeUploadJob?: (jobId: string) => Promise<void>
  getNextUploadDelay?: (userid: string, rateLimit: RateLimitInfo, redis: Redis) => Promise<number>
}

export function createUploadWorker(redis: Redis, deps?: WorkerDeps): Worker<UploadJobData> {
  const uploads = new UploadService(lazyDb.client)
  const makeClient = deps?.makeClient ?? ((token) => new MediaWikiClient(token))
  const makeHandler = deps?.makeHandler ?? (() => new MapillaryHandler())
  const decryptTokenFn = deps?.decryptToken ?? decryptAccessToken
  const enqueueUploadFn = deps?.enqueueUpload ?? defaultEnqueueUpload
  const removeUploadJobFn = deps?.removeUploadJob ?? defaultRemoveUploadJob
  const getNextUploadDelayFn = deps?.getNextUploadDelay ?? defaultGetNextUploadDelay

  const worker = new Worker<UploadJobData>(
    'uploads',
    async (job) => {
      const { uploadId, batchId, editGroupId } = job.data
      logger.info(`[worker] [${uploadId}/${batchId}] task started (job: ${job.id})`)

      const upload = await uploads.getUploadById(uploadId)
      if (!upload) {
        logger.error(
          { uploadId, batchId },
          `[worker] [${uploadId}/${batchId}] upload not found, skipping`,
        )
        return
      }

      if (upload.status === 'cancelled') {
        logger.info(`[worker] [${uploadId}/${batchId}] skipping cancelled upload`)
        return
      }

      if (!upload.access_token) {
        logger.warn(`[worker] [${uploadId}/${batchId}] no access token, marking failed`)
        await uploads.updateUploadStatus(uploadId, 'failed', {
          type: 'error',
          message: 'Your session has expired. Please log in and retry.',
        })
        return
      }

      let accessToken: [string, string]
      try {
        accessToken = decryptTokenFn(upload.access_token)
      } catch {
        logger.warn(`[worker] [${uploadId}/${batchId}] failed to decrypt token, marking failed`)
        await uploads.updateUploadStatus(uploadId, 'failed', {
          type: 'error',
          message: 'Your session has expired. Please log in and retry.',
        })
        return
      }

      const mw = makeClient(accessToken)

      const { blacklisted, reason } = await mw.checkTitleBlacklisted(upload.filename)
      if (blacklisted) {
        logger.warn(
          `[worker] [${uploadId}/${batchId}] title blacklisted: ${upload.filename} — ${reason}`,
        )
        await uploads.updateUploadStatus(uploadId, 'failed', {
          type: 'title_blacklisted',
          message: reason,
        })
        await uploads.clearUploadAccessToken(uploadId)
        return
      }

      const handler = makeHandler()
      logger.info(`[worker] [${uploadId}/${batchId}] fetching image ${upload.key} from mapillary`)
      const images = await handler.fetchImagesBatch([upload.key], upload.collection ?? upload.key)
      const image = images.find((i) => i.id === upload.key)

      if (!image) {
        logger.warn(
          `[worker] [${uploadId}/${batchId}] image ${upload.key} not found in mapillary, will retry`,
        )
        throw new Error(`Image ${upload.key} not found in Mapillary — will retry`)
      }

      logger.info(`[worker] [${uploadId}/${batchId}] starting upload: ${upload.filename}`)
      await uploads.updateUploadStatus(uploadId, 'in_progress')

      const summary = buildEditSummary(upload.key, batchId, editGroupId)

      try {
        const fileUrl = await mw.uploadFile(
          upload.filename,
          image.urls.original,
          upload.wikitext,
          summary,
          redis,
          uploadId,
          batchId,
        )

        const claims = buildStatementsFromMapillaryImage(image, !upload.copyright_override)
        const labels = upload.labels as { language: string; value: string } | null
        const labelsPayload = labels
          ? { [labels.language]: { language: labels.language, value: labels.value } }
          : null
        logger.info(`[worker] [${uploadId}/${batchId}] applying sdc`)
        await mw.applySdc(upload.filename, claims, labelsPayload, summary)

        logger.info(`[worker] [${uploadId}/${batchId}] uploaded to ${fileUrl}`)
        await uploads.updateUploadStatus(uploadId, 'completed', null, fileUrl)
        await uploads.clearUploadAccessToken(uploadId)
        logger.info(`[worker] [${uploadId}/${batchId}] task completed (job: ${job.id})`)
        try {
          await mw.nullEdit(upload.filename)
        } catch (e) {
          logger.warn({ uploadId, err: e }, '[worker] null edit failed after upload')
        }
      } catch (err) {
        if (err instanceof DuplicateUploadError) {
          logger.info(`[worker] [${uploadId}/${batchId}] duplicate upload detected`)
          const links = err.duplicates

          if (links.length > 0) {
            const dupeFilename = links[0]!.title.replace(/^File:/, '')
            const newClaims = buildStatementsFromMapillaryImage(image, !upload.copyright_override)
            const labels = upload.labels as { language: string; value: string } | null
            const labelsPayload = labels
              ? { [labels.language]: { language: labels.language, value: labels.value } }
              : null

            const existingSdc = await mw.fetchSdc(dupeFilename)
            const claimsDelta = existingSdc
              ? mergeSdcStatements(existingSdc.claims, newClaims)
              : newClaims
            const labelsDelta = computeLabelsDelta(existingSdc?.labels, labelsPayload)

            if (claimsDelta.length === 0 && !labelsDelta) {
              logger.info(
                `[worker] [${uploadId}/${batchId}] sdc already up to date on ${dupeFilename}`,
              )
              await uploads.updateUploadStatus(uploadId, 'duplicated_sdc_not_updated', {
                type: 'duplicated_sdc_not_updated',
                links,
                message: 'File already exists on Commons. SDC is already up to date.',
              })
            } else {
              try {
                await mw.applySdc(
                  dupeFilename,
                  claimsDelta.length > 0 ? claimsDelta : null,
                  labelsDelta,
                  summary,
                )
                await uploads.updateUploadStatus(uploadId, 'duplicated_sdc_updated', {
                  type: 'duplicated_sdc_updated',
                  links,
                  message: 'File already exists on Commons. SDC updated.',
                })
                try {
                  await mw.nullEdit(dupeFilename)
                } catch (e) {
                  logger.warn(
                    { uploadId, err: e },
                    '[worker] null edit failed after duplicate sdc update',
                  )
                }
              } catch (e) {
                logger.warn(
                  { uploadId, batchId, err: e },
                  '[worker] sdc update failed on duplicate',
                )
                await uploads.updateUploadStatus(uploadId, 'duplicated_sdc_not_updated', {
                  type: 'duplicated_sdc_not_updated',
                  links,
                  message: 'File already exists on Commons. SDC could not be updated.',
                })
              }
            }
          } else {
            logger.info(`[worker] [${uploadId}/${batchId}] duplicate, no existing file links`)
            await uploads.updateUploadStatus(uploadId, 'duplicate', {
              type: 'duplicate',
              links: [],
              message: 'File already exists on Commons.',
            })
          }

          await uploads.clearUploadAccessToken(uploadId)
          logger.info(`[worker] [${uploadId}/${batchId}] task completed (job: ${job.id})`)
          return
        }

        if (
          err instanceof HashLockError ||
          err instanceof StorageError ||
          err instanceof SourceCdnError
        ) {
          throw err
        }

        const message = err instanceof Error ? err.message : 'Unknown error'
        logger.error({ uploadId, batchId, err }, '[worker] upload failed')
        await uploads.updateUploadStatus(uploadId, 'failed', { type: 'error', message })
        await uploads.clearUploadAccessToken(uploadId)
      }
    },
    {
      connection: { url: config.redisUrl },
      concurrency: Number(config.workerConcurrency),
      prefix: '{bull}',
    },
  )

  worker.on('failed', async (job, err) => {
    const uploadId = job?.data.uploadId
    const batchId = job?.data.batchId
    if (!job) return
    // BullMQ fires 'failed' on every attempt, not just the final one.
    // For errors that rely on BullMQ's built-in retry (not StorageError's custom requeue),
    // skip DB updates on intermediate attempts — the access token must stay intact for retries.
    if (!(err instanceof StorageError) && job.attemptsMade < (job.opts.attempts ?? 1)) {
      logger.warn(
        { jobId: job.id, err },
        `[worker] [${uploadId}/${batchId}] job attempt failed, will retry`,
      )
      return
    }
    logger.error({ jobId: job.id, err }, `[worker] [${uploadId}/${batchId}] job permanently failed`)
    try {
      if (err instanceof StorageError) {
        const count = job.data.requeueCount ?? 0
        if (count >= MAX_STORAGE_REQUEUE_COUNT) {
          logger.warn(
            `[worker] [${uploadId}/${batchId}] StorageError requeue limit reached (${count}), marking failed`,
          )
        } else {
          await uploads.updateUploadStatus(job.data.uploadId, 'queued')
          await removeUploadJobFn(job.id!)
          const delay = await getNextUploadDelayFn(job.data.userid, job.data.rateLimit, redis)
          logger.info(
            `[worker] [${uploadId}/${batchId}] requeuing after StorageError (attempt ${count + 1}/${MAX_STORAGE_REQUEUE_COUNT}, delay: ${delay}ms)`,
          )
          await enqueueUploadFn({ ...job.data, requeueCount: count + 1 }, delay)
          return
        }
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      await uploads.updateUploadStatus(job.data.uploadId, 'failed', { type: 'error', message })
      await uploads.clearUploadAccessToken(job.data.uploadId)
    } catch (dbErr) {
      logger.error(
        { jobId: job.id, err: dbErr },
        `[worker] [${uploadId}/${batchId}] failed to update db status after job failure`,
      )
    }
  })

  return worker
}
