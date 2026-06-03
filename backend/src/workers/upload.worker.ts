import { config } from '@backend/config'
import { decryptAccessToken } from '@backend/core/crypto'
import {
  DuplicateUploadError,
  HashLockError,
  SourceCdnError,
  StorageError,
} from '@backend/core/errors'
import { lazyDb } from '@backend/db/client'
import { UploadService } from '@backend/db/dal/uploads'
import { MapillaryHandler } from '@backend/handlers/mapillary'
import { logger } from '@backend/logger'
import { MediaWikiClient } from '@backend/mediawiki/client'
import { buildStatementsFromMapillaryImage } from '@backend/mediawiki/sdc'
import type { UploadJobData } from '@backend/workers/queue'
import { Worker } from 'bullmq'
import type { Redis } from 'ioredis'

const buildEditSummary = (imageKey: string, batchId: number, editGroupId: string) =>
  `Uploaded via Curator from Mapillary image ${imageKey} (batch ${batchId}) ([[:toolforge:editgroups-commons/b/curator/${editGroupId}|details]])`

export function createUploadWorker(redis: Redis): Worker<UploadJobData> {
  const uploads = new UploadService(lazyDb.client)

  const worker = new Worker<UploadJobData>(
    'uploads',
    async (job) => {
      const { uploadId, batchId, editGroupId } = job.data
      logger.info(`[worker] [${uploadId}] [${job.id}] task started`)

      const upload = await uploads.getUploadById(uploadId)
      if (!upload) {
        logger.error({ uploadId }, 'Upload not found, skipping')
        return
      }

      if (upload.status === 'cancelled') return

      if (!upload.access_token) {
        await uploads.updateUploadStatus(uploadId, 'failed', {
          type: 'error',
          message: 'Your session has expired. Please log in and retry.',
        })
        return
      }

      let accessToken: [string, string]
      try {
        accessToken = decryptAccessToken(upload.access_token)
      } catch {
        await uploads.updateUploadStatus(uploadId, 'failed', {
          type: 'error',
          message: 'Your session has expired. Please log in and retry.',
        })
        return
      }

      const mw = new MediaWikiClient(accessToken)

      const { blacklisted, reason } = await mw.checkTitleBlacklisted(upload.filename)
      if (blacklisted) {
        logger.warn(
          `[worker] [${uploadId}/${batchId}] title ${upload.filename} is blacklisted: ${reason}`,
        )
        await uploads.updateUploadStatus(uploadId, 'failed', {
          type: 'title_blacklisted',
          message: reason,
        })
        await uploads.clearUploadAccessToken(uploadId)
        return
      }

      const handler = new MapillaryHandler()
      const images = await handler.fetchImagesBatch([upload.key], upload.collection ?? upload.key)
      const image = images.find((i) => i.id === upload.key)

      if (!image) {
        throw new Error(`Image ${upload.key} not found in Mapillary — will retry`)
      }

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
        await mw.applySdc(upload.filename, claims, labelsPayload, summary)
        await mw.nullEdit(upload.filename)

        logger.info(`[worker] [${uploadId}/${batchId}] successfully uploaded to ${fileUrl}`)
        await uploads.updateUploadStatus(uploadId, 'completed', null, fileUrl)
        await uploads.clearUploadAccessToken(uploadId)
        logger.info(`[worker] [${uploadId}] [${job.id}] task completed`)
      } catch (err) {
        if (err instanceof DuplicateUploadError) {
          logger.info(`[worker] [${uploadId}/${batchId}] duplicate upload detected`)
          const links = err.duplicates

          if (links.length > 0) {
            const dupeFilename = links[0]!.title.replace(/^File:/, '')
            const claims = buildStatementsFromMapillaryImage(image, !upload.copyright_override)
            const labels = upload.labels as { language: string; value: string } | null
            const labelsPayload = labels
              ? { [labels.language]: { language: labels.language, value: labels.value } }
              : null

            try {
              await mw.applySdc(dupeFilename, claims, labelsPayload, summary)
              await uploads.updateUploadStatus(uploadId, 'duplicated_sdc_updated', {
                type: 'duplicated_sdc_updated',
                links,
                message: 'File already exists on Commons. SDC updated.',
              })
            } catch {
              await uploads.updateUploadStatus(uploadId, 'duplicated_sdc_not_updated', {
                type: 'duplicated_sdc_not_updated',
                links,
                message: 'File already exists on Commons. SDC could not be updated.',
              })
            }
          } else {
            await uploads.updateUploadStatus(uploadId, 'duplicate', {
              type: 'duplicate',
              links: [],
              message: 'File already exists on Commons.',
            })
          }

          await uploads.clearUploadAccessToken(uploadId)
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
        logger.error({ uploadId, batchId, err }, `Upload failed: ${message}`)
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
    logger.error({ jobId: job?.id, err }, 'Job permanently failed')
    if (job) {
      try {
        const message = err instanceof Error ? err.message : 'Unknown error'
        await uploads.updateUploadStatus(job.data.uploadId, 'failed', { type: 'error', message })
        await uploads.clearUploadAccessToken(job.data.uploadId)
      } catch (dbErr) {
        logger.error(
          { jobId: job.id, err: dbErr },
          'Failed to update database status for failed job',
        )
      }
    }
  })

  return worker
}
