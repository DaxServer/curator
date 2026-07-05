import { makeRedisMock } from '@backend/__tests__/helpers'
import {
  DuplicateUploadError,
  HashLockError,
  MediaWikiServerError,
  SourceCdnError,
  StorageError,
} from '@backend/core/errors'
import { MediaWikiClient, UPLOAD_CHUNK_FILE_EXCEPTION } from '@backend/mediawiki/client'
import { describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'

function mockFetch(body: unknown, status = 200) {
  globalThis.fetch = mock(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch
}

function mockFetchSequence(responses: { body: unknown; status?: number }[]) {
  let call = 0
  globalThis.fetch = mock(async () => {
    const r = responses[call] ?? responses[responses.length - 1]!
    call++
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 })
  }) as unknown as typeof fetch
}

function mockImageFetch() {
  globalThis.fetch = mock(
    async () => new Response(Buffer.from('data'), { status: 200 }),
  ) as unknown as typeof fetch
}

function callUploadFile(client: MediaWikiClient, redis: Redis) {
  return client.uploadFile(
    'test.jpg',
    'https://cdn.example/test.jpg',
    'wikitext',
    'summary',
    redis,
    1,
    1,
  )
}

function makeChunkUploadClient() {
  const client = new MediaWikiClient(['key', 'secret'])
  // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
  ;(client as any).getCsrfToken = mock(async () => 'test-token+\\')
  client.findDuplicates = mock(async () => [])
  mockImageFetch()
  const { redis } = makeRedisMock()
  return { client, redis }
}

describe('MediaWikiClient.uploadFile hash lock TTL', () => {
  it('acquires hash lock with a 600-second TTL', async () => {
    const client = new MediaWikiClient(['key', 'secret'])

    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'test-token+\\')
    client.findDuplicates = mock(async () => [])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async () => ({
      upload: {
        filekey: 'stash-key',
        result: 'Success',
        imageinfo: {
          url: 'https://upload.wikimedia.org/wikipedia/commons/t/te/test.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:test.jpg',
        },
      },
    }))

    globalThis.fetch = mock(
      async () => new Response(Buffer.from('tiny-file'), { status: 200 }),
    ) as unknown as typeof fetch

    const { redis, setMock } = makeRedisMock()
    await client.uploadFile(
      'test.jpg',
      'https://cdn.example/test.jpg',
      'wikitext',
      'summary',
      redis,
      1,
      1,
    )

    const allCalls = setMock.mock.calls as unknown as unknown[][]
    const lockSetCall = allCalls.find((args) => String(args[0]).startsWith('hashlock:'))

    expect(lockSetCall).toBeDefined()
    expect(lockSetCall?.[2]).toBe('EX')
    expect(lockSetCall?.[3]).toBe(600)
    expect(lockSetCall?.[4]).toBe('NX')
  })
})

