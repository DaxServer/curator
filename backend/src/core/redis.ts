import { config } from '@backend/config'
import Elysia from 'elysia'
import { Redis } from 'ioredis'

class LazyRedis {
  private _client: Redis | null = null

  get client(): Redis {
    this._client ??= new Redis(config.redisUrl)
    return this._client
  }
}

export const redisPlugin = new Elysia({ name: 'redis' }).decorate('redis', new LazyRedis())
