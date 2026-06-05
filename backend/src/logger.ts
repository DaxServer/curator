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