describe('MediaWikiClient.uploadFile error paths', () => {
  it('throws SourceCdnError when source CDN resets the connection (ECONNRESET)', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const err = Object.assign(new Error('The socket connection was closed unexpectedly'), {
      code: 'ECONNRESET',
    })
    globalThis.fetch = mock(async () => {
      throw err
    }) as unknown as typeof fetch
    const { redis } = makeRedisMock()
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(SourceCdnError)
  })

  it('throws SourceCdnError when source CDN resets connection during body streaming (ECONNRESET on arrayBuffer)', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const err = Object.assign(new Error('The socket connection was closed unexpectedly'), {
      code: 'ECONNRESET',
    })
    globalThis.fetch = mock(async () => {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          throw err
        },
      } as unknown as Response
    }) as unknown as typeof fetch
    const { redis } = makeRedisMock()
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(SourceCdnError)
  })

  it('throws SourceCdnError when source URL returns 5xx', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({}, 503)
    const { redis } = makeRedisMock()
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(SourceCdnError)
  })

  it('throws DuplicateUploadError when SHA1 duplicate exists', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    client.findDuplicates = mock(async () => [
      { title: 'File:existing.jpg', url: 'https://commons.example/existing.jpg' },
    ])
    mockImageFetch()
    const { redis } = makeRedisMock()
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(DuplicateUploadError)
  })

  it('throws StorageError when chunk upload returns UploadChunkFileException', async () => {
    const { client, redis } = makeChunkUploadClient()
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async () => ({
      error: {
        code: UPLOAD_CHUNK_FILE_EXCEPTION,
        info: '[efdd458b-06ac-4570-9de1-ae31ca930397] Caught exception of type MediaWiki\\Upload\\Exception\\UploadChunkFileException',
      },
    }))
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(StorageError)
  })

  it('throws StorageError when final commit returns UploadChunkFileException', async () => {
    const { client, redis } = makeChunkUploadClient()
    let call = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async () => {
      if (++call === 1) return { upload: { filekey: 'stash-key', result: 'Continue' } }
      return {
        error: {
          code: UPLOAD_CHUNK_FILE_EXCEPTION,
          info: '[guid] Caught exception of type MediaWiki\\Upload\\Exception\\UploadChunkFileException',
        },
      }
    })
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(StorageError)
  })

  it('throws MediaWikiServerError when the chunk upload endpoint returns 5xx', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'test-token+\\')
    client.findDuplicates = mock(async () => [])
    let call = 0
    globalThis.fetch = mock(async () => {
      call++
      if (call === 1) return new Response(Buffer.from('data'), { status: 200 })
      return new Response('', { status: 503 })
    }) as unknown as typeof fetch
    const { redis } = makeRedisMock()
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(MediaWikiServerError)
  })

  it('throws HashLockError when lock is already held', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    client.findDuplicates = mock(async () => [])
    mockImageFetch()
    const setMock = mock(async () => null) // null = lock already held
    const redis = {
      get: mock(async () => null),
      set: setMock,
      del: mock(async () => 1),
    } as unknown as Redis
    await expect(callUploadFile(client, redis)).rejects.toBeInstanceOf(HashLockError)
  })
})

describe('MediaWikiClient.uploadFile chunked upload', () => {
  it('sends filekey on chunks after the first', async () => {
    const CHUNK_SIZE = 1024 * 1024
    const client = new MediaWikiClient(['key', 'secret'])

    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'test-token+\\')
    client.findDuplicates = mock(async () => [])

    const capturedFormDatas: FormData[] = []
    let chunkCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async (fd: FormData) => {
      capturedFormDatas.push(fd)
      chunkCall++
      return {
        upload: {
          filekey: `stash-key-${chunkCall}`,
          result: chunkCall < 2 ? 'Continue' : 'Success',
          imageinfo: {
            url: 'https://upload.wikimedia.org/wikipedia/commons/t/te/test.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:test.jpg',
          },
        },
      }
    })

    // 2 MB buffer → 2 chunks
    const twoMbBuffer = Buffer.alloc(CHUNK_SIZE * 2)
    globalThis.fetch = mock(
      async () => new Response(twoMbBuffer, { status: 200 }),
    ) as unknown as typeof fetch

    const { redis } = makeRedisMock()
    await client.uploadFile(
      'test.jpg',
      'https://cdn.example/test.jpg',
      'wikitext',
      'summary',
      redis,
      1,
      1,
    )

    // chunk 1: no filekey (offset=0)
    expect(capturedFormDatas[0]!.get('filekey')).toBeNull()
    // chunk 2: must carry the filekey returned by chunk 1
    expect(capturedFormDatas[1]!.get('filekey')).toBe('stash-key-1')
  })
})

