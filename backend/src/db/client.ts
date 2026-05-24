import { config } from '@backend/config'
import * as schema from '@backend/db/schema'
import type { MySql2Database } from 'drizzle-orm/mysql2'
import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'

let _db: MySql2Database<typeof schema> | undefined

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

function getDb(): MySql2Database<typeof schema> {
  if (!_db) {
    const pool = mysql.createPool({
      ...parseDbUrl(config.dbUrl),
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    })
    _db = drizzle(pool, { schema, mode: 'default' })
  }
  return _db
}

export const db = new Proxy({} as MySql2Database<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver)
  },
})
export type DB = MySql2Database<typeof schema>
