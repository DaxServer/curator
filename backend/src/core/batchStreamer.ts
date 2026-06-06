import { logger } from '@backend/core/logger'
import type { BatchService, BatchItem as DalBatchItem } from '@backend/db/dal/batches'
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
  private lastUpdateTime: Date | null = null
  private interval: ReturnType<typeof setTimeout> | null = null

  constructor(
    private sender: WsSender,
    private username: string,
    private batches: BatchService,
  ) {}

  async startStreaming(
    userid: string | undefined,
    filterText: string | undefined,
    page: number,
    limit: number,
  ): Promise<void> {
    const filterSuffix = filterText ? `, filter: "${filterText}"` : ''
    logger.info(
      `[ws] [resp] starting batch streaming for ${this.username} (page: ${page}, limit: ${limit}${filterSuffix})`,
    )
    const offset = (page - 1) * limit
    this.lastUpdateTime = await this.batches.getLatestUpdateTime({ userid, filterText })
    const [items, total] = await Promise.all([
      this.batches.getBatches({ offset, limit, filterText, userid }),
      this.batches.countBatches({ filterText, userid }),
    ])
    this.sender.send({
      type: 'BATCHES_LIST',
      data: { items: items.map(toWsBatchItem), total },
      partial: false,
      nonce: nonce(),
    })

    if (page > 1) {
      logger.info(
        `[ws] [resp] pagination detected (page ${page}), not streaming updates for ${this.username}`,
      )
      return
    }

    const poll = async () => {
      try {
        const current = await this.batches.getLatestUpdateTime({ userid, filterText })
        if (current && (!this.lastUpdateTime || current > this.lastUpdateTime)) {
          const checkTime = this.lastUpdateTime ?? new Date(0)
          const changedIds = await this.batches.getBatchIdsWithRecentChanges(checkTime, {
            userid,
            filterText,
          })
          if (changedIds.length > 0) {
            const changed = await this.batches.getBatchesMinimal(changedIds)
            if (changed.length > 0) {
              const newTotal = await this.batches.countBatches({ filterText, userid })
              logger.info(
                `[ws] [resp] updates detected for ${this.username}, sending incremental update`,
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
        logger.error({ username: this.username, err: e }, '[ws] streaming error')
      }
      if (this.interval !== null) {
        this.interval = setTimeout(poll, STREAM_INTERVAL_MS)
      }
    }
    this.interval = setTimeout(poll, 0)
  }

  stopStreaming(): void {
    if (this.interval) {
      logger.info(`[ws] [resp] stopping batch streaming for ${this.username}`)
      clearTimeout(this.interval)
      this.interval = null
    }
  }
}