describe('MediaWikiClient.uploadFile return value', () => {
  it('returns descriptionurl (file page URL) not url (raw image CDN URL)', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'test-token+\\')
    client.findDuplicates = mock(async () => [])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async () => ({
      upload: {
        filekey: 'stash-key',
        result: 'Success',
        imageinfo: {
          url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Photo.jpg',
          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
        },
      },
    }))
    globalThis.fetch = mock(
      async () => new Response(Buffer.from('tiny'), { status: 200 }),
    ) as unknown as typeof fetch

    const { redis } = makeRedisMock()
    const result = await client.uploadFile(
      'Photo.jpg',
      'https://cdn.example/Photo.jpg',
      'wikitext',
      'summary',
      redis,
      1,
      1,
    )

    expect(result).toBe('https://commons.wikimedia.org/wiki/File:Photo.jpg')
    expect(result).not.toContain('upload.wikimedia.org')
  })
})

describe('MediaWikiClient.findDuplicates', () => {
  it('returns descriptionurl (wiki page URL) not url (CDN URL)', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({
      query: {
        allimages: [
          {
            title: 'File:Photo.jpg',
            url: 'https://upload.wikimedia.org/wikipedia/commons/6/69/Photo.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
          },
        ],
      },
    })
    const dupes = await client.findDuplicates('abc123')
    expect(dupes[0]!.url).toBe('https://commons.wikimedia.org/wiki/File:Photo.jpg')
    expect(dupes[0]!.url).not.toContain('upload.wikimedia.org')
  })
})

describe('MediaWikiClient.uploadFile commit-time duplicate', () => {
  it('includes wiki page URL in duplicate links from commit warnings', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'test-token+\\')
    client.findDuplicates = mock(async () => [])

    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async () => ({
      upload: {
        filekey: 'stash-key',
        result: 'Warning',
        warnings: { duplicate: ['Photo from Mapillary 2017-06-24 (168951548443095).jpg'] },
      },
    }))

    globalThis.fetch = mock(
      async () => new Response(Buffer.from('tiny'), { status: 200 }),
    ) as unknown as typeof fetch

    const { redis } = makeRedisMock()
    let caught: unknown
    try {
      await client.uploadFile(
        'test.jpg',
        'https://cdn.example/test.jpg',
        'wikitext',
        'summary',
        redis,
        1,
        1,
      )
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(DuplicateUploadError)
    const err = caught as DuplicateUploadError
    // spaces → underscores, parentheses → %28/%29, colon → %3A
    expect(err.duplicates[0]!.url).toBe(
      'https://commons.wikimedia.org/wiki/File%3APhoto_from_Mapillary_2017-06-24_%28168951548443095%29.jpg',
    )
    expect(err.duplicates[0]!.url).not.toBe('')
    expect(err.duplicates[0]!.url).toContain('%28')
    expect(err.duplicates[0]!.url).toContain('%29')
  })
})

describe('MediaWikiClient.uploadFile CSRF retry', () => {
  it('retries a chunk upload with a fresh token when it returns badtoken', async () => {
    const { client, redis } = makeChunkUploadClient()
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    const capturedTokens: string[] = []
    let call = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async (fd: FormData) => {
      call++
      capturedTokens.push(fd.get('token') as string)
      if (call === 1) return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      if (call === 2) return { upload: { filekey: 'stash-key', result: 'Success' } }
      return {
        upload: {
          filekey: 'stash-key',
          result: 'Success',
          imageinfo: {
            url: 'https://upload.wikimedia.org/wikipedia/commons/t/te/test.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:test.jpg',
          },
        },
      }
    })

    const url = await callUploadFile(client, redis)

    expect(url).toBe('https://commons.wikimedia.org/wiki/File:test.jpg')
    // chunk step: token-1 fails, retries with token-2; commit step carries token-2 forward
    expect(capturedTokens).toEqual(['token-1', 'token-2', 'token-2'])
  })

  it('retries the commit request with a fresh token when it returns badtoken', async () => {
    const { client, redis } = makeChunkUploadClient()
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    const capturedTokens: string[] = []
    let call = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiUploadChunk = mock(async (fd: FormData) => {
      call++
      capturedTokens.push(fd.get('token') as string)
      if (call === 1) return { upload: { filekey: 'stash-key', result: 'Success' } }
      if (call === 2) return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return {
        upload: {
          filekey: 'stash-key',
          result: 'Success',
          imageinfo: {
            url: 'https://upload.wikimedia.org/wikipedia/commons/t/te/test.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:test.jpg',
          },
        },
      }
    })

    const url = await callUploadFile(client, redis)

    expect(url).toBe('https://commons.wikimedia.org/wiki/File:test.jpg')
    // chunk step succeeds with token-1; commit step fails once, retries with token-2
    expect(capturedTokens).toEqual(['token-1', 'token-1', 'token-2'])
  })
})

