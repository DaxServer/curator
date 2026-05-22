import { devAuthPlugin } from '@backend/core/devAuth'
import { logger } from '@backend/logger'
import { adminRoutes } from '@backend/routes/admin'
import { authRoutes } from '@backend/routes/auth'
import { wsRoutes } from '@backend/routes/ws'
import { staticPlugin } from '@elysiajs/static'
import { Elysia } from 'elysia'
import logixlysia from 'logixlysia'
import path from 'node:path'

const isTest = Bun.env.NODE_ENV === 'test'
const STATIC_DIR = Bun.env.STATIC_DIR

const base = new Elysia({ cookie: { httpOnly: true, sameSite: 'lax', path: '/' } })
  .use(logixlysia({ config: { pino: logger, useTransportsOnly: isTest } }))
  .use(devAuthPlugin)
  .get('/health', () => ({ status: 'ok' }))
  .use(authRoutes)
  .use(adminRoutes)
  .use(wsRoutes)

export type App = typeof base

export const app = STATIC_DIR
  ? base
      .use(staticPlugin({ assets: STATIC_DIR, prefix: '/' }))
      .get('/*', () => Bun.file(path.join(STATIC_DIR, 'index.html')))
  : base
