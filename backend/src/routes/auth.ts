import { config } from '@backend/config'
import { logger } from '@backend/core/logger'
import { createOAuthClient } from '@backend/core/oauthClient'
import { sessionPlugin } from '@backend/core/session'
import { Elysia, t } from 'elysia'

const MIN_EDITCOUNT = 50

export const oauthPlugin = new Elysia({ name: 'oauth-client' }).decorate(
  'oauthClient',
  createOAuthClient(config.oauthKey, config.oauthSecret),
)

export const authRoutes = new Elysia({ name: 'auth-routes', prefix: '/auth' })
  .use(sessionPlugin)
  .use(oauthPlugin)
  .get('/login', async ({ oauthClient, session, redirect }) => {
    const { redirectUrl, requestToken } = await oauthClient.initiate()
    session.request_token = requestToken
    await session.save()
    logger.info('[auth] oauth login initiated')
    return redirect(redirectUrl, 302)
  })
  .get('/callback', async ({ oauthClient, session, query, redirect, set }) => {
    if (!session.request_token) {
      logger.warn('[auth] callback: no request token in session')
      set.status = 400
      return 'No request token in session'
    }
    if (!query.oauth_token || !query.oauth_verifier) {
      logger.warn('[auth] callback: missing oauth_token or oauth_verifier')
      set.status = 400
      return 'Missing required OAuth parameters'
    }

    const { accessToken } = await oauthClient.complete(
      session.request_token,
      new URLSearchParams(query as Record<string, string>).toString(),
    )
    const identity = await oauthClient.identify(accessToken)

    if (identity.editcount < MIN_EDITCOUNT || !identity.rights.includes('autoconfirmed')) {
      logger.warn(
        `[auth] login rejected for ${identity.username} (editcount: ${identity.editcount}, autoconfirmed: ${identity.rights.includes('autoconfirmed')})`,
      )
      set.status = 403
      return 'You must be an autoconfirmed Commons user with at least 50 edits to use this tool.'
    }

    await session.regenerate()

    session.user = {
      username: identity.username,
      sub: identity.sub,
      editcount: identity.editcount,
      rights: identity.rights,
    }
    session.access_token = accessToken
    delete session.request_token
    await session.save()
    logger.info(`[auth] ${identity.username} logged in`)
    return redirect('/', 302)
  })
  .get('/logout', async ({ session, redirect }) => {
    const username = session.user?.username
    session.clear()
    await session.save()
    logger.info(`[auth] ${username ?? 'unknown'} logged out`)
    return redirect('/', 302)
  })
  .get(
    '/whoami',
    ({ session, status }) => {
      if (!session.user) {
        return status(401, { message: 'Unauthorized' })
      }
      return {
        username: session.user.username,
        userid: session.user.sub,
        authorized: config.xUsername === session.user.username,
        isMock: !!(
          Bun.env.DEV_MOCK_AUTH === 'true' &&
          session.user.sub === (Bun.env.DEV_MOCK_SUB ?? 'dev-user-1')
        ),
        maintenance: config.enableMaintenance,
      }
    },
    {
      response: {
        200: t.Object({
          username: t.String(),
          userid: t.String(),
          authorized: t.Boolean(),
          isMock: t.Boolean(),
          maintenance: t.Boolean(),
        }),
        401: t.Object({ message: t.String() }),
      },
    },
  )
  .post('/register', async ({ session, headers, set }) => {
    // Read live from env so tests can inject values via Bun.env
    const xUsername = Bun.env.X_USERNAME ?? ''
    const xApiKey = Bun.env.X_API_KEY ?? ''
    if (!xUsername || !xApiKey) {
      set.status = 500
      return { message: 'Server configuration error: API key or username not set' }
    }

    const providedKey = headers['x-api-key']
    if (!providedKey) {
      set.status = 400
      return { message: 'Missing X-API-KEY header' }
    }

    if (providedKey !== xApiKey) {
      logger.warn('[auth] /register: invalid api key')
      set.status = 401
      return { message: 'Invalid API key' }
    }

    session.user = {
      username: xUsername,
      sub: 'bot-user-id',
      editcount: 0,
      rights: [],
    }
    session.access_token = ['test-key', 'test-secret']
    await session.save()
    logger.info(`[auth] bot user ${xUsername} registered`)
    return { message: 'User registered successfully', username: xUsername }
  })
