import { Handler } from '@backend/core/handler'
import { elapsed, logger } from '@backend/core/logger'
import { redisPlugin } from '@backend/core/redis'
import { sessionPlugin } from '@backend/core/session'
import { dbPlugin } from '@backend/db/plugin'
import { ClientMessage, ServerMessage } from '@backend/types/ws'
import Elysia, { ValidationError } from 'elysia'

const connections = new Map<string, Handler>()

export const wsRoutes = new Elysia({ name: 'ws-routes' })
  .use(sessionPlugin)
  .use(redisPlugin)
  .use(dbPlugin)
  .onError(({ error }) => {
    if (error instanceof ValidationError) {
      logger.error({ errors: error.all }, '[ws] websocket validation error')
    }
  })
  .ws('/ws', {
    body: ClientMessage,
    response: ServerMessage,
    open(ws) {
      if (!ws.data.session.user) {
        ws.close(1008, 'Unauthorized')
        return
      }
      if (!ws.data.session.access_token) {
        ws.close(1008, 'Unauthorized')
        return
      }
      const user = {
        ...ws.data.session.user,
        access_token: ws.data.session.access_token,
      }
      const sender = { send: (msg: ServerMessage) => ws.send(msg) }
      const { batches, uploads, presets, users } = ws.data
      const handler = new Handler(user, sender, ws.data.redis.client, {
        batches,
        uploads,
        presets,
        users,
      })
      connections.set(ws.id, handler)
      logger.info(`[ws] user ${user.username} connected`)
    },
    async message(ws, body) {
      if (!ws.data.session.user) {
        ws.close(1008, 'Unauthorized')
        return
      }
      const handler = connections.get(ws.id)
      if (!handler) {
        ws.close(1011, 'Handler not initialized')
        return
      }
      const { username } = ws.data.session.user
      logger.info(`[ws] ${body.type} from ${username}`)
      const start = process.hrtime.bigint()
      switch (body.type) {
        case 'FETCH_BATCHES':
          await handler.fetchBatches(body.data)
          logger.info(`[ws] FETCH_BATCHES from ${username} | ${elapsed(start)}`)
          break
        case 'FETCH_BATCH_UPLOADS':
          await handler.fetchBatchUploads(body.data)
          logger.info(`[ws] FETCH_BATCH_UPLOADS from ${username} | ${elapsed(start)}`)
          break
        case 'RETRY_UPLOADS':
          await handler.retryUploads(body.data)
          logger.info(`[ws] RETRY_UPLOADS from ${username} | ${elapsed(start)}`)
          break
        case 'CANCEL_BATCH':
          await handler.cancelBatch(body.data)
          logger.info(`[ws] CANCEL_BATCH from ${username} | ${elapsed(start)}`)
          break
        case 'SUBSCRIBE_BATCH':
          handler.subscribeBatch(body.data)
          break
        case 'SUBSCRIBE_BATCHES_LIST':
          handler.subscribeBatchesList(body.data)
          break
        case 'UNSUBSCRIBE_BATCH':
          handler.unsubscribeBatch()
          break
        case 'UNSUBSCRIBE_BATCHES_LIST':
          handler.unsubscribeBatchesList()
          break
        case 'CREATE_BATCH':
          await handler.createBatch()
          logger.info(`[ws] CREATE_BATCH from ${username} | ${elapsed(start)}`)
          break
        case 'DELETE_PRESET':
          await handler.deletePreset(body.data.preset_id)
          logger.info(`[ws] DELETE_PRESET from ${username} | ${elapsed(start)}`)
          break
        case 'FETCH_IMAGES':
          await handler.fetchImages(body.data, body.handler)
          logger.info(`[ws] FETCH_IMAGES from ${username} | ${elapsed(start)}`)
          break
        case 'FETCH_PRESETS':
          await handler.fetchPresets(body.data.handler)
          logger.info(`[ws] FETCH_PRESETS from ${username} | ${elapsed(start)}`)
          break
        case 'SAVE_PRESET':
          await handler.savePreset(body.data)
          logger.info(`[ws] SAVE_PRESET from ${username} | ${elapsed(start)}`)
          break
        case 'UPLOAD_SLICE':
          await handler.uploadSlice(body.data)
          logger.info(`[ws] UPLOAD_SLICE from ${username} | ${elapsed(start)}`)
          break
        case 'CHECK_CATEGORIES_DELETED':
          await handler.checkCategoriesDeleted(body.data.titles)
          logger.info(`[ws] CHECK_CATEGORIES_DELETED from ${username} | ${elapsed(start)}`)
          break
        case 'CREATE_CATEGORY':
          await handler.createCategory(body.data.title, body.data.text, body.data.wikidata_qid)
          logger.info(`[ws] CREATE_CATEGORY from ${username} | ${elapsed(start)}`)
          break
        case 'RECATEGORIZE_FILES':
          await handler.recategorizeFiles(body.data.source, body.data.target)
          logger.info(`[ws] RECATEGORIZE_FILES from ${username} | ${elapsed(start)}`)
          break
      }
    },
    close(ws) {
      const handler = connections.get(ws.id)
      handler?.cancelTasks()
      connections.delete(ws.id)
    },
  })
