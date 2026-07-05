import { WikidataClient } from '@backend/mediawiki/wikidata'
import { describe, expect, it, mock } from 'bun:test'

describe('WikidataClient.editItem', () => {
  it('retries with a fresh token when the response returns badtoken', async () => {
    const client = new WikidataClient(['key', 'secret'])
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => tokens[tokenCall++])
    const capturedTokens: string[] = []
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).postToWikidata = mock(async (postData: Record<string, string>) => {
      capturedTokens.push(postData.token)
      if (capturedTokens.length === 1) {
        return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      }
      return {}
    })

    await client.editItem('Q1', null, null)

    expect(capturedTokens).toEqual(['token-1', 'token-2'])
  })

  it('throws when the retry also returns badtoken', async () => {
    const client = new WikidataClient(['key', 'secret'])
    let tokenCall = 0
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).getCsrfToken = mock(async () => `token-${tokenCall++}`)
    // biome-ignore lint/suspicious/noExplicitAny: overriding private methods for testing
    ;(client as any).postToWikidata = mock(async () => ({
      error: { code: 'badtoken', info: 'Invalid CSRF token.' },
    }))

    await expect(client.editItem('Q1', null, null)).rejects.toThrow('Invalid CSRF token.')
  })
})
