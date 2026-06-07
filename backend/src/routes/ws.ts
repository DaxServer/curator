import { Handler } from '@backend/core/handler'
import { logger } from '@backend/core/logger'
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
    message(ws, body) {
      if (!ws.data.session.user) {
        ws.close(1008, 'Unauthorized')
        return
      }
      const handler = connections.get(ws.id)
      if (!handler) {
        ws.close(1011, 'Handler not initialized')
        return
      }
      logger.info(`[ws] ${body.type} from ${ws.data.session.user.username}`)
      switch (body.type) {
        case 'FETCH_BATCHES':
          handler.fetchBatches(body.data)
          break
        case 'FETCH_BATCH_UPLOADS':
          handler.fetchBatchUploads(body.data)
          break
        case 'RETRY_UPLOADS':
          handler.retryUploads(body.data)
          break
        case 'CANCEL_BATCH':
          handler.cancelBatch(body.data)
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
          handler.createBatch()
          break
        case 'DELETE_PRESET':
          handler.deletePreset(body.data.preset_id)
          break
        case 'FETCH_IMAGES':
          handler.fetchImages(body.data, body.handler)
          break
        case 'FETCH_PRESETS':
          handler.fetchPresets(body.data.handler)
          break
        case 'SAVE_PRESET':
          handler.savePreset(body.data)
          break
        case 'UPLOAD_SLICE':
          handler.uploadSlice(body.data)
          break
        case 'CHECK_CATEGORIES_DELETED':
          handler.checkCategoriesDeleted(body.data.titles)
          break
        case 'CREATE_CATEGORY':
          handler.createCategory(body.data.title, body.data.text, body.data.wikidata_qid)
          break
        case 'RECATEGORIZE_FILES':
          handler.recategorizeFiles(body.data.source, body.data.target)
          break
      }
    },
    close(ws) {
      const handler = connections.get(ws.id)
      handler?.cancelTasks()
      connections.delete(ws.id)
    },
  })
