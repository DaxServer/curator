import { app } from '@backend/app'
import { config } from '@backend/config'
import { embeddedFiles } from '@backend/embedded-frontend'
import { logger } from '@backend/logger'
import { createUploadWorker } from '@backend/workers/upload.worker'
import { Redis } from 'ioredis'

if (Bun.env.TOOL_TOOLSDB_USER && !embeddedFiles['/index.html']) {
  logger.error(
    'Production environment detected but no frontend files are embedded — rebuild with `bun run build`',
  )
}

const redis = new Redis(config.redisUrl)
const worker = createUploadWorker(redis)
worker.on('error', (err) => logger.error({ err }, 'Worker error'))

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'curator-server listening')
})
