import { config } from '@backend/config'
import { Redis } from 'ioredis'

export const WORKER_SHUTDOWN_CHANNEL = 'worker:shutdown'

let _publishRedis: Redis | null = null

export async function publishWorkerShutdown(): Promise<void> {
  _publishRedis ??= new Redis(config.redisUrl)
  await _publishRedis.publish(WORKER_SHUTDOWN_CHANNEL, '1')
}

export function subscribeWorkerShutdown(redis: Redis, onShutdown: () => void): void {
  redis.subscribe(WORKER_SHUTDOWN_CHANNEL)
  redis.on('message', (channel: string) => {
    if (channel === WORKER_SHUTDOWN_CHANNEL) onShutdown()
  })
}
