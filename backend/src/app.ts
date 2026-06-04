import { devAuthPlugin } from '@backend/core/devAuth'
import { serveStaticFiles } from '@backend/core/staticFiles'
import { embeddedFiles } from '@backend/embedded-frontend'
import { logger } from '@backend/logger'
import { adminRoutes } from '@backend/routes/admin'
import { authRoutes } from '@backend/routes/auth'
import { wsRoutes } from '@backend/routes/ws'
import { Elysia } from 'elysia'
import logixlysia from 'logixlysia'

const isTest = Bun.env.NODE_ENV === 'test'
const indexHtml = embeddedFiles['/index.html']

const base = new Elysia({ cookie: { httpOnly: true, sameSite: 'lax', path: '/' } })
  .use(logixlysia({ config: { pino: logger, useTransportsOnly: isTest } }))
  .use(devAuthPlugin)
  .get('/health', () => ({ status: 'ok' }))
  .use(authRoutes)
  .use(adminRoutes)
  .use(wsRoutes)

export type App = typeof base

export const app =
  indexHtml !== undefined ? base.use(serveStaticFiles(embeddedFiles, indexHtml)) : base
