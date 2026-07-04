import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  int,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

const json = customType<{ data: unknown; driverData: string | null }>({
  dataType: () => 'json',
  toDriver: (value) => (value === null ? null : JSON.stringify(value)),
  fromDriver: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
})

export const users = mysqlTable(
  'users',
  {
    userid: varchar({ length: 255 }).primaryKey(),
    username: varchar({ length: 255 }).notNull(),
    created_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [index('users_username_idx').on(t.username)],
)

export const presets = mysqlTable(
  'presets',
  {
    id: int().primaryKey().autoincrement(),
    userid: varchar({ length: 255 })
      .notNull()
      .references(() => users.userid),
    handler: varchar({ length: 50 }).notNull(),
    title: varchar({ length: 255 }).notNull(),
    title_template: varchar({ length: 500 }).notNull(),
    labels: json(),
    categories: varchar({ length: 500 }),
    exclude_from_date_category: boolean().notNull().default(false),
    is_default: boolean().notNull().default(false),
    created_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [
    index('presets_userid_idx').on(t.userid),
    index('presets_handler_idx').on(t.handler),
    index('presets_is_default_idx').on(t.is_default),
  ],
)

export const batches = mysqlTable(
  'batches',
  {
    id: int().primaryKey().autoincrement(),
    userid: varchar({ length: 255 })
      .notNull()
      .references(() => users.userid),
    edit_group_id: varchar({ length: 12 }),
    created_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [
    index('batches_userid_idx').on(t.userid),
    index('batches_created_at_idx').on(t.created_at),
    index('batches_updated_at_idx').on(t.updated_at),
  ],
)

export const uploadRequests = mysqlTable(
  'upload_requests',
  {
    id: int().primaryKey().autoincrement(),
    batchid: int()
      .notNull()
      .references(() => batches.id),
    userid: varchar({ length: 255 })
      .notNull()
      .references(() => users.userid),
    status: varchar({ length: 50 }).notNull(),
    key: varchar({ length: 255 }).notNull(),
    handler: varchar({ length: 255 }).notNull(),
    collection: varchar({ length: 255 }),
    access_token: text(),
    filename: varchar({ length: 255 }).notNull(),
    wikitext: text().notNull(),
    copyright_override: boolean().notNull().default(false),
    labels: json(),
    result: text(),
    error: json(),
    success: text(),
    celery_task_id: varchar({ length: 255 }),
    created_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp()
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (t) => [
    uniqueIndex('upload_requests_batchid_key_uidx').on(t.batchid, t.key),
    index('upload_requests_batchid_idx').on(t.batchid),
    index('upload_requests_userid_idx').on(t.userid),
    index('upload_requests_status_idx').on(t.status),
    index('upload_requests_key_idx').on(t.key),
    index('upload_requests_handler_idx').on(t.handler),
    index('upload_requests_filename_idx').on(t.filename),
    index('upload_requests_created_at_idx').on(t.created_at),
    index('upload_requests_updated_at_idx').on(t.updated_at),
  ],
)

export const usersRelations = relations(users, ({ many }) => ({
  presets: many(presets),
  batches: many(batches),
  uploadRequests: many(uploadRequests),
}))

export const presetsRelations = relations(presets, ({ one }) => ({
  user: one(users, { fields: [presets.userid], references: [users.userid] }),
}))

export const batchesRelations = relations(batches, ({ one, many }) => ({
  user: one(users, { fields: [batches.userid], references: [users.userid] }),
  uploadRequests: many(uploadRequests),
}))

export const uploadRequestsRelations = relations(uploadRequests, ({ one }) => ({
  user: one(users, {
    fields: [uploadRequests.userid],
    references: [users.userid],
  }),
  batch: one(batches, {
    fields: [uploadRequests.batchid],
    references: [batches.id],
  }),
}))
