import { withCsrfTokenRetry } from '@backend/mediawiki/tokenRetry'
import { describe, expect, it, mock } from 'bun:test'

describe('withCsrfTokenRetry', () => {
  it('fetches a token and retries once with a fresh one when the response is badtoken', async () => {
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    const getToken = mock(async () => tokens[tokenCall++]!)
    const capturedTokens: string[] = []
    const doRequest = mock(async (token: string) => {
      capturedTokens.push(token)
      if (capturedTokens.length === 1)
        return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return { edit: { title: 'Test' } }
    })

    const { result, token } = await withCsrfTokenRetry('test', getToken, doRequest)

    expect(capturedTokens).toEqual(['token-1', 'token-2'])
    expect(token).toBe('token-2')
    expect((result.edit as { title: string }).title).toBe('Test')
  })

  it('gives up after one retry and returns the error result when both attempts fail', async () => {
    let tokenCall = 0
    const getToken = mock(async () => `token-${tokenCall++}`)
    let apiCall = 0
    const doRequest = mock(async () => {
      apiCall++
      return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
    })

    const { result } = await withCsrfTokenRetry('test', getToken, doRequest)

    expect(apiCall).toBe(2)
    expect(tokenCall).toBe(2)
    expect((result.error as { code: string }).code).toBe('badtoken')
  })

  it('reuses a provided token and only fetches a new one on retry', async () => {
    const tokens = ['token-1', 'token-2']
    let tokenCall = 0
    const getToken = mock(async () => tokens[tokenCall++]!)
    const capturedTokens: string[] = []
    const doRequest = mock(async (token: string) => {
      capturedTokens.push(token)
      if (capturedTokens.length === 1)
        return { error: { code: 'badtoken', info: 'Invalid CSRF token.' } }
      return { upload: { result: 'Success' } }
    })

    const { result, token } = await withCsrfTokenRetry('test', getToken, doRequest, 'token-0')

    expect(capturedTokens).toEqual(['token-0', 'token-1'])
    expect(token).toBe('token-1')
    expect((result.upload as { result: string }).result).toBe('Success')
  })

  it('does not fetch a new token when the first response succeeds', async () => {
    const getToken = mock(async () => {
      throw new Error('should not be called')
    })
    const doRequest = mock(async () => ({ upload: { result: 'Success' } }))

    const { result, token } = await withCsrfTokenRetry('test', getToken, doRequest, 'token-0')

    expect(token).toBe('token-0')
    expect((result.upload as { result: string }).result).toBe('Success')
  })
})
