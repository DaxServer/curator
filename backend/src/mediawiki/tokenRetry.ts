import { logger } from '@backend/core/logger'

export async function withCsrfTokenRetry(
  label: string,
  getToken: () => Promise<string>,
  doRequest: (token: string) => Promise<Record<string, unknown>>,
  token?: string,
): Promise<{ result: Record<string, unknown>; token: string }> {
  token ??= await getToken()
  let result = await doRequest(token)
  const errorObj = result.error as Record<string, string> | undefined
  if (errorObj?.code === 'badtoken') {
    logger.warn(`${label} got badtoken, retrying with a fresh token`)
    token = await getToken()
    result = await doRequest(token)
  }
  return { result, token }
}
