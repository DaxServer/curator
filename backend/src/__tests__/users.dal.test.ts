import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('ensureUser', () => {
  it('uses VALUES(username) on conflict so renames are persisted', () => {
    const src = readFileSync(resolve(import.meta.dir, '../db/dal/users.ts'), 'utf-8')
    // sql`username` is a MySQL self-assignment no-op; sql`VALUES(username)` picks up the new value.
    expect(src).toContain('sql`VALUES(username)`')
  })
})
