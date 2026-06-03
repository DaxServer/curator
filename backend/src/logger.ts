import pino from 'pino'
import pretty from 'pino-pretty'

const isTest = Bun.env.NODE_ENV === 'test'
const isProd = Bun.env.NODE_ENV === 'production'
const level = Bun.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info')

// pino transport uses worker threads and cannot resolve module paths inside a
// bundled binary; pretty() creates a synchronous in-process stream instead
export const logger = isTest
  ? pino({ level })
  : pino(
      { level },
      pretty({
        singleLine: true,
        ignore: isProd ? 'pid,hostname,time' : 'pid,hostname',
        translateTime: 'UTC:yyyy-mm-dd"T"HH:MM:ss.l"Z"',
        customPrettifiers: { time: (ts) => String(ts) },
      }),
    )
