import { serveStaticFiles } from '@backend/core/staticFiles'
import { beforeAll, describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'
import { join } from 'node:path'

const f = join(import.meta.dir, 'fixtures')

const embeddedFiles: Record<string, string> = {
  '/index.html': join(f, 'index.html'),
  '/assets/app.js': join(f, 'app.js'),
  '/assets/app.js.gz': join(f, 'app.js.gz'),
  '/assets/style.css': join(f, 'style.css'),
  '/assets/style.css.gz': join(f, 'style.css.gz'),
  '/assets/font.woff': join(f, 'font.woff'),
  '/assets/font.woff2': join(f, 'font.woff2'),
  '/assets/icon.svg': join(f, 'favicon.ico'),
  '/favicon.ico': join(f, 'favicon.ico'),
  '/robots.txt': join(f, 'robots.txt'),
}

beforeAll(async () => {
  for (const name of ['app.js', 'style.css']) {
    const content = await Bun.file(join(f, name)).arrayBuffer()
    await Bun.write(join(f, `${name}.gz`), Bun.gzipSync(new Uint8Array(content)))
  }
})

function makeApp() {
  return new Elysia().use(serveStaticFiles(embeddedFiles, embeddedFiles['/index.html']))
}

describe('serveStaticFiles', () => {
  it('sets Cache-Control header for all /assets/ files', async () => {
    for (const path of [
      '/assets/app.js',
      '/assets/style.css',
      '/assets/font.woff',
      '/assets/font.woff2',
      '/assets/icon.svg',
    ]) {
      const res = await makeApp().handle(new Request(`http://localhost${path}`))
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=2592000')
    }
  })

  it('does not set Cache-Control header for non-asset files', async () => {
    for (const path of ['/', '/favicon.ico', '/robots.txt']) {
      const res = await makeApp().handle(new Request(`http://localhost${path}`))
      expect(res.headers.get('Cache-Control')).toBeNull()
    }
  })

  it('serves pre-compressed .gz file when client accepts gzip', async () => {
    const res = await makeApp().handle(
      new Request('http://localhost/assets/app.js', {
        headers: { 'Accept-Encoding': 'gzip, deflate, br' },
      }),
    )
    expect(res.headers.get('Content-Encoding')).toBe('gzip')
    expect(res.headers.get('Content-Type')).toContain('javascript')
  })

  it('serves uncompressed file when client does not accept gzip', async () => {
    const res = await makeApp().handle(new Request('http://localhost/assets/app.js'))
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  it('serves uncompressed file when no .gz version exists', async () => {
    const res = await makeApp().handle(
      new Request('http://localhost/assets/font.woff', {
        headers: { 'Accept-Encoding': 'gzip' },
      }),
    )
    expect(res.headers.get('Content-Encoding')).toBeNull()
  })

  it('sets Vary: Accept-Encoding on all /assets/ responses', async () => {
    for (const path of ['/assets/app.js', '/assets/font.woff']) {
      const res = await makeApp().handle(new Request(`http://localhost${path}`))
      expect(res.headers.get('Vary')).toBe('Accept-Encoding')
    }
  })

  it('does not set Cache-Control for unknown /assets/ paths (falls back to index.html)', async () => {
    const res = await makeApp().handle(new Request('http://localhost/assets/stale-chunk.js'))
    expect(res.headers.get('Cache-Control')).toBeNull()
  })

  it('falls back to index.html for unknown paths', async () => {
    const res = await makeApp().handle(new Request('http://localhost/some/spa/route'))
    expect(res.status).toBe(200)
  })
})
