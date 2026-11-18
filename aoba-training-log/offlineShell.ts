import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const pwaFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']

export function offlineShell(): Plugin {
  let publicDir: string
  return {
    name: 'training-log-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { publicDir = config.publicDir },
    generateBundle(_options, bundle) {
      const output = Object.keys(bundle).filter(name => /\.(?:html|js|css)$/.test(name)).sort()
      if (!output.includes('index.html')) this.error('Offline shell needs the built index.html.')
      const revision = createHash('sha256')
      for (const name of output) {
        const file = bundle[name]
        revision.update(name).update(file.type === 'chunk' ? file.code : file.source)
      }
      for (const name of pwaFiles) revision.update(name).update(readFileSync(join(publicDir, name)))
      const resources = ['index.html', ...output.filter(name => name !== 'index.html'), ...pwaFiles]
      const worker = `
const scope = new URL(self.registration.scope)
const files = ${JSON.stringify(resources)}.map(file => new URL(file, scope).href)
const cachePrefix = 'aoba-training-log-shell:' + scope.href + ':'
const cacheKey = cachePrefix + '__REVISION__'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheKey).then(cache =>
    cache.addAll(files.map(file => new Request(file, { cache: 'reload' })))
  ).catch(async error => {
    await caches.delete(cacheKey)
    throw error
  }))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(cachePrefix) && key !== cacheKey) await caches.delete(key)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== scope.origin) return
  const shellPage = request.mode === 'navigate' &&
    (url.pathname === scope.pathname || url.pathname === new URL('index.html', scope).pathname)
  const key = shellPage ? files[0] : url.href
  if (!files.includes(key)) return
  event.respondWith(caches.open(cacheKey).then(async cache => {
    const saved = await cache.match(key)
    return saved || fetch(request)
  }))
})
`
      this.emitFile({
        type: 'asset',
        fileName: 'training-offline.js',
        source: worker.replace('__REVISION__', revision.update(worker).digest('hex')),
      })
    },
  }
}
