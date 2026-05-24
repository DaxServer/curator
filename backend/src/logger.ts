import pino from 'pino'

const isTest = Bun.env.NODE_ENV === 'test'
const usePretty = !isTest && (Bun.env.LOG_PRETTY === 'true' || Bun.env.NODE_ENV === 'development')

export const logger = pino({
  level: Bun.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  transport: usePretty ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
})

export const workerLogger = logger.child({ module: 'worker' })
export const wsLogger = logger.child({ module: 'ws' })
export const mapillaryLogger = logger.child({ module: 'mapillary' })
export const mwLogger = logger.child({ module: 'mw' })
