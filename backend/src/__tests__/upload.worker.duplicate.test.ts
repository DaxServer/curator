// Upload worker — duplicate-handling path.
//
// When a file already exists on Commons the worker fetches the existing SDC,
// computes a delta via mergeSdcStatements(), and only calls applySdc() if
// something is missing or out of date.
//
// mock.module() is intentionally avoided for @backend/core/crypto and
// @backend/mediawiki/client (both imported directly by other test files).
// Instead, WorkerDeps injection supplies mock implementations inline.
// @backend/handlers/mapillary is module-mocked here because no other test
// file imports it directly.

import { DuplicateUploadError } from '@backend/core/errors'
import type { MediaWikiClient } from '@backend/mediawiki/client'
import { buildStatementsFromMapillaryImage } from '@backend/mediawiki/sdc'
import type { MediaImage } from '@backend/types/ws'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { Redis } from 'ioredis'

// ── safe module mocks (not imported directly by other test files) ─────────────

let capturedProcessor: ((job: unknown) => Promise<void>) | undefined

mock.module('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<void>) {
      capturedProcessor = processor
    }
    on() {}
  },
}))

mock.module('@backend/db/client', () => ({ lazyDb: { client: {} } }))

const mockUpdateStatus = mock(async () => {})
const mockClearToken = mock(async () => {})
const mockGetById = mock(async (_id: number) => null as unknown)

mock.module('@backend/db/dal/uploads', () => ({
  UploadService: class {
    updateUploadStatus = mockUpdateStatus
    clearUploadAccessToken = mockClearToken
    getUploadById = mockGetById
  },
}))

// MapillaryHandler is NOT imported by any other test file — safe to mock.
const FAKE_IMAGE: MediaImage = {
  id: 'seq-abc123',
  title: 'test.jpg',
  dates: { taken: '2023-06-15T10:00:00Z' },
  creator: { id: 'u1', username: 'photographer', profile_url: 'https://www.mapillary.com/app/user/photographer' },
  location: { latitude: 48.85, longitude: 2.35, compass_angle: 90 },
  urls: {
    url: 'https://www.mapillary.com/app/?pKey=seq-abc123',
    original: 'https://cdn.mapillary.com/seq-abc123/original.jpg',
    preview: 'https://cdn.mapillary.com/seq-abc123/preview.jpg',
    thumbnail: 'https://cdn.mapillary.com/seq-abc123/thumb.jpg',
  },
  dimensions: { width: 4096, height: 2048 },
  camera: { make: 'Sony', model: 'RX0', is_pano: false },
  existing: [],
}

mock.module('@backend/handlers/mapillary', () => ({
  MapillaryHandler: class {
    async fetchImagesBatch() {
      return [FAKE_IMAGE]
    }
  },
}))

import { createUploadWorker } from '@backend/workers/upload.worker'

// ── helpers ──────────────────────────────────────────────────────────────────

const DUPE_LINKS = [{ title: 'File:Existing.jpg', url: 'https://commons.wikimedia.org/wiki/File:Existing.jpg' }]

function makeJob(uploadId = 1) {
  return { id: `job-${uploadId}`, data: { uploadId, batchId: 1, editGroupId: 'eg-abc' } }
}

function makeUpload(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    key: 'seq-abc123',
    filename: 'Test photo.jpg',
    wikitext: '== Description ==\nTest',
    access_token: 'encrypted-token',
    status: 'pending',
    collection: null,
    labels: null,
    copyright_override: false,
    ...overrides,
  }
}

/** Build a mock MediaWikiClient with injectable method overrides. */
function makeClientStub(overrides: Partial<{
  checkTitleBlacklisted: () => Promise<{ blacklisted: boolean; reason: string }>
  uploadFile: () => Promise<string>
  fetchSdc: () => Promise<{ claims: Record<string, unknown[]>; labels: Record<string, unknown> } | null>
  applySdc: (...args: unknown[]) => Promise<void>
  nullEdit: () => Promise<void>
}> = {}): MediaWikiClient {
  return {
    checkTitleBlacklisted: overrides.checkTitleBlacklisted ?? (async () => ({ blacklisted: false, reason: '' })),
    uploadFile: overrides.uploadFile ?? (async () => { throw new DuplicateUploadError(DUPE_LINKS, 'dup') }),
    fetchSdc: overrides.fetchSdc ?? (async () => null),
    applySdc: overrides.applySdc ?? (async () => {}),
    nullEdit: overrides.nullEdit ?? (async () => {}),
  } as unknown as MediaWikiClient
}

/** Simulate what fetchSdc() returns: same statements but with Wikidata IDs added. */
function simulateExistingSdc(
  statements: unknown[],
): Record<string, unknown[]> {
  const grouped: Record<string, unknown[]> = {}
  for (const stmt of statements as Array<{ mainsnak: { property: string }; [k: string]: unknown }>) {
    const prop = stmt.mainsnak.property
    if (!grouped[prop]) grouped[prop] = []
    grouped[prop].push({ ...stmt, id: `M1$${prop}-existing` })
  }
  return grouped
}

