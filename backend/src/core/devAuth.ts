import { config } from '@backend/config'
import { sessionPlugin } from '@backend/core/session'
import { Elysia } from 'elysia'

export const devAuthPlugin = new Elysia({ name: 'dev-auth' })
  .use(sessionPlugin)
  .onBeforeHandle({ as: 'global' }, async ({ session }) => {
    if (Bun.env.DEV_MOCK_AUTH !== 'true' || session.user) return
    session.user = {
      username: Bun.env.DEV_MOCK_USERNAME ?? config.xUsername,
      sub: Bun.env.DEV_MOCK_SUB ?? 'dev-user-1',
      editcount: 100,
      rights: ['autoconfirmed'],
    }
    await session.save()
  })
