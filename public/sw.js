// Retire the pre-account offline shell without touching legacy IndexedDB.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith('word-review-shell-')) await caches.delete(key)
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' }))
        await client.navigate(client.url)
    })(),
  )
})
