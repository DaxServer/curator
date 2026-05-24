import { config } from '@backend/config'
import * as schema from '@backend/db/schema'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'

function parseDbUrl(url: string) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.slice(1)),
  }
}

export class LazyDb {
  private _db: MySql2Database<typeof schema> | undefined

  get client(): MySql2Database<typeof schema> {
    this._db ??= drizzle(mysql.createPool(parseDbUrl(config.dbUrl)), { schema, mode: 'default' })
    return this._db
  }
}

export const lazyDb = new LazyDb()

export type DB = MySql2Database<typeof schema>
