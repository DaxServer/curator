import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const assetsDir = join(import.meta.dir, '../dist/assets')
const COMPRESSIBLE = /\.(js|css|svg|woff|json|txt|xml)$/

for (const entry of readdirSync(assetsDir)) {
  if (entry.endsWith('.gz')) continue
  if (!COMPRESSIBLE.test(entry)) continue
  const full = join(assetsDir, entry)
  if (statSync(full).isDirectory()) continue
  const content = await Bun.file(full).arrayBuffer()
  const compressed = Bun.gzipSync(new Uint8Array(content))
  await Bun.write(`${full}.gz`, compressed)
}
