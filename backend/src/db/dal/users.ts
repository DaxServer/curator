import type { DB } from '@backend/db/client'
import { users } from '@backend/db/schema'
import { count, like, or, sql } from 'drizzle-orm'

function userFilter(filterText?: string) {
  if (!filterText) return undefined
  const p = `%${filterText}%`
  return or(like(users.userid, p), like(users.username, p))
}

export class UserService {
  constructor(private db: DB) {}

  async getUsers({
    offset = 0,
    limit = 100,
    filterText,
  }: {
    offset?: number
    limit?: number
    filterText?: string
  } = {}): Promise<(typeof users.$inferSelect)[]> {
    return this.db.select().from(users).where(userFilter(filterText)).limit(limit).offset(offset)
  }

  async countUsers({ filterText }: { filterText?: string } = {}): Promise<number> {
    const [row] = await this.db
      .select({ n: count(users.userid) })
      .from(users)
      .where(userFilter(filterText))
    return row?.n ?? 0
  }

  async ensureUser(userid: string, username: string): Promise<typeof users.$inferSelect> {
    await this.db
      .insert(users)
      .values({
        userid,
        username,
        created_at: sql`CURRENT_TIMESTAMP`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .onDuplicateKeyUpdate({ set: { username: sql`VALUES(username)` } })
    return (await this.db.query.users.findFirst({
      where: (u, { eq }) => eq(u.userid, userid),
    }))!
  }
}
