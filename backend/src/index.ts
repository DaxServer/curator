import { app } from '@backend/app'
import { config } from '@backend/config'
import { embeddedFiles } from '@backend/embedded-frontend'
import { logger } from '@backend/logger'
import { createUploadWorker } from '@backend/workers/upload.worker'
import { Redis } from 'ioredis'

if (Bun.argv[2] === 'worker') {
  const redis = new Redis(config.redisUrl)
  const worker = createUploadWorker(redis)
  worker.on('error', (err) => logger.error({ err }, 'Worker error'))

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await worker.close()
    await redis.quit()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  logger.info('curator-worker started')
} else {
  if (Bun.env.TOOL_TOOLSDB_USER && !embeddedFiles['/index.html']) {
    logger.error(
      'Production environment detected but no frontend files are embedded — rebuild with `bun run build`',
    )
  }

  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'curator-server listening')
  })
}
