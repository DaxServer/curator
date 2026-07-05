import { config } from '@backend/config'
import { buildAuthHeader } from '@backend/core/oauthClient'
import { WIKIDATA_PROPERTY } from '@backend/mediawiki/sdc'
import { withCsrfTokenRetry } from '@backend/mediawiki/tokenRetry'

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php'

export class WikidataClient {
  private accessToken: [string, string]

  constructor(accessToken: [string, string]) {
    this.accessToken = accessToken
  }

  private async getCsrfToken(): Promise<string> {
    const params = { action: 'query', meta: 'tokens', format: 'json' }
    const url = `${WIKIDATA_API}?${new URLSearchParams(params).toString()}`
    const authHeader = buildAuthHeader(
      'GET',
      url,
      config.oauthKey!,
      config.oauthSecret!,
      this.accessToken,
      undefined,
    )
    const res = await fetch(url, {
      headers: { Authorization: authHeader, 'User-Agent': config.userAgent },
    })
    if (!res.ok) throw new Error(`Wikidata CSRF token fetch failed: ${res.status}`)
    const data = (await res.json()) as Record<string, unknown>
    return ((data.query as Record<string, unknown>).tokens as Record<string, string>)
      .csrftoken as string
  }

  async fetchItem(qid: string): Promise<Record<string, unknown>> {
    const params = { action: 'wbgetentities', ids: qid, props: 'claims|sitelinks', format: 'json' }
    const url = `${WIKIDATA_API}?${new URLSearchParams(params).toString()}`
    const authHeader = buildAuthHeader(
      'GET',
      url,
      config.oauthKey!,
      config.oauthSecret!,
      this.accessToken,
      undefined,
    )
    const res = await fetch(url, {
      headers: { Authorization: authHeader, 'User-Agent': config.userAgent },
    })
    if (!res.ok) throw new Error(`Wikidata fetchItem failed: ${res.status}`)
    const data = (await res.json()) as Record<string, unknown>
    return (data.entities as Record<string, unknown>)[qid] as Record<string, unknown>
  }

  async addCommonsCategory(qid: string, categoryTitle: string): Promise<void> {
    const entity = await this.fetchItem(qid)
    const existingClaims =
      (entity.claims as Record<string, unknown[]>)?.[WIKIDATA_PROPERTY.CommonsCategory] ?? []
    const categoryName = categoryTitle.replace(/_/g, ' ')
    const alreadyExists = existingClaims.some(
      (c) =>
        (c as { mainsnak?: { datavalue?: { value?: unknown } } }).mainsnak?.datavalue?.value ===
        categoryName,
    )
    const newClaim = {
      mainsnak: {
        snaktype: 'value',
        property: WIKIDATA_PROPERTY.CommonsCategory,
        datavalue: { type: 'string', value: categoryName },
      },
      type: 'statement',
      rank: 'normal',
    }
    const claims = alreadyExists ? existingClaims : [...existingClaims, newClaim]
    const sitelinks = { commonswiki: { site: 'commonswiki', title: `Category:${categoryTitle}` } }
    await this.editItem(qid, claims, sitelinks)
  }

  private async postToWikidata(postData: Record<string, string>): Promise<Record<string, unknown>> {
    const queryParams = { action: 'wbeditentity', format: 'json' }
    const url = `${WIKIDATA_API}?${new URLSearchParams(queryParams).toString()}`
    const authHeader = buildAuthHeader(
      'POST',
      url,
      config.oauthKey!,
      config.oauthSecret!,
      this.accessToken,
      postData,
    )
    const body = new URLSearchParams(postData).toString()
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'User-Agent': config.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    if (!res.ok) throw new Error(`Wikidata editItem failed: ${res.status}`)
    return res.json() as Promise<Record<string, unknown>>
  }

  async editItem(
    qid: string,
    claims: unknown[] | null,
    sitelinks: Record<string, unknown> | null,
  ): Promise<void> {
    const payload: Record<string, unknown> = {}
    if (claims !== null) payload.claims = claims
    if (sitelinks !== null) payload.sitelinks = sitelinks

    const { result } = await withCsrfTokenRetry(
      `[wikidata] editItem ${qid}`,
      () => this.getCsrfToken(),
      (token) => this.postToWikidata({ id: qid, data: JSON.stringify(payload), token }),
    )
    if (result.error)
      throw new Error((result.error as Record<string, string>).info ?? 'Wikidata editItem failed')
  }
}
