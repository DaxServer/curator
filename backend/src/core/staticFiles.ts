import { Elysia } from 'elysia'

const ONE_MONTH_SECONDS = 60 * 60 * 24 * 30

export function serveStaticFiles(embeddedFiles: Record<string, string>, indexHtml: string) {
  return new Elysia({ name: 'static-files' })
    .get('/', () => Bun.file(indexHtml))
    .get('/*', ({ request, set }) => {
      const { pathname } = new URL(request.url)
      const filePath = embeddedFiles[pathname]
      if (pathname.startsWith('/assets/') && filePath) {
        set.headers['Cache-Control'] = `public, max-age=${ONE_MONTH_SECONDS}`
        set.headers.Vary = 'Accept-Encoding'
        const acceptsGzip = request.headers.get('Accept-Encoding')?.includes('gzip') ?? false
        const gzPath = embeddedFiles[`${pathname}.gz`]
        if (acceptsGzip && gzPath) {
          return new Response(Bun.file(gzPath), {
            headers: {
              'Content-Type': Bun.file(filePath).type,
              'Content-Encoding': 'gzip',
              'Cache-Control': `public, max-age=${ONE_MONTH_SECONDS}`,
              Vary: 'Accept-Encoding',
            },
          })
        }
        return Bun.file(filePath)
      }
      return Bun.file(embeddedFiles[pathname] ?? indexHtml)
    })
}
