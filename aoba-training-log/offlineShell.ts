import type { Plugin } from 'vite'

export function offlineShell(): Plugin {
  return {
    name: 'training-log-offline-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const resources = ['index.html', ...Object.keys(bundle).filter(name => /\.(?:js|css)$/.test(name)).sort()]
      this.emitFile({
        type: 'asset',
        fileName: 'training-offline.js',
        source: `
const scope = new URL(self.registration.scope)
const files = ${JSON.stringify(resources)}.map(file => new URL(file, scope).href)
const cachePrefix = 'aoba-training-log-shell:' + scope.href + ':'
const cacheKey = cachePrefix + ${JSON.stringify(resources.join('|'))}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheKey).then(cache => cache.addAll(files)))
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
`,
      })
    },
  }
}
