import { Elysia } from 'elysia'
import pino from 'pino'
import pretty from 'pino-pretty'

const isTest = Bun.env.NODE_ENV === 'test'
const isWorker = Bun.argv[2] === 'worker'
const isToolforge = !!Bun.env.TOOL_DATA_DIR
const level = Bun.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info')

// pino transport uses worker threads and cannot resolve module paths inside a
// bundled binary; pretty() creates a synchronous in-process stream instead
export const logger = isTest
  ? pino({ level })
  : pino(
      { level },
      pretty({
        singleLine: true,
        ignore: isToolforge && !isWorker ? 'pid,hostname,time' : 'pid,hostname',
        translateTime: 'SYS:standard',
        customPrettifiers: { time: (ts) => String(ts) },
      }),
    )

export function formatDuration(ns: number): string {
  if (ns >= 1e9) return `${(ns / 1e9).toFixed(2)}s`
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(0)}ms`
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(0)}us`
  return `${ns}ns`
}

export function elapsed(start: bigint): string {
  return formatDuration(Number(process.hrtime.bigint() - start))
}

export function idTag(uploadId: number, batchId: number): string {
  return `[${uploadId}/${batchId}]`
}

const requestTimings = new WeakMap<Request, bigint>()

export const elysiaLogger = new Elysia({ name: 'elysia-logger' })
  .onRequest(({ request }) => {
    requestTimings.set(request, process.hrtime.bigint())
  })
  .onAfterHandle({ as: 'global' }, ({ request, set }) => {
    const status = Number(set.status ?? 200)
    const start = requestTimings.get(request) ?? process.hrtime.bigint()
    logger.info(`${request.method} ${new URL(request.url).pathname} ${status} | ${elapsed(start)}`)
  })
  .onError({ as: 'global' }, ({ request, error }) => {
    const status = 'status' in error ? (error as { status: number }).status : 500
    const message = error instanceof Error ? error.message : ''
    const start = requestTimings.get(request) ?? process.hrtime.bigint()
    logger.error(
      { err: error },
      `${request.method} ${new URL(request.url).pathname} ${status} ${message} | ${elapsed(start)}`,
    )
  })
  .as('global')
