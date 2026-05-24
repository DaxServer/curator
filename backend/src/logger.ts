import pino from 'pino'
import pretty from 'pino-pretty'

const isTest = Bun.env.NODE_ENV === 'test'
const level = Bun.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info')

// pino transport uses worker threads and cannot resolve module paths inside a
// bundled binary; pretty() creates a synchronous in-process stream instead
export const logger = isTest ? pino({ level }) : pino({ level }, pretty({ singleLine: true }))

export const workerLogger = logger.child({ module: 'worker' })
export const wsLogger = logger.child({ module: 'ws' })
export const mapillaryLogger = logger.child({ module: 'mapillary' })
export const mwLogger = logger.child({ module: 'mw' })