describe('MediaWikiClient.isCategoryDeleted', () => {
  it('returns true when logevents are present', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({ query: { logevents: [{ type: 'delete' }] } })
    expect(await client.isCategoryDeleted('Trees')).toBe(true)
  })

  it('returns false when no logevents', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({ query: { logevents: [] } })
    expect(await client.isCategoryDeleted('Trees')).toBe(false)
  })
})

describe('MediaWikiClient.checkTitleBlacklisted', () => {
  it('returns blacklisted=true with reason when title is blacklisted', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({ titleblacklist: { result: 'blacklisted', reason: 'Contains banned word' } })
    const result = await client.checkTitleBlacklisted('Bad Title.jpg')
    expect(result.blacklisted).toBe(true)
    expect(result.reason).toBe('Contains banned word')
  })

  it('returns blacklisted=false when title is allowed', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({ titleblacklist: { result: 'ok' } })
    const result = await client.checkTitleBlacklisted('Nice Photo.jpg')
    expect(result.blacklisted).toBe(false)
    expect(result.reason).toBe('')
  })
})

describe('MediaWikiClient.findDuplicates', () => {
  it('returns empty array when no duplicates', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({ query: { allimages: [] } })
    expect(await client.findDuplicates('abc123')).toEqual([])
  })

  it('returns duplicate titles and descriptionurl (wiki page URL)', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({
      query: {
        allimages: [
          {
            title: 'File:Dup.jpg',
            url: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Dup.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Dup.jpg',
          },
        ],
      },
    })
    const dupes = await client.findDuplicates('abc123')
    expect(dupes).toHaveLength(1)
    expect(dupes[0]!.title).toBe('File:Dup.jpg')
    expect(dupes[0]!.url).toBe('https://commons.wikimedia.org/wiki/File:Dup.jpg')
  })
})

describe('MediaWikiClient.getUserRateLimits', () => {
  it('returns ratelimits and rights from userinfo', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({
      query: {
        userinfo: {
          ratelimits: { upload: { user: { hits: 8, seconds: 60 } } },
          rights: ['upload', 'edit'],
        },
      },
    })
    const result = await client.getUserRateLimits()
    expect(result.rights).toContain('upload')
    expect(result.ratelimits.upload?.user?.hits).toBe(8)
  })

  it('returns empty ratelimits and rights when absent', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({ query: { userinfo: {} } })
    const result = await client.getUserRateLimits()
    expect(result.ratelimits).toEqual({})
    expect(result.rights).toEqual([])
  })
})

describe('MediaWikiClient.createPage', () => {
  it('returns title on successful page creation', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
      if (params.action === 'edit') return { edit: { title: 'Category:Trees' } }
      return {}
    })
    const title = await client.createPage('Category:Trees', '[[Category:Nature]]')
    expect(title).toBe('Category:Trees')
  })

  it('returns title without error when articleexists', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
      if (params.action === 'edit')
        return { error: { code: 'articleexists', info: 'Article already exists' } }
      return {}
    })
    const title = await client.createPage('Category:Trees', 'text')
    expect(title).toBe('Category:Trees')
  })

  it('throws on other edit errors', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
      if (params.action === 'edit')
        return { error: { code: 'permissiondenied', info: 'You do not have permission' } }
      return {}
    })
    await expect(client.createPage('Category:Trees', 'text')).rejects.toThrow(
      'You do not have permission',
    )
  })

  it('retries with a fresh token when the edit request returns badtoken', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    let apiCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => {
      apiCall++
      if (apiCall === 1) return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return { edit: { title: 'Test page' } }
    })

    const title = await client.createPage('Test page', 'wikitext')

    expect(apiCall).toBe(2)
    expect(title).toBe('Test page')
  })
})

