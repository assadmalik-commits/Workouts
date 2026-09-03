// Offline, and nothing cleverer than that.
//
// The lifter trains in a basement gym with no signal. The app must open and
// take a set with the network entirely absent, so every file it needs is cached
// on install and served from there first.
//
// Cache-first, not network-first: on a flaky connection network-first stalls on
// a request that will never arrive, and the app is a barbell's length away with
// a set to write down. A new version is picked up on the next open instead.
const VERSION = 'training-log-v1';
const SHELL = './';
// Written by the build: the page, the icons and the content-hashed bundle.
// Everything the app needs to open with no network at all.
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, not addAll: one 404 in the list would reject the whole
      // install and leave the app with no offline copy at all, silently.
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) => cache.add(url).catch(() => {}))
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // Refresh in the background so the next open is current, without making
        // this one wait for a network that may not be there.
        fetch(req)
          .then((res) => res.ok && caches.open(VERSION).then((c) => c.put(req, res.clone())))
          .catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() =>
          // A navigation with nothing cached and no network still has to render
          // the app rather than the browser's error page.
          req.mode === 'navigate' ? caches.match(SHELL) : Promise.reject(new Error('offline'))
        );
    })
  );
});
