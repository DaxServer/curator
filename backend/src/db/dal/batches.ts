import { generateEditGroupId } from '@backend/core/crypto'
import type { DB } from '@backend/db/client'
import { batches, uploadRequests, users } from '@backend/db/schema'
import { and, count, desc, eq, gt, inArray, like, max, or, sql } from 'drizzle-orm'

export type BatchStats = {
  total: number
  queued: number
  in_progress: number
  completed: number
  failed: number
  cancelled: number
  duplicate: number
}

export type BatchItem = {
  id: number
  userid: string
  username: string | null
  edit_group_id: string | null
  created_at: string
  updated_at: string
  stats: BatchStats
}

const EMPTY_STATS: BatchStats = {
  total: 0,
  queued: 0,
  in_progress: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  duplicate: 0,
}

const batchCols = {
  id: batches.id,
  userid: batches.userid,
  edit_group_id: batches.edit_group_id,
  created_at: batches.created_at,
  updated_at: batches.updated_at,
  username: users.username,
}

type BatchRow = {
  id: number
  userid: string
  edit_group_id: string | null
  created_at: Date
  updated_at: Date
  username: string | null
}

function toItem(row: BatchRow, stats: BatchStats): BatchItem {
  return {
    id: row.id,
    userid: row.userid,
    username: row.username,
    edit_group_id: row.edit_group_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    stats,
  }
}

function batchFilter(filterText?: string, userid?: string) {
  const parts = []
  if (filterText) {
    const p = `%${filterText}%`
    parts.push(or(like(sql`CAST(${batches.id} AS CHAR)`, p), like(users.username, p)))
  }
  if (userid) parts.push(eq(batches.userid, userid))
  return parts.length ? and(...parts) : undefined
}

export class BatchService {
  constructor(private db: DB) {}

  async populateBatchStats(batchIds: number[]): Promise<Map<number, BatchStats>> {
    if (batchIds.length === 0) return new Map()
    const rows = await this.db
      .select({
        batchid: uploadRequests.batchid,
        total: count(uploadRequests.id),
        queued: sql<number>`SUM(CASE WHEN ${uploadRequests.status} = 'queued' THEN 1 ELSE 0 END)`,
        in_progress: sql<number>`SUM(CASE WHEN ${uploadRequests.status} = 'in_progress' THEN 1 ELSE 0 END)`,
        completed: sql<number>`SUM(CASE WHEN ${uploadRequests.status} = 'completed' THEN 1 ELSE 0 END)`,
        failed: sql<number>`SUM(CASE WHEN ${uploadRequests.status} = 'failed' THEN 1 ELSE 0 END)`,
        cancelled: sql<number>`SUM(CASE WHEN ${uploadRequests.status} = 'cancelled' THEN 1 ELSE 0 END)`,
        duplicate: sql<number>`SUM(CASE WHEN ${uploadRequests.status} IN ('duplicate','duplicated_sdc_updated','duplicated_sdc_not_updated') THEN 1 ELSE 0 END)`,
      })
      .from(uploadRequests)
      .where(inArray(uploadRequests.batchid, batchIds))
      .groupBy(uploadRequests.batchid)
    const map = new Map<number, BatchStats>()
    for (const r of rows) {
      map.set(r.batchid, {
        total: r.total,
        queued: Number(r.queued),
        in_progress: Number(r.in_progress),
        completed: Number(r.completed),
        failed: Number(r.failed),
        cancelled: Number(r.cancelled),
        duplicate: Number(r.duplicate),
      })
    }
    return map
  }

