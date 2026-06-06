import { app } from '@backend/app'
import { config } from '@backend/config'
import { logger } from '@backend/core/logger'
import { embeddedFiles } from '@backend/embedded-frontend'
import { createUploadWorker } from '@backend/workers/upload.worker'
import { Redis } from 'ioredis'

if (Bun.argv[2] === 'worker') {
  const redis = new Redis(config.redisUrl)
  const worker = createUploadWorker(redis)
  worker.on('error', (err) => logger.error({ err }, 'worker error'))

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await worker.close()
      await redis.quit()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

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
