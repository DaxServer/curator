const redisHost = Bun.env.REDIS_HOST ?? 'localhost'
const redisPort = Bun.env.REDIS_PORT ?? 6379
const redisPassword = Bun.env.REDIS_PASSWORD
const redisUrl = redisPassword
  ? `redis://:${redisPassword}@${redisHost}:${redisPort}`
  : `redis://${redisHost}:${redisPort}`

export const config = {
  port: Bun.env.PORT ?? 8000,
  oauthKey: Bun.env.CURATOR_OAUTH1_KEY,
  oauthSecret: Bun.env.CURATOR_OAUTH1_SECRET,
  tokenEncryptionKey: Bun.env.TOKEN_ENCRYPTION_KEY,
  sessionSecretKey: Bun.env.SESSION_SECRET_KEY,
  xUsername: Bun.env.X_USERNAME ?? 'DaxServer',
  xApiKey: Bun.env.X_API_KEY ?? '',
  wcqsOauthToken: Bun.env.WCQS_OAUTH_TOKEN ?? 'WCQS_OAUTH_TOKEN',
  mapillaryApiToken: Bun.env.MAPILLARY_API_TOKEN,
  redisUrl,
  dbUrl: Bun.env.DB_URL ?? 'mysql://curator:curator@localhost/curator',
  workerConcurrency: Bun.env.CELERY_CONCURRENCY ?? 2,
  workerMaxWaitTime: Bun.env.CELERY_MAXIMUM_WAIT_TIME ?? 240,
  rateLimitNormal: Bun.env.RATE_LIMIT_DEFAULT_NORMAL ?? 4,
  rateLimitPeriod: Bun.env.RATE_LIMIT_DEFAULT_PERIOD ?? 60,
  geocodingApiUrl: Bun.env.GEOCODING_API_URL ?? 'https://geocoding.daxserver.com/reverse',
  geocodingConcurrencyLimit: Bun.env.GEOCODING_CONCURRENCY_LIMIT ?? 10,
  enableMaintenance: Bun.env.ENABLE_MAINTENANCE === 'true',
  userAgent: 'Curator / Toolforge curator.toolforge.org / Wikimedia Commons User:DaxServer',
  wikimediaUrls: {
    indexUrl: 'https://commons.wikimedia.org/w/index.php',
    baseUrl: 'https://commons.wikimedia.org/w/api.php',
  },
} as const
