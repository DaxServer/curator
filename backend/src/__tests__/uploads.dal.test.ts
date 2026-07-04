import type { DB } from '@backend/db/client'
import { UploadService } from '@backend/db/dal/uploads'
import type { Handler, UploadItem } from '@backend/types/ws'
import { describe, expect, it, mock } from 'bun:test'

const makeItem = (id: string): UploadItem => ({
  id,
  input: 'col-1',
  title: `${id}.jpg`,
  wikitext: '== wikitext ==',
  labels: null,
  copyright_override: false,
})

const BASE_PARAMS = {
  userid: 'u1',
  username: 'alice',
  batchid: 42,
  handler: 'mapillary' as Handler,
  encryptedAccessToken: 'tok',
}

const makeDb = ({
  preExisting,
  existing,
}: {
  preExisting: { key: string }[]
  existing: { id: number; key: string; status: string }[]
}) => {
  const insertChain = {
    values: mock(() => insertChain),
    onDuplicateKeyUpdate: mock(() => Promise.resolve()),
  }
  const preExistingChain = {
    from: mock(() => preExistingChain),
    where: mock(() => Promise.resolve(preExisting)),
  }
  const existingChain = {
    from: mock(() => existingChain),
    where: mock(() => existingChain),
    orderBy: mock(() => Promise.resolve(existing)),
  }
  let selectCallCount = 0
  const db = {
    insert: mock(() => insertChain),
    select: mock(() => {
      selectCallCount += 1
      return selectCallCount % 2 === 1 ? preExistingChain : existingChain
    }),
  } as unknown as DB
  return { db, insertChain, preExistingChain, existingChain }
}

describe('createUploadRequestsForBatch', () => {
  it('returns empty array and skips DB when items list is empty', async () => {
    const { db } = makeDb({ preExisting: [], existing: [] })
    const service = new UploadService(db)
    const result = await service.createUploadRequestsForBatch({ ...BASE_PARAMS, items: [] })
    expect(result).toEqual([])
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.select).not.toHaveBeenCalled()
  })

  it('marks freshly inserted rows as new with queued status', async () => {
    const { db } = makeDb({
      preExisting: [],
      existing: [
        { id: 1, key: 'img-1', status: 'queued' },
        { id: 2, key: 'img-2', status: 'queued' },
      ],
    })
    const service = new UploadService(db)
    const result = await service.createUploadRequestsForBatch({
      ...BASE_PARAMS,
      items: [makeItem('img-1'), makeItem('img-2')],
    })
    expect(result).toEqual([
      { id: 1, key: 'img-1', status: 'queued', isNew: true },
      { id: 2, key: 'img-2', status: 'queued', isNew: true },
    ])
  })

  it('uses onDuplicateKeyUpdate so the same slice can be resent on reconnect', async () => {
    const { db, insertChain } = makeDb({
      preExisting: [],
      existing: [{ id: 1, key: 'img-1', status: 'queued' }],
    })
    const service = new UploadService(db)
    const params = { ...BASE_PARAMS, items: [makeItem('img-1')] }

    await service.createUploadRequestsForBatch(params)
    await service.createUploadRequestsForBatch(params)

    expect(db.insert).toHaveBeenCalledTimes(2)
    expect(insertChain.onDuplicateKeyUpdate).toHaveBeenCalledTimes(2)
  })

  it('marks a resent row as not new and reports its real current status', async () => {
    const { db } = makeDb({
      preExisting: [{ key: 'img-1' }],
      existing: [{ id: 1, key: 'img-1', status: 'in_progress' }],
    })
    const service = new UploadService(db)
    const params = { ...BASE_PARAMS, items: [makeItem('img-1')] }

    const result = await service.createUploadRequestsForBatch(params)

    expect(result).toEqual([{ id: 1, key: 'img-1', status: 'in_progress', isNew: false }])
  })

  it('reports a mix of new and resent rows independently within the same slice', async () => {
    const { db } = makeDb({
      preExisting: [{ key: 'img-1' }],
      existing: [
        { id: 1, key: 'img-1', status: 'completed' },
        { id: 2, key: 'img-2', status: 'queued' },
      ],
    })
    const service = new UploadService(db)
    const params = { ...BASE_PARAMS, items: [makeItem('img-1'), makeItem('img-2')] }

    const result = await service.createUploadRequestsForBatch(params)

    expect(result).toEqual([
      { id: 1, key: 'img-1', status: 'completed', isNew: false },
      { id: 2, key: 'img-2', status: 'queued', isNew: true },
    ])
  })
})
