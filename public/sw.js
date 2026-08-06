// Harmony push service worker (hand-rolled — the app is not an Angular PWA/ngsw).
// Scope: web push only. The payload is the JSON the backend dispatcher composes:
// { title, body, url, tag } — same-tag notifications replace each other in the OS
// tray, so repeat pushes from one conversation (and at-least-once outbox duplicates)
// collapse instead of stacking.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Harmony', body: '', url: '/app/friends', tag: undefined };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    // Unparseable payload — show the generic notification rather than nothing.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/favicon.ico',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/app/friends';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Prefer an already-open app window: focus it and navigate in place.
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(url);
          return undefined;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
