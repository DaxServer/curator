import { lazyDb } from '@backend/db/client'
import { BatchService } from '@backend/db/dal/batches'
import { PresetService } from '@backend/db/dal/presets'
import { UploadService } from '@backend/db/dal/uploads'
import { UserService } from '@backend/db/dal/users'
import Elysia from 'elysia'

const db = lazyDb.client

export const dbPlugin = new Elysia({ name: 'db' }).decorate({
  batches: new BatchService(db),
  uploads: new UploadService(db),
  presets: new PresetService(db),
  users: new UserService(db),
})
