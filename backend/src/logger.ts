import pino from 'pino'

const isTest = Bun.env.NODE_ENV === 'test'

export const logger = pino({
  level: Bun.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  transport: isTest ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
})

export const workerLogger = logger.child({ module: 'worker' })
export const wsLogger = logger.child({ module: 'ws' })
export const mapillaryLogger = logger.child({ module: 'mapillary' })
export const mwLogger = logger.child({ module: 'mw' })
