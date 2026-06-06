import { devAuthPlugin } from '@backend/core/devAuth'
import { elysiaLogger } from '@backend/core/logger'
import { serveStaticFiles } from '@backend/core/staticFiles'
import { embeddedFiles } from '@backend/embedded-frontend'
import { adminRoutes } from '@backend/routes/admin'
import { authRoutes } from '@backend/routes/auth'
import { wsRoutes } from '@backend/routes/ws'
import { Elysia } from 'elysia'

const indexHtml = embeddedFiles['/index.html']

const base = new Elysia({ cookie: { httpOnly: true, sameSite: 'lax', path: '/' } })
  .use(elysiaLogger)
  .use(devAuthPlugin)
  .get('/health', () => ({ status: 'ok' }))
  .use(authRoutes)
  .use(adminRoutes)
  .use(wsRoutes)

export type App = typeof base

export const app =
  indexHtml !== undefined ? base.use(serveStaticFiles(embeddedFiles, indexHtml)) : base
