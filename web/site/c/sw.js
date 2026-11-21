// F-13: empty Web Push → generic notification; the page fetches and decrypts the details.
const BODY = {
  en: 'A contact needs you. Open to see.',
  fr: 'Un contact a besoin de toi. Ouvre pour voir.',
  de: 'Ein Kontakt braucht dich. Öffnen zum Ansehen.',
};
self.addEventListener('push', (e) => {
  const l = (self.navigator.language || 'en').slice(0, 2);
  e.waitUntil(self.registration.showNotification('Thirstr', { body: BODY[l] || BODY.en, tag: 'thirstr-safety', renotify: true, requireInteraction: true, icon: '/favicon.svg' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => {
      const w = l.find((c) => new URL(c.url).pathname.startsWith('/c/'));
      return w ? w.focus() : self.clients.openWindow('/c/');
    }),
  );
});