  async createBatch(userid: string, _username: string): Promise<BatchItem> {
    const edit_group_id = generateEditGroupId()
    const result = await this.db.insert(batches).values({
      userid,
      edit_group_id,
      created_at: sql`CURRENT_TIMESTAMP`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    const insertId = (result[0] as { insertId: number }).insertId
    const row = await this.db
      .select(batchCols)
      .from(batches)
      .innerJoin(users, eq(batches.userid, users.userid))
      .where(eq(batches.id, insertId))
      .then((r) => r[0]!)
    return toItem(row, EMPTY_STATS)
  }

  async getBatch(batchId: number): Promise<BatchItem | null> {
    const row = await this.db
      .select(batchCols)
      .from(batches)
      .innerJoin(users, eq(batches.userid, users.userid))
      .where(eq(batches.id, batchId))
      .then((r) => r[0])
    if (!row) return null
    const statsMap = await this.populateBatchStats([batchId])
    return toItem(row, statsMap.get(batchId) ?? EMPTY_STATS)
  }

  async getBatches({
    offset = 0,
    limit = 100,
    filterText,
    userid,
  }: { offset?: number; limit?: number; filterText?: string; userid?: string } = {}): Promise<
    BatchItem[]
  > {
    const rows = await this.db
      .select(batchCols)
      .from(batches)
      .innerJoin(users, eq(batches.userid, users.userid))
      .where(batchFilter(filterText, userid))
      .orderBy(desc(batches.created_at))
      .limit(limit)
      .offset(offset)
    const statsMap = await this.populateBatchStats(rows.map((r) => r.id))
    return rows.map((r) => toItem(r, statsMap.get(r.id) ?? EMPTY_STATS))
  }

  async countBatches({
    filterText,
    userid,
  }: { filterText?: string; userid?: string } = {}): Promise<number> {
    const [row] = await this.db
      .select({ n: count(batches.id) })
      .from(batches)
      .innerJoin(users, eq(batches.userid, users.userid))
      .where(batchFilter(filterText, userid))
    return row?.n ?? 0
  }

  async getBatchesMinimal(batchIds: number[]): Promise<BatchItem[]> {
    if (batchIds.length === 0) return []
    const rows = await this.db
      .select(batchCols)
      .from(batches)
      .innerJoin(users, eq(batches.userid, users.userid))
      .where(inArray(batches.id, batchIds))
    const statsMap = await this.populateBatchStats(batchIds)
    return rows.map((r) => toItem(r, statsMap.get(r.id) ?? EMPTY_STATS))
  }

  async getBatchIdsWithRecentChanges(
    lastUpdateTime: Date,
    { userid, filterText }: { userid?: string; filterText?: string } = {},
  ): Promise<number[]> {
    const [fromUploads, fromBatches] = await Promise.all([
      this.db
        .selectDistinct({ id: uploadRequests.batchid })
        .from(uploadRequests)
        .innerJoin(batches, eq(uploadRequests.batchid, batches.id))
        .innerJoin(users, eq(batches.userid, users.userid))
        .where(and(gt(uploadRequests.updated_at, lastUpdateTime), batchFilter(filterText, userid))),
      this.db
        .selectDistinct({ id: batches.id })
        .from(batches)
        .innerJoin(users, eq(batches.userid, users.userid))
        .where(and(gt(batches.updated_at, lastUpdateTime), batchFilter(filterText, userid))),
    ])
    return [...new Set([...fromUploads.map((r) => r.id), ...fromBatches.map((r) => r.id)])]
  }

  async getLatestUpdateTime({
    userid,
    filterText,
  }: { userid?: string; filterText?: string } = {}): Promise<Date | null> {
    const [batchMax, uploadMax] = await Promise.all([
      this.db
        .select({ t: max(batches.updated_at) })
        .from(batches)
        .innerJoin(users, eq(batches.userid, users.userid))
        .where(batchFilter(filterText, userid))
        .then((r) => r[0]?.t ?? null),
      this.db
        .select({ t: max(uploadRequests.updated_at) })
        .from(uploadRequests)
        .innerJoin(batches, eq(uploadRequests.batchid, batches.id))
        .innerJoin(users, eq(batches.userid, users.userid))
        .where(batchFilter(filterText, userid))
        .then((r) => r[0]?.t ?? null),
    ])
    if (!batchMax && !uploadMax) return null
    if (!batchMax) return uploadMax
    if (!uploadMax) return batchMax
    return batchMax > uploadMax ? batchMax : uploadMax
  }

  async countUploadsInBatch(batchId: number): Promise<number> {
    const [row] = await this.db
      .select({ n: count(uploadRequests.id) })
      .from(uploadRequests)
      .where(eq(uploadRequests.batchid, batchId))
    return row?.n ?? 0
  }
}
