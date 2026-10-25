const CACHE = 'word-review-shell-v4'
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const response = await fetch('/index.html', { cache: 'reload' })
      if (!response.ok) throw new Error('Cannot cache app shell')
      const html = await response.clone().text()
      const assets = [...html.matchAll(/"(\/assets\/[^"\s]+)"/g)].map((match) => match[1])
      await cache.put('/index.html', response)
      const catalogResponse = await fetch('/data/catalog.json', { cache: 'reload' })
      if (!catalogResponse.ok) throw new Error('Cannot cache textbook catalog')
      const catalog = await catalogResponse.clone().json()
      await cache.put('/data/catalog.json', catalogResponse)
      await cache.addAll([
        '/icon.svg',
        '/manifest.webmanifest',
        '/data/bnu-grade4-upper.xlsx',
        ...catalog.map((book) => book.file),
        ...assets,
      ])
      await self.skipWaiting()
    })(),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('word-review-shell-') && key !== CACHE) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin)
    return
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      if (event.request.mode === 'navigate') {
        try {
          const response = await fetch(event.request)
          if (response.ok) await cache.put('/index.html', response.clone())
          return response
        } catch {
          return (await cache.match('/index.html')) ?? Response.error()
        }
      }
      // Only this app's static files live here. Module requests add Origin; Vite varies
      // responses on Origin even though these immutable asset bytes are identical.
      const cached = await cache.match(event.request, { ignoreVary: true })
      if (cached) return cached
      const response = await fetch(event.request)
      if (response.ok) await cache.put(event.request, response.clone())
      return response
    })(),
  )
})