describe('MediaWikiClient.getCategoryMembers', () => {
  it('returns all member titles in a single page', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetch({
      query: {
        categorymembers: [{ title: 'File:A.jpg' }, { title: 'File:B.jpg' }],
      },
    })
    const members = await client.getCategoryMembers('Trees')
    expect(members).toEqual(['File:A.jpg', 'File:B.jpg'])
  })

  it('paginates using cmcontinue until no continue key', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    mockFetchSequence([
      {
        body: {
          query: { categorymembers: [{ title: 'File:A.jpg' }] },
          continue: { cmcontinue: 'page2token' },
        },
      },
      {
        body: {
          query: { categorymembers: [{ title: 'File:B.jpg' }] },
        },
      },
    ])
    const members = await client.getCategoryMembers('Trees')
    expect(members).toEqual(['File:A.jpg', 'File:B.jpg'])
  })
})

describe('MediaWikiClient.applySdc', () => {
  it('calls wbeditentity without throwing on success', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    const apiRequestMock = mock(async () => ({}))
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = apiRequestMock
    await client.applySdc('Photo.jpg', [{ mainsnak: {} }], null, 'summary')
    expect(apiRequestMock).toHaveBeenCalled()
  })

  it('throws when wbeditentity returns an error', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => ({ error: { info: 'SDC error' } }))
    await expect(client.applySdc('Photo.jpg', null, null, 'summary')).rejects.toThrow('SDC error')
  })

  it('retries with a fresh token when the wbeditentity request returns badtoken', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    let apiCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => {
      apiCall++
      if (apiCall === 1) return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return {}
    })

    await client.applySdc('Test.jpg', null, null, 'summary')

    expect(apiCall).toBe(2)
  })
})

describe('MediaWikiClient.replaceCategoryInPage', () => {
  it('replaces category and returns true on success', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    const apiRequestMock = mock(async (params: Record<string, string>) => {
      if (params.action === 'query') {
        return {
          query: {
            pages: {
              '1': {
                revisions: [{ slots: { main: { content: '[[Category:Old Trees]]' } } }],
              },
            },
          },
        }
      }
      return {}
    })
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = apiRequestMock
    const result = await client.replaceCategoryInPage('File:A.jpg', 'Old Trees', 'New Trees')
    expect(result).toBe(true)
    expect(apiRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'edit' }),
      'POST',
      expect.objectContaining({ text: '[[Category:New Trees]]' }),
    )
  })

  it('returns false when category not found in wikitext', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => 'token+\\')
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
      if (params.action === 'query') {
        return {
          query: {
            pages: {
              '1': { revisions: [{ slots: { main: { content: '[[Category:Unrelated]]' } } }] },
            },
          },
        }
      }
      return {}
    })
    const result = await client.replaceCategoryInPage('File:A.jpg', 'Old Trees', 'New Trees')
    expect(result).toBe(false)
  })

  it('retries with a fresh token when the edit request returns badtoken', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    let apiCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => {
      apiCall++
      if (apiCall === 1) {
        return {
          query: {
            pages: {
              '1': { revisions: [{ slots: { main: { content: '[[Category:Old]]' } } }] },
            },
          },
        }
      }
      if (apiCall === 2) return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return {}
    })

    const replaced = await client.replaceCategoryInPage('File:Test.jpg', 'Old', 'New')

    expect(apiCall).toBe(3)
    expect(replaced).toBe(true)
  })
})

