import { app } from '@backend/app'
import { config } from '@backend/config'
import { logger } from '@backend/core/logger'
import { embeddedFiles } from '@backend/embedded-frontend'
import { subscribeWorkerShutdown } from '@backend/workers/signal'
import { createUploadWorker } from '@backend/workers/upload.worker'
import { Redis } from 'ioredis'

if (Bun.argv[2] === 'worker') {
  const redis = new Redis(config.redisUrl)
  const subscriberRedis = new Redis(config.redisUrl)
  const worker = createUploadWorker(redis)
  worker.on('error', (err) => logger.error({ err }, 'worker error'))

  let shuttingDown = false
  const shutdown = async (reason: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.warn(`[worker] shutdown requested (${reason}), draining active job`)
    try {
      await worker.close()
      await redis.quit()
      await subscriberRedis.quit()
      logger.warn('[worker] shutdown complete')
    } finally {
      process.exit(0)
    }
  }

  subscribeWorkerShutdown(subscriberRedis, () => shutdown('pub/sub signal'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  logger.info('[worker] started')
} else {
  if (Bun.env.TOOL_TOOLSDB_USER && !embeddedFiles['/index.html']) {
    logger.error(
      '[server] production environment detected but no frontend files are embedded — rebuild with `bun run build`',
    )
  }

  app.listen(config.port, () => {
    logger.info(`[server] listening on port ${config.port}`)
  })
}
