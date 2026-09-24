/* Kosku service worker: web push only. Data always comes fresh from the
 * server — nothing is cached, so no admin ever acts on stale numbers. */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = { title: 'Kosku', body: '', link: '/notifications', tag: undefined }
  try {
    data = { ...data, ...event.data.json() }
  } catch (e) {
    if (event.data) data.body = event.data.text()
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      data: { link: data.link },
      lang: 'id',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/notifications'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          w.navigate(link)
          return w.focus()
        }
      }
      return self.clients.openWindow(link)
    }),
  )
})
