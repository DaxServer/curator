declare module "bun" {
  interface Env {
    PORT?: number
    REDIS_HOST?: string
    REDIS_PORT?: number
    REDIS_PASSWORD?: string
    CURATOR_OAUTH1_KEY: string
    CURATOR_OAUTH1_SECRET: string
    TOKEN_ENCRYPTION_KEY: string
    SESSION_SECRET_KEY: string
    WCQS_OAUTH_TOKEN?: string
    MAPILLARY_API_TOKEN: string
    DB_URL?: string
    CELERY_CONCURRENCY?: number
    CELERY_MAXIMUM_WAIT_TIME?: number
    RATE_LIMIT_DEFAULT_NORMAL?: number
    RATE_LIMIT_DEFAULT_PERIOD?: number
    GEOCODING_API_URL?: string
    GEOCODING_CONCURRENCY_LIMIT?: number
    X_USERNAME?: string
    X_API_KEY?: string
    ENABLE_MAINTENANCE?: string
    DEV_MOCK_AUTH?: string
    DEV_MOCK_USERNAME?: string
    DEV_MOCK_SUB?: string
    TOOL_DATA_DIR?: string
    LOG_LEVEL?: string
  }
}
