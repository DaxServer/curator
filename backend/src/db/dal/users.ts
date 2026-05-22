import { db } from '@backend/db/client'
import { users } from '@backend/db/schema'
import { count, like, or, sql } from 'drizzle-orm'

function userFilter(filterText?: string) {
  if (!filterText) return undefined
  const p = `%${filterText}%`
  return or(like(users.userid, p), like(users.username, p))
}

export async function getUsers({
  offset = 0,
  limit = 100,
  filterText,
}: {
  offset?: number
  limit?: number
  filterText?: string
} = {}): Promise<(typeof users.$inferSelect)[]> {
  return db.select().from(users).where(userFilter(filterText)).limit(limit).offset(offset)
}

export async function countUsers({ filterText }: { filterText?: string } = {}): Promise<number> {
  const [row] = await db
    .select({ n: count(users.userid) })
    .from(users)
    .where(userFilter(filterText))
  return row?.n ?? 0
}

export async function ensureUser(
  userid: string,
  username: string,
): Promise<typeof users.$inferSelect> {
  await db
    .insert(users)
    .values({
      userid,
      username,
      created_at: sql`CURRENT_TIMESTAMP`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .onDuplicateKeyUpdate({ set: { username: sql`VALUES(username)` } })
  return (await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.userid, userid),
  }))!
}
