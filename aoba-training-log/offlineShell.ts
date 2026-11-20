import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const pwaFiles = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']

function matchTestUpdatePage(revision: string) {
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>試合記録の検証版を更新</title>
<h1>試合記録の検証版を更新</h1>
<p id="status" role="status">更新を確認しています。保存した記録は保持されます。</p>
<script>
(async () => {
  const status = document.getElementById('status');
  const failure = '更新を確認できませんでした。オンラインでこのページを再読み込みしてください。';
  let done = false;
  const check = () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller || done) return;
    const channel = new MessageChannel();
    const close = setTimeout(() => channel.port1.close(), 2000);
    channel.port1.onmessage = event => {
      clearTimeout(close);
      channel.port1.close();
      if (event.data !== '${revision}' || done) return;
      done = true;
      location.replace('./');
    };
    controller.postMessage('match-test-revision', [channel.port2]);
  };
  try {
    navigator.serviceWorker.addEventListener('controllerchange', check);
    const registration = await navigator.serviceWorker.register('./training-offline.js', { updateViaCache: 'none' });
    await registration.update();
    check();
    setTimeout(() => { if (!done) status.textContent = failure; }, 15000);
  } catch {
    status.textContent = failure;
  }
})();
</script>
</html>`
}

export function offlineShell(matchTest = false): Plugin {
  let publicDir: string
  return {
    name: 'training-log-offline-shell',
    apply: 'build',
    enforce: 'post',
    configResolved(config) { publicDir = config.publicDir },
    transformIndexHtml(html) {
      return matchTest ? html.replace('content="AOBA LOG"', 'content="AOBA LOG 検証用"')
        .replace('<title>AOBA TRAINING LOG</title>', '<title>AOBA LOG 検証用</title>') : html
    },
    generateBundle(_options, bundle) {
      const output = Object.keys(bundle).filter(name => /\.(?:html|js|css)$/.test(name)).sort()
      if (!output.includes('index.html')) this.error('Offline shell needs the built index.html.')
      const revision = createHash('sha256')
      for (const name of output) {
        const file = bundle[name]
        revision.update(name).update(file.type === 'chunk' ? file.code : file.source)
      }
      for (const name of pwaFiles) {
        let content = readFileSync(join(publicDir, name))
        if (matchTest && name === 'manifest.webmanifest') {
          const manifest = JSON.parse(content.toString('utf8'))
          content = Buffer.from(JSON.stringify({ ...manifest, name: 'AOBA LOG 試合記録検証', short_name: 'AOBA LOG 検証用' }))
          this.emitFile({ type: 'asset', fileName: name, source: content })
        }
        revision.update(name).update(content)
      }
      const resources = ['index.html', ...output.filter(name => name !== 'index.html'), ...pwaFiles]
      const worker = `
const scope = new URL(self.registration.scope)
const files = ${JSON.stringify(resources)}.map(file => new URL(file, scope).href)
const cachePrefix = 'aoba-training-log-shell:' + scope.href + ':'
const cacheKey = cachePrefix + '__REVISION__'${matchTest ? `

self.addEventListener('message', event => {
  if (event.data === 'match-test-revision') event.ports[0]?.postMessage('__REVISION__')
})
` : ''}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheKey).then(cache =>
    cache.addAll(files.map(file => new Request(file, { cache: 'reload' })))
  )${matchTest ? '.then(() => self.skipWaiting())' : ''}.catch(async error => {
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
  ${matchTest ? `if (shellPage) {
    event.respondWith((async () => {
      try {
        return await fetch(request, { cache: 'no-store' })
      } catch {
        const saved = await (await caches.open(cacheKey)).match(files[0])
        return saved || Response.error()
      }
    })())
    return
  }
  ` : ''}const key = shellPage ? files[0] : url.href
  if (!files.includes(key)) return
  event.respondWith(caches.open(cacheKey).then(async cache => {
    const saved = await cache.match(key)
    return saved || fetch(request)
  }))
})
`
      const workerRevision = revision.update(worker).digest('hex')
      this.emitFile({
        type: 'asset',
        fileName: 'training-offline.js',
        source: worker.replaceAll('__REVISION__', workerRevision),
      })
      if (matchTest) {
        // Older workers only catch the app shell and its known assets.
        this.emitFile({ type: 'asset', fileName: 'match-test-update.html', source: matchTestUpdatePage(workerRevision) })
      }
    },
  }
}
