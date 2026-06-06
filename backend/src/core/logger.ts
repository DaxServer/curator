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

function formatDuration(beforeTime: bigint): string {
  const ns = Number(process.hrtime.bigint() - beforeTime)
  if (ns >= 1e9) return `${(ns / 1e9).toFixed(2)}s`
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(0)}ms`
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(0)}µs`
  return `${ns}ns`
}

type LogStore = { beforeTime: bigint }

export const elysiaLogger = new Elysia({ name: 'elysia-logger' })
  .state('beforeTime', process.hrtime.bigint())
  .onBeforeHandle({ as: 'global' }, ({ store }) => {
    ;(store as LogStore).beforeTime = process.hrtime.bigint()
  })
  .onAfterHandle({ as: 'global' }, ({ request, store, set }) => {
    const status = Number(set.status ?? 200)
    logger.info(
      `${request.method} ${new URL(request.url).pathname} ${status} | ${formatDuration((store as LogStore).beforeTime)}`,
    )
  })
  .onError({ as: 'global' }, ({ request, error, store }) => {
    const status = 'status' in error ? (error as { status: number }).status : 500
    const message = error instanceof Error ? error.message : ''
    logger.error(
      { err: error },
      `${request.method} ${new URL(request.url).pathname} ${status} ${message} | ${formatDuration((store as LogStore).beforeTime)}`,
    )
  })
