const APP_VERSION = 'v1.0.0';
const CACHE_STATIC = 'chess-review-static-' + APP_VERSION;
const CACHE_DYNAMIC = 'chess-review-dynamic-' + APP_VERSION;
const CACHE_CDN = 'chess-review-cdn-' + APP_VERSION;
const CACHE_OPENINGS = 'chess-review-openings-' + APP_VERSION;

const STATIC_URLS = [
  '/',
  '/support',
  '/faq',
  '/about',
  '/offline',
  '/manifest.webmanifest',
  '/images/wP.png',
  '/images/wR.png',
  '/images/wN.png',
  '/images/wB.png',
  '/images/wQ.png',
  '/images/wK.png',
  '/images/bP.png',
  '/images/bR.png',
  '/images/bN.png',
  '/images/bB.png',
  '/images/bQ.png',
  '/images/bK.png',
];

const CDN_PROXY_PREFIX = '/cdn/';

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache) {
      return cache.addAll(STATIC_URLS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key.startsWith('chess-review-') &&
            key !== CACHE_STATIC &&
            key !== CACHE_DYNAMIC &&
            key !== CACHE_CDN &&
            key !== CACHE_OPENINGS;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // API proxy - network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request, CACHE_DYNAMIC));
    return;
  }

  // CDN proxy - stale while revalidate
  if (url.pathname.startsWith(CDN_PROXY_PREFIX)) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_CDN));
    return;
  }

  // Static assets - cache first
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event.request, CACHE_STATIC));
    return;
  }

  // HTML pages - network first, fallback to cache, then offline page
  if (url.pathname === '/' || url.pathname.endsWith('.html') || isPageUrl(url)) {
    event.respondWith(
      networkFirst(event.request, CACHE_DYNAMIC).catch(function() {
        return caches.match(event.request).then(function(cached) {
          return cached || caches.match('/offline');
        });
      })
    );
    return;
  }

  // Everything else - network first with cache fallback
  event.respondWith(
    networkFirst(event.request, CACHE_DYNAMIC).catch(function() {
      return caches.match(event.request);
    })
  );
});

function isStaticAsset(url) {
  var path = url.pathname;
  return path.startsWith('/images/') ||
    path.startsWith('/sounds/') ||
    path.startsWith('/icons/') ||
    path === '/manifest.webmanifest' ||
    path === '/sw.js';
}

function isPageUrl(url) {
  var path = url.pathname;
  return path === '/support' ||
    path === '/faq' ||
    path === '/about' ||
    path === '/game' ||
    path.startsWith('/game?');
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function(cached) {
    if (cached) return cached;
    return fetch(request).then(function(response) {
      if (!response || response.status !== 200 || response.type !== 'basic') {
        return response;
      }
      var copy = response.clone();
      caches.open(cacheName).then(function(cache) {
        cache.put(request, copy);
      });
      return response;
    });
  });
}

function networkFirst(request, cacheName) {
  return fetch(request).then(function(response) {
    if (!response || response.status !== 200) {
      return response;
    }
    var copy = response.clone();
    caches.open(cacheName).then(function(cache) {
      cache.put(request, copy);
    });
    return response;
  }).catch(function() {
    return caches.match(request);
  });
}

function staleWhileRevalidate(request, cacheName) {
  var cached = caches.match(request);
  var fetched = fetch(request).then(function(response) {
    if (response && response.status === 200) {
      var copy = response.clone();
      caches.open(cacheName).then(function(cache) {
        cache.put(request, copy);
      });
    }
    return response;
  });
  return cached.then(function(cachedResponse) {
    return cachedResponse || fetched;
  });
}

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key.startsWith('chess-review-')) {
          return caches.delete(key);
        }
      }));
    }).then(function() {
      self.skipWaiting();
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'CACHES_CLEARED' });
        });
      });
    });
  }
});
