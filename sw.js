/* BellaBona Assembly Tracking - service worker.
 *
 * Goal: the app opens and works in a kitchen with no signal, without ever
 * showing stale dish data.
 *
 * That tension is the whole design. The two kinds of content here have opposite
 * caching needs:
 *
 *   index.html / kitchen-tasks.html  change EVERY WEEK when the scheduled task
 *       rewrites the menu. Serving these cache-first would show last week's
 *       dishes with this week's letters -- silently wrong, and worse than being
 *       offline. So: NETWORK FIRST, cache only as the offline fallback.
 *
 *   thumbs/<uuid>.webp  are content-addressed. A given uuid is always the same
 *       image, forever. So: CACHE FIRST, no revalidation, no expiry.
 *
 *   roster.json  changes when someone joins or leaves. Small, and a stale roster
 *       means a departed colleague reappears, so: NETWORK FIRST.
 *
 * Submissions are never touched by this worker. They are POSTs, and the pages
 * own their retry queues in localStorage; intercepting them here would put the
 * same entry in two places with two different ideas of whether it was sent.
 */

const VERSION    = 'v3-2026-07-31';
const SHELL      = 'bb-shell-'  + VERSION;
const IMG        = 'bb-img-'    + VERSION;

// Enough to open cold with no network. Deliberately small: the heavy assets are
// the thumbs, and those populate themselves as tiles render.
const SHELL_URLS = [
  './',
  './index.html',
  './kitchen-tasks.html',
  './roster.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Individually, not addAll: addAll rejects the whole install if any single
    // URL 404s, which would leave the app with no worker at all.
    await Promise.all(SHELL_URLS.map(async url => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* one missing file must not block install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, IMG]);
    const names = await caches.keys();
    await Promise.all(names.map(n => keep.has(n) ? null : caches.delete(n)));
    await self.clients.claim();
  })());
});

// Let the page tell a waiting worker to take over immediately after an update.
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

function isThumb(url) {
  return url.pathname.includes('/thumbs/') && url.pathname.endsWith('.webp');
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Opaque cross-origin responses (the S3 fallback images) report status 0.
  // Cache those too: they are still displayable, and re-fetching a 1.5 MB
  // fallback on every render is exactly what we are trying to avoid.
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(request, res.clone()).catch(() => {});
  }
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      cache.put(request, res.clone()).catch(() => {});
      return res;
    }
    // A non-ok response (502, a Pages hiccup) is worth falling back on rather
    // than showing the browser error page.
    const hit = await cache.match(request);
    return hit || res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // Navigations must land on something usable rather than a dead tab.
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;

  // Only GET is ours. Submissions (POST to the Apps Script) are owned by the
  // pages' own outboxes -- see the comment at the top.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache or interfere with the backend, on any method.
  if (url.hostname.endsWith('script.google.com') ||
      url.hostname.endsWith('googleusercontent.com')) return;

  // Cross-origin images (the S3 dish-photo fallback) are worth keeping.
  if (url.origin !== self.location.origin) {
    if (request.destination === 'image') {
      event.respondWith(cacheFirst(request, IMG).catch(() => fetch(request)));
    }
    return;
  }

  if (isThumb(url)) {
    event.respondWith(cacheFirst(request, IMG));
    return;
  }

  event.respondWith(networkFirst(request, SHELL));
});