function setupWorker(clientStub: MediaWikiClient, uploadOverrides: Record<string, unknown> = {}) {
  mockUpdateStatus.mockClear()
  mockClearToken.mockClear()
  mockGetById.mockClear()
  capturedProcessor = undefined

  mockGetById.mockImplementation(async () => makeUpload(uploadOverrides))

  createUploadWorker({} as Redis, {
    decryptToken: () => ['tok-key', 'tok-secret'],
    makeClient: () => clientStub,
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('upload worker — duplicate path: fetchSdc is called before applySdc', () => {
  it('calls fetchSdc on the duplicate filename when DuplicateUploadError is caught', async () => {
    const fetchSdc = mock(async () => null)
    const stub = makeClientStub({ fetchSdc })
    setupWorker(stub)

    await capturedProcessor!(makeJob())

    expect(fetchSdc).toHaveBeenCalledTimes(1)
    // The duplicate filename is derived by stripping the File: prefix
    const fetchCalls = fetchSdc.mock.calls as unknown as unknown[][]
    expect(fetchCalls[0]![0]).toBe('Existing.jpg')
  })
})

describe('upload worker — duplicate path: skips applySdc when SDC is already up to date', () => {
  it('does NOT call applySdc and sets duplicated_sdc_not_updated when delta is empty', async () => {
    const newClaims = buildStatementsFromMapillaryImage(FAKE_IMAGE, true)
    const existingClaims = simulateExistingSdc(newClaims)

    const applySdc = mock(async () => {})
    const stub = makeClientStub({
      fetchSdc: async () => ({ claims: existingClaims, labels: {} }),
      applySdc,
    })
    setupWorker(stub)

    await capturedProcessor!(makeJob())

    // applySdc must not be called when the delta is empty.
    expect(applySdc).not.toHaveBeenCalled()
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      1,
      'duplicated_sdc_not_updated',
      expect.objectContaining({ type: 'duplicated_sdc_not_updated' }),
    )
  })
})

describe('upload worker — duplicate path: sends only missing statements to applySdc', () => {
  it('calls applySdc with only the properties absent from existing SDC', async () => {
    const newClaims = buildStatementsFromMapillaryImage(FAKE_IMAGE, true) as Array<{
      mainsnak: { property: string }
      [k: string]: unknown
    }>

    // Pre-populate all properties EXCEPT P1947 (Mapillary Photo ID)
    const existingClaims = simulateExistingSdc(newClaims.filter((s) => s.mainsnak.property !== 'P1947'))

    const applySdc = mock(async () => {})
    const stub = makeClientStub({
      fetchSdc: async () => ({ claims: existingClaims, labels: {} }),
      applySdc,
    })
    setupWorker(stub)

    await capturedProcessor!(makeJob())

    expect(applySdc).toHaveBeenCalledTimes(1)

    // Only the missing property should appear in the delta, not the entire claim set.
    const applyCalls = applySdc.mock.calls as unknown as unknown[][]
    const claimsArg = applyCalls[0]![1] as Array<{ mainsnak: { property: string } }>
    expect(claimsArg).toHaveLength(1)
    expect(claimsArg[0]!.mainsnak.property).toBe('P1947')

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      1,
      'duplicated_sdc_updated',
      expect.objectContaining({ type: 'duplicated_sdc_updated' }),
    )
  })
})

describe('upload worker — duplicate path: all claims sent when fetchSdc returns null', () => {
  it('calls applySdc with all generated claims when no prior SDC exists', async () => {
    const applySdc = mock(async () => {})
    const stub = makeClientStub({
      fetchSdc: async () => null,
      applySdc,
    })
    setupWorker(stub)

    await capturedProcessor!(makeJob())

    expect(applySdc).toHaveBeenCalledTimes(1)
    const applyCalls = applySdc.mock.calls as unknown as unknown[][]
    const claimsArg = applyCalls[0]![1] as unknown[]
    expect(claimsArg.length).toBeGreaterThan(0)

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      1,
      'duplicated_sdc_updated',
      expect.objectContaining({ type: 'duplicated_sdc_updated' }),
    )
  })
})

describe('upload worker — duplicate path: label delta respected', () => {
  it('calls applySdc with labelsDelta when label is absent from existing SDC', async () => {
    const newClaims = buildStatementsFromMapillaryImage(FAKE_IMAGE, true)
    const existingClaims = simulateExistingSdc(newClaims)

    const applySdc = mock(async () => {})
    const stub = makeClientStub({
      // Claims are up to date, but labels have no English entry yet
      fetchSdc: async () => ({ claims: existingClaims, labels: {} }),
      applySdc,
    })
    setupWorker(stub, { labels: { language: 'en', value: 'My photo' } })

    await capturedProcessor!(makeJob())

    expect(applySdc).toHaveBeenCalledTimes(1)
    const applyCalls = applySdc.mock.calls as unknown as unknown[][]
    const labelsArg = applyCalls[0]![2] as Record<string, { value: string }>
    expect(labelsArg?.en?.value).toBe('My photo')
  })

  it('skips applySdc when claims and labels are both already up to date', async () => {
    const newClaims = buildStatementsFromMapillaryImage(FAKE_IMAGE, true)
    const existingClaims = simulateExistingSdc(newClaims)

    const applySdc = mock(async () => {})
    const stub = makeClientStub({
      fetchSdc: async () => ({
        claims: existingClaims,
        labels: { en: { language: 'en', value: 'My photo' } },
      }),
      applySdc,
    })
    setupWorker(stub, { labels: { language: 'en', value: 'My photo' } })

    await capturedProcessor!(makeJob())

    expect(applySdc).not.toHaveBeenCalled()
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      1,
      'duplicated_sdc_not_updated',
      expect.anything(),
    )
  })
})
