import { config } from '@backend/config'
import type { DuplicateLink } from '@backend/core/errors'
import {
  DuplicateUploadError,
  HashLockError,
  SourceCdnError,
  StorageError,
} from '@backend/core/errors'
import { buildAuthHeader } from '@backend/core/oauthClient'
import { logger } from '@backend/logger'
import type { Redis } from 'ioredis'
import { createHash } from 'node:crypto'

const CHUNK_SIZE = 1024 * 1024
const STASH_RETRY_LIMIT = 2
const STASH_RETRY_DELAY_MS = 2000

export class MediaWikiClient {
  private accessToken: [string, string]

  constructor(accessToken: [string, string]) {
    this.accessToken = accessToken
  }

  private async apiRequest(
    params: Record<string, string>,
    method = 'GET',
    postData?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const baseParams = { format: 'json', formatversion: '2', ...params }
    const url = `${config.wikimediaUrls.baseUrl}?${new URLSearchParams(baseParams).toString()}`
    const authHeader = buildAuthHeader(
      method,
      url,
      config.oauthKey!,
      config.oauthSecret!,
      this.accessToken,
      method === 'POST' ? postData : undefined,
    )
    const headers: Record<string, string> = {
      Authorization: authHeader,
      'User-Agent': config.userAgent,
    }
    let body: BodyInit | undefined
    if (method === 'POST' && postData) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(postData).toString()
    }
    const res = await fetch(url, { method, headers, body })
    if (!res.ok) throw new Error(`MediaWiki API request failed: ${res.status}`)
    return res.json() as Promise<Record<string, unknown>>
  }

  private async getCsrfToken(): Promise<string> {
    const result = await this.apiRequest({ action: 'query', meta: 'tokens' })
    return ((result.query as Record<string, unknown>).tokens as Record<string, string>)
      .csrftoken as string
  }

  async createPage(title: string, text: string): Promise<string> {
    const token = await this.getCsrfToken()
    const result = await this.apiRequest({ action: 'edit' }, 'POST', {
      title,
      text,
      createonly: '1',
      token,
    })
    if (result.error) {
      if ((result.error as Record<string, string>).code === 'articleexists') return title
      throw new Error((result.error as Record<string, string>).info ?? 'Edit failed')
    }
    return (result.edit as Record<string, string>).title as string
  }

  async isCategoryDeleted(title: string): Promise<boolean> {
    const result = await this.apiRequest({
      action: 'query',
      list: 'logevents',
      letype: 'delete',
      letitle: `Category:${title}`,
    })
    const logevents = ((result.query as Record<string, unknown>).logevents as unknown[]) ?? []
    return logevents.length > 0
  }

  async getCategoryMembers(category: string): Promise<string[]> {
    const baseParams: Record<string, string> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmtype: 'file',
      cmlimit: '500',
    }
    const titles: string[] = []
    let params = { ...baseParams }
    while (true) {
      const result = await this.apiRequest(params)
      if (result.error)
        throw new Error(
          (result.error as Record<string, string>).info ?? 'Failed to fetch category members',
        )
      const members =
        ((result.query as Record<string, unknown>).categorymembers as Array<
          Record<string, string>
        >) ?? []
      for (const m of members) titles.push(m.title!)
      if (!result.continue) {
        logger.info(`Retrieved ${titles.length} file titles in [[Category:${category}]]`)
        break
      }
      params = {
        ...baseParams,
        cmcontinue: (result.continue as Record<string, string>).cmcontinue as string,
      }
    }
    return titles
  }

  private async apiUploadChunk(formData: FormData): Promise<Record<string, unknown>> {
    const baseParams = { format: 'json', formatversion: '2' }
    const url = `${config.wikimediaUrls.baseUrl}?${new URLSearchParams(baseParams).toString()}`
    const authHeader = buildAuthHeader(
      'POST',
      url,
      config.oauthKey!,
      config.oauthSecret!,
      this.accessToken,
    )
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'User-Agent': config.userAgent,
      },
      body: formData,
    })
    if (!res.ok) throw new Error(`MediaWiki upload request failed: ${res.status}`)
    return res.json() as Promise<Record<string, unknown>>
  }

  async getUserRateLimits(): Promise<{
    ratelimits: Record<string, Record<string, { hits: number; seconds: number }>>
    rights: string[]
  }> {
    const result = await this.apiRequest({
      action: 'query',
      meta: 'userinfo',
      uiprop: 'ratelimits|rights',
    })
    const userinfo = (result.query as Record<string, unknown>).userinfo as Record<string, unknown>
    return {
      ratelimits: (userinfo.ratelimits ?? {}) as Record<
        string,
        Record<string, { hits: number; seconds: number }>
      >,
      rights: (userinfo.rights ?? []) as string[],
    }
  }

  async checkTitleBlacklisted(filename: string): Promise<{ blacklisted: boolean; reason: string }> {
    const result = await this.apiRequest({
      action: 'titleblacklist',
      tbaction: 'create',
      tbtitle: `File:${filename}`,
    })
    const tb = result.titleblacklist as Record<string, string> | undefined
    if (tb && tb.result === 'blacklisted') {
      return { blacklisted: true, reason: tb.reason ?? 'Title is blacklisted' }
    }
    return { blacklisted: false, reason: '' }
  }

  async findDuplicates(fileHash: string): Promise<Array<{ title: string; url: string }>> {
    const result = await this.apiRequest({
      action: 'query',
      list: 'allimages',
      aisha1: fileHash,
    })
    const allimages =
      ((result.query as Record<string, unknown>).allimages as Array<Record<string, string>>) ?? []
    return allimages.map((img) => ({ title: img.title!, url: img.url! }))
  }

  async uploadFile(
    filename: string,
    fileUrl: string,
    wikitext: string,
    editSummary: string,
    redis: Redis,
    uploadId: number,
    batchId: number,
  ): Promise<string> {
    const downloadRes = await fetch(fileUrl, { headers: { 'User-Agent': config.userAgent } })
    if (!downloadRes.ok) {
      if (downloadRes.status >= 500)
        throw new SourceCdnError(`Source CDN error: ${downloadRes.status}`)
      throw new Error(`Failed to download file: ${downloadRes.status}`)
    }
    const buffer = Buffer.from(await downloadRes.arrayBuffer())
    const sha1 = createHash('sha1').update(buffer).digest('hex')
    const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE)
    logger.info(`Uploading ${filename} (${buffer.length} bytes) in ${totalChunks} chunks`)

    const duplicates = await this.findDuplicates(sha1)
    if (duplicates.length > 0) {
      throw new DuplicateUploadError(
        duplicates as DuplicateLink[],
        `File already exists on Commons (uploadId=${uploadId}, batchId=${batchId})`,
      )
    }

    const lockKey = `hashlock:${sha1}`
    const locked = await redis.set(lockKey, '1', 'EX', 600, 'NX')
    if (!locked) throw new HashLockError(`Hash lock already held for ${sha1}`)

    try {
      const token = await this.getCsrfToken()
      const filesize = buffer.length
      let stashKey = ''

      for (let offset = 0; offset < filesize; offset += CHUNK_SIZE) {
        const chunk = buffer.subarray(offset, offset + CHUNK_SIZE)
        const formData = new FormData()
        formData.append('action', 'upload')
        formData.append('stash', '1')
        formData.append('offset', String(offset))
        formData.append('filesize', String(filesize))
        formData.append('filename', filename)
        formData.append('text', wikitext)
        formData.append('comment', editSummary)
        formData.append('token', token)
        formData.append('chunk', new Blob([chunk]), filename)

        const result = await this.apiUploadChunk(formData)
        const errorObj = result.error as Record<string, string> | undefined
        if (errorObj) {
          if (errorObj.code === 'uploadstash-exception')
            throw new StorageError(errorObj.info ?? 'Stash exception')
          throw new Error(errorObj.info ?? 'Upload chunk failed')
        }
        const upload = result.upload as Record<string, unknown>
        stashKey = upload.filekey as string
        const chunkNum = offset / CHUNK_SIZE + 1
        logger.info(`Uploaded chunk ${chunkNum}/${totalChunks} filekey: ${stashKey}`)
      }

      logger.info(`Final commit for ${filename} with filekey ${stashKey}`)
      let commitResult: Record<string, unknown> | null = null
      for (let attempt = 0; attempt <= STASH_RETRY_LIMIT; attempt++) {
        const formData = new FormData()
        formData.append('action', 'upload')
        formData.append('filename', filename)
        formData.append('comment', editSummary)
        formData.append('text', wikitext)
        formData.append('filekey', stashKey)
        formData.append('token', token)

        const result = await this.apiUploadChunk(formData)
        const errorObj = result.error as Record<string, string> | undefined
        if (errorObj) {
          if (errorObj.code === 'uploadstash-file-not-found' && attempt < STASH_RETRY_LIMIT) {
            logger.warn(
              `uploadstash-file-not-found on attempt ${attempt + 1}, retrying in ${STASH_RETRY_DELAY_MS}ms`,
            )
            await new Promise((resolve) => setTimeout(resolve, STASH_RETRY_DELAY_MS))
            continue
          }
          if (errorObj.code === 'uploadstash-exception')
            throw new StorageError(errorObj.info ?? 'Stash exception')
          throw new Error(errorObj.info ?? 'Upload commit failed')
        }
        const upload = result.upload as Record<string, unknown>
        if (upload.result === 'Success') {
          commitResult = result
          break
        }
        const warnings = upload.warnings as Record<string, unknown> | undefined
        if (warnings?.duplicate) {
          const dupes = (warnings.duplicate as string[]).map((t) => ({ title: t, url: '' }))
          throw new DuplicateUploadError(
            dupes,
            `Duplicate detected during commit (uploadId=${uploadId})`,
          )
        }
        throw new Error(`Unexpected upload result: ${upload.result}`)
      }

      if (!commitResult) throw new StorageError('Upload commit failed after retries')
      const upload = commitResult.upload as Record<string, unknown>
      const imageinfo = upload.imageinfo as Record<string, string>
      await redis.del(lockKey)
      return imageinfo.url!
    } catch (err) {
      await redis.del(lockKey)
      throw err
    }
  }

  async applySdc(
    filename: string,
    claims: unknown[] | null,
    labels: Record<string, { language: string; value: string }> | null,
    editSummary: string,
  ): Promise<void> {
    const token = await this.getCsrfToken()
    const payload: Record<string, unknown> = {}
    if (claims) payload.claims = claims
    if (labels) payload.labels = labels
    const result = await this.apiRequest(
      { action: 'wbeditentity', site: 'commonswiki', title: `File:${filename}` },
      'POST',
      { data: JSON.stringify(payload), summary: editSummary, token },
    )
    if (result.error)
      throw new Error((result.error as Record<string, string>).info ?? 'wbeditentity failed')
    logger.info(`SDC applied to ${filename}`)
  }

  async nullEdit(filename: string): Promise<void> {
    const pageResult = await this.apiRequest({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: `File:${filename}`,
    })
    const pages = (pageResult.query as Record<string, unknown>).pages as Record<string, unknown>
    const page = Object.values(pages)[0] as Record<string, unknown>
    const revisions = (page.revisions as Array<Record<string, unknown>>) ?? []
    const slots = (revisions[0]?.slots as Record<string, unknown>) ?? {}
    const mainSlot = (slots.main as Record<string, unknown>) ?? {}
    const content = (mainSlot.content as string) ?? ''
    const token = await this.getCsrfToken()
    await this.apiRequest({ action: 'edit' }, 'POST', {
      title: `File:${filename}`,
      text: content,
      summary: 'null edit',
      bot: '0',
      token,
    })
    logger.info(`Null edit performed on ${filename}`)
  }

  async fetchSdc(
    title: string,
  ): Promise<{ claims: Record<string, unknown[]>; labels: Record<string, unknown> } | null> {
    const result = await this.apiRequest({
      action: 'wbgetentities',
      sites: 'commonswiki',
      titles: `File:${title}`,
      props: 'claims|labels',
    })
    const entities = result.entities as Record<string, Record<string, unknown>>
    const entity = Object.values(entities)[0]
    if (!entity || 'missing' in entity) return null
    return {
      claims: (entity.claims ?? {}) as Record<string, unknown[]>,
      labels: (entity.labels ?? {}) as Record<string, unknown>,
    }
  }

  async replaceCategoryInPage(title: string, source: string, target: string): Promise<boolean> {
    const result = await this.apiRequest({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: title,
    })
    if (result.error) return false
    const pages = (result.query as Record<string, unknown>).pages as Record<string, unknown>
    const page = Object.values(pages)[0] as Record<string, unknown>
    const revisions = (page.revisions as Array<Record<string, unknown>>) ?? []
    const slots = (revisions[0]?.slots as Record<string, unknown>) ?? {}
    const mainSlot = (slots.main as Record<string, unknown>) ?? {}
    // formatversion=2 uses .content
    const wikitext = (mainSlot.content as string) ?? ''

    const sourceNormalized = source.replace(/_/g, ' ')
    const targetNormalized = target.replace(/_/g, ' ')
    const sourceWords = sourceNormalized
      .split(' ')
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const sourceRegex = sourceWords.join('(?:_| )')
    const pattern = new RegExp(`\\[\\[Category:${sourceRegex}(\\|[^\\]]+)?\\]\\]`, 'gi')

    if (!pattern.test(wikitext)) return false
    pattern.lastIndex = 0
    const newText = wikitext.replace(
      pattern,
      (_match, alias) => `[[Category:${targetNormalized}${alias ?? ''}]]`,
    )

    const token = await this.getCsrfToken()
    const editResult = await this.apiRequest({ action: 'edit' }, 'POST', {
      title,
      text: newText,
      summary: `Recategorize: [[Category:${sourceNormalized}]] → [[Category:${targetNormalized}]]`,
      token,
    })
    if (editResult.error) return false
    logger.info(
      `Recategorized ${title} from [[Category:${sourceNormalized}]] to [[Category:${targetNormalized}]]`,
    )
    return true
  }
}