describe('MediaWikiClient.nullEdit retry', () => {
  const origSetTimeout = globalThis.setTimeout

  function makeQueryResponse() {
    return {
      query: {
        pages: { '1': { revisions: [{ slots: { main: { content: 'wikitext' } } }] } },
      },
    }
  }

  it('succeeds after transient failures within retry limit', async () => {
    globalThis.setTimeout = ((fn: () => void) => origSetTimeout(fn, 0)) as typeof setTimeout
    try {
      const client = new MediaWikiClient(['key', 'secret'])
      // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
      ;(client as any).getCsrfToken = mock(async () => 'token+\\')
      let editAttempts = 0
      // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
      ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
        if (params.action === 'query') return makeQueryResponse()
        editAttempts++
        if (editAttempts <= 2) throw new Error('transient network error')
        return {}
      })
      await expect(client.nullEdit('Photo.jpg')).resolves.toBeUndefined()
      expect(editAttempts).toBe(3)
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  it('throws after all retry attempts are exhausted', async () => {
    globalThis.setTimeout = ((fn: () => void) => origSetTimeout(fn, 0)) as typeof setTimeout
    try {
      const client = new MediaWikiClient(['key', 'secret'])
      // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
      ;(client as any).getCsrfToken = mock(async () => 'token+\\')
      // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
      ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
        if (params.action === 'query') return makeQueryResponse()
        throw new Error('persistent error')
      })
      await expect(client.nullEdit('Photo.jpg')).rejects.toThrow('persistent error')
    } finally {
      globalThis.setTimeout = origSetTimeout
    }
  })

  it('retries with a fresh token when the edit request returns badtoken', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    let apiCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async (params: Record<string, string>) => {
      if (params.action === 'query') return makeQueryResponse()
      apiCall++
      if (apiCall === 1) return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return {}
    })

    await client.nullEdit('Test.jpg')

    expect(apiCall).toBe(2)
  })
})

describe('MediaWikiClient.fetchSdc', () => {
  it('returns null when the entity is marked missing', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => ({
      entities: { 'File:Missing.jpg': { missing: true } },
    }))
    const result = await client.fetchSdc('Missing.jpg')
    expect(result).toBeNull()
  })

  it('uses a single wbgetentities call with sites=commonswiki and props=statements', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const apiRequest = mock(async () => ({
      entities: { M99: { type: 'mediainfo', id: 'M99', labels: {}, statements: {} } },
    }))
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = apiRequest
    await client.fetchSdc('Photo.jpg')
    expect(apiRequest).toHaveBeenCalledTimes(1)
    const calls = apiRequest.mock.calls as unknown as Array<[Record<string, string>]>
    expect(calls[0]![0]).toMatchObject({
      action: 'wbgetentities',
      sites: 'commonswiki',
      props: 'statements|labels',
    })
  })

  it('reads SDC from entity.statements (Commons MediaInfo format, not entity.claims)', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    const existingStatements = {
      P170: [
        {
          mainsnak: { snaktype: 'somevalue', property: 'P170' },
          id: 'M99$P170-abc',
          type: 'statement',
          rank: 'normal',
        },
      ],
    }
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => ({
      entities: {
        M99: { type: 'mediainfo', id: 'M99', labels: {}, statements: existingStatements },
      },
    }))
    const result = await client.fetchSdc('Photo.jpg')
    expect(result!.claims).toEqual(existingStatements)
  })

  it('returns empty claims when the entity has no statements yet', async () => {
    const client = new MediaWikiClient(['key', 'secret'])
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).apiRequest = mock(async () => ({
      entities: { M77: { type: 'mediainfo', id: 'M77', labels: {}, statements: {} } },
    }))
    const result = await client.fetchSdc('New.jpg')
    expect(result!.claims).toEqual({})
  })
})
