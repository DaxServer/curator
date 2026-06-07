import { config } from '@backend/config'
import { logger } from '@backend/core/logger'
import type { RateLimitInfo } from '@backend/core/rateLimiter'
import { Queue } from 'bullmq'

export interface UploadJobData {
  uploadId: number
  batchId: number
  editGroupId: string
  userid: string
  rateLimit: RateLimitInfo
  requeueCount?: number
}

const connection = { url: config.redisUrl }

let _queue: Queue<UploadJobData> | null = null

function getUploadQueue(): Queue<UploadJobData> {
  if (!_queue) {
    _queue = new Queue<UploadJobData>('uploads', { connection, prefix: '{bull}' })
  }
  return _queue
}

export async function enqueueUpload(data: UploadJobData, delayMs: number): Promise<string> {
  const job = await getUploadQueue().add('upload', data, {
    delay: Math.round(delayMs),
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    jobId: `upload-${data.uploadId}`,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 86400 * 7 },
  })
  logger.info(
    `[worker] upload ${data.uploadId} enqueued (job: ${job.id}, batch: ${data.batchId}, delay: ${Math.round(delayMs)}ms)`,
  )
  return job.id!
}

export async function removeUploadJob(jobId: string): Promise<void> {
  const job = await getUploadQueue().getJob(jobId)
  if (job) {
    await job.remove()
    logger.info(`[worker] job ${jobId} removed from queue`)
  }
}
