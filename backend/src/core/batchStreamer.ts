import type { BatchItem as DalBatchItem } from '@backend/db/dal/batches'
import {
  countBatches,
  getBatchIdsWithRecentChanges,
  getBatches,
  getBatchesMinimal,
  getLatestUpdateTime,
} from '@backend/db/dal/batches'
import { wsLogger } from '@backend/logger'
import type { BatchItem, ServerMessage } from '@backend/types/ws'

export const STREAM_INTERVAL_MS = 2000

export interface WsSender {
  send(msg: ServerMessage): void
}

export function nonce(): string {
  return new Date().toISOString()
}

export function toWsBatchItem(b: DalBatchItem): BatchItem {
  return { ...b, username: b.username ?? '' }
}

export class OptimizedBatchStreamer {
  private sender: WsSender
  private username: string
  private lastUpdateTime: Date | null = null
  private interval: ReturnType<typeof setTimeout> | null = null

  constructor(sender: WsSender, username: string) {
    this.sender = sender
    this.username = username
  }

  async startStreaming(
    userid: string | undefined,
    filterText: string | undefined,
    page: number,
    limit: number,
  ): Promise<void> {
    wsLogger.info(
      `[ws] [resp] Starting optimized batch streaming for ${this.username} (page: ${page}, limit: ${limit})`,
    )
    const offset = (page - 1) * limit
    const [items, total] = await Promise.all([
      getBatches({ offset, limit, filterText, userid }),
      countBatches({ filterText, userid }),
    ])
    this.sender.send({
      type: 'BATCHES_LIST',
      data: { items: items.map(toWsBatchItem), total },
      partial: false,
      nonce: nonce(),
    })
    this.lastUpdateTime = await getLatestUpdateTime({ userid, filterText })

    if (page > 1) {
      wsLogger.info(
        `[ws] [resp] Pagination detected (page ${page}), not streaming updates for ${this.username}`,
      )
      return
    }

    const poll = async () => {
      try {
        const current = await getLatestUpdateTime({ userid, filterText })
        if (current && (!this.lastUpdateTime || current > this.lastUpdateTime)) {
          const checkTime = this.lastUpdateTime ?? new Date(0)
          const changedIds = await getBatchIdsWithRecentChanges(checkTime, {
            userid,
            filterText,
          })
          if (changedIds.length > 0) {
            const changed = await getBatchesMinimal(changedIds)
            if (changed.length > 0) {
              const newTotal = await countBatches({ filterText, userid })
              wsLogger.info(
                `[ws] [resp] Updates detected for ${this.username}, sending incremental update`,
              )
              this.sender.send({
                type: 'BATCHES_LIST',
                data: { items: changed.map(toWsBatchItem), total: newTotal },
                partial: true,
                nonce: nonce(),
              })
            }
          }
          this.lastUpdateTime = current
        }
      } catch (e) {
        wsLogger.error({ username: this.username, err: e }, 'Streaming error')
      }
      if (this.interval !== null) {
        this.interval = setTimeout(poll, STREAM_INTERVAL_MS)
      }
    }
    this.interval = setTimeout(poll, 0)
  }

  stopStreaming(): void {
    if (this.interval) {
      wsLogger.info(`[ws] [resp] Stopping optimized batch streaming for ${this.username}`)
      clearTimeout(this.interval)
      this.interval = null
    }
  }
}
