// Geo-Books Service Worker for Offline Support

const STATIC_CACHE = 'geo-books-static-v7';
const DYNAMIC_CACHE = 'geo-books-dynamic-v7';
const APP_SHELL_FILES = [
  'index.htm', 
  'geo-books.htm', 
  'seller.htm', 
  'cbt.htm',
  'styles.css', 
  'app.js', 
  'ai.js', 
  'cbt.js',
  'university.js',
  'manifest.json'
];
const APP_SHELL_URLS = APP_SHELL_FILES.map((p) => new URL(p, self.registration.scope).toString());

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Service Worker: Caching static assets');
        return Promise.allSettled(APP_SHELL_URLS.map((u) => cache.add(u)));
      })
      .then(() => {
        console.log('Service Worker: Static assets cached');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE) {
              console.log('Service Worker: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activated');
        return self.clients.claim();
      })
  );
});

// Helper to safely cache a response
async function safeCachePut(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  
  // Chrome's Cache API fails if the response has Vary: *
  const vary = response.headers.get('Vary');
  if (vary && vary.includes('*')) return;

  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (error) {
    console.warn('Service Worker: Cache put failed:', error.message);
  }
}

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Force secure backend routing to completely bypass local service worker intercepts.
  // Exact/prefix matching (not substring .includes()) so this can't be
  // accidentally over- or under-matched by lookalike paths. lecturer.html
  // gets the same treatment as main_admin.htm: it's an admin-only page
  // whose gate re-checks live auth/claim state on every load, so serving a
  // stale cached copy could show a stale authorization decision.
  const isAdminPage = url.pathname === '/main_admin.htm' || url.pathname.endsWith('/main_admin.htm') ||
    url.pathname === '/lecturer.html' || url.pathname.endsWith('/lecturer.html');
  const isApiCall = url.pathname === '/api' || url.pathname.startsWith('/api/');
  if (isAdminPage || isApiCall) {
    return event.respondWith(fetch(event.request));
  }

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip browser extension and unsupported schemes
  if (!['http:', 'https:'].includes(url.protocol)) {
    return;
  }

  // Skip external API requests (except Firebase)
  if (url.origin !== self.location.origin && !url.host.includes('firebase') && !url.host.includes('googleapis')) {
    return;
  }

  const isLocalAsset = url.origin === self.location.origin &&
    (request.destination === 'document' || /\.(?:js|css|htm|html|json)$/i.test(url.pathname));

  // Prefer fresh app shell files to prevent stale JS/HTML after deployments.
  if (isLocalAsset) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            safeCachePut(getCacheName(request), request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(async () => {
          // Network failed (offline / DNS / etc). Fall back to cache, and if
          // this was a page navigation with no cached copy either, fall back
          // to the cached app shell so the user sees something instead of a
          // bare browser error — matches the fallback behavior used below
          // for non-local-asset requests.
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.destination === 'document') {
            const shell = await caches.match(new URL('index.htm', self.registration.scope).toString());
            if (shell) return shell;
            return new Response(
              '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>You are offline</h1><p>Please check your internet connection.</p></body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            );
          }
          return new Response('Offline - Content not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }
  
  event.respondWith(
    caches.match(request)
      .then((response) => {
        // Return cached version if available
        if (response) {
          // For dynamic content, also fetch in background
          if (shouldUpdateInBackground(request)) {
            fetchAndUpdate(request);
          }
          return response;
        }
        
        // If not cached, try to fetch
        return fetch(request)
          .then((fetchResponse) => {
            if (fetchResponse && fetchResponse.status === 200) {
              safeCachePut(getCacheName(request), request, fetchResponse.clone());
            }
            return fetchResponse;
          })
          .catch(() => {
            // If fetch fails, try to serve offline page
            if (request.destination === 'document') {
              return caches.match(new URL('index.htm', self.registration.scope).toString()).then(cachedResponse => {
                if (cachedResponse) return cachedResponse;
                // Return a fallback HTML response if offline page not cached
                return new Response(
                  '<!DOCTYPE html><html><head><title>Offline</title></head><body><h1>You are offline</h1><p>Please check your internet connection.</p></body></html>',
                  { status: 503, headers: { 'Content-Type': 'text/html' } }
                );
              });
            }
            
            // Return a custom offline response for other requests
            return new Response('Offline - Content not available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});

// Determine if request should be updated in background
function shouldUpdateInBackground(request) {
  const url = new URL(request.url);
  
  // Update dynamic content like API calls
  return url.pathname.includes('/api/') || 
         url.host.includes('firebase') ||
         url.host.includes('googleapis');
}

// Fetch and update cache in background
function fetchAndUpdate(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        safeCachePut(getCacheName(request), request, response.clone());
      }
    })
    .catch((error) => {
      console.log('Background update failed:', error);
    });
}

// Get appropriate cache name based on request
function getCacheName(request) {
  const url = new URL(request.url);
  
  // Static assets go to static cache
  if (url.origin === self.location.origin &&
      (request.destination === 'document' ||
        request.destination === 'script' ||
        request.destination === 'style' ||
        request.destination === 'manifest' ||
        /\.(?:js|css|htm|html|json|woff2?)$/i.test(url.pathname))) {
    return STATIC_CACHE;
  }
  
  // Dynamic content goes to dynamic cache
  return DYNAMIC_CACHE;
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('Service Worker: Background sync triggered');
  
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

// Handle background sync
async function doBackgroundSync() {
  try {
    // Get all pending actions from IndexedDB
    const pendingActions = await getPendingActions();
    
    for (const action of pendingActions) {
      try {
        await fetch(action.url, action.options);
        await removePendingAction(action.id);
      } catch (error) {
        console.error('Failed to sync action:', action, error);
      }
    }
    
    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Push notification handling
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'New notification from Geo-Books',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Explore',
        icon: '/images/checkmark.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/images/xmark.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('Geo-Books', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Service Worker: Notification clicked');
  
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// IndexedDB helpers for offline storage
function getPendingActions() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('geo-books-offline', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pending-actions'], 'readonly');
      const store = transaction.objectStore('pending-actions');
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = () => resolve(getAllRequest.result);
      getAllRequest.onerror = () => reject(getAllRequest.error);
    };
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('pending-actions')) {
        db.createObjectStore('pending-actions', { keyPath: 'id' });
      }
    };
  });
}

function removePendingAction(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('geo-books-offline', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['pending-actions'], 'readwrite');
      const store = transaction.objectStore('pending-actions');
      const deleteRequest = store.delete(id);
      
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject(deleteRequest.error);
    };
  });
}

// Network status monitoring
self.addEventListener('online', () => {
  console.log('Service Worker: Client is online');
  // Trigger background sync when coming back online.
  // `sync` (Background Sync API) isn't implemented in every browser (e.g.
  // Safari), so calling .register() unguarded throws a TypeError there and
  // silently kills whatever this listener runs after. Feature-detect and
  // swallow registration failures instead.
  if (self.registration.sync) {
    self.registration.sync.register('background-sync').catch((err) => {
      console.warn('Service Worker: background sync registration failed:', err);
    });
  }
});

self.addEventListener('offline', () => {
  console.log('Service Worker: Client is offline');
});

// Message handling for communication with main thread
self.addEventListener('message', (event) => {
  // Some senders postMessage() a bare string/undefined; guard so a
  // malformed message doesn't throw and drop the whole listener.
  const { type, payload } = event.data || {};
  
  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CACHE_UPDATE':
      updateCache(payload.urls);
      break;
    case 'GET_VERSION':
      // Guard against callers that postMessage() without a MessageChannel
      // port (event.ports would be empty), which previously threw and
      // could take down whatever else this listener handles.
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ version: `${STATIC_CACHE}|${DYNAMIC_CACHE}` });
      }
      break;
  }
});

// Update specific cache
async function updateCache(urls) {
  const cache = await caches.open(STATIC_CACHE);
  const list = Array.isArray(urls) ? urls : [];
  const resolved = list.map((u) => new URL(String(u), self.registration.scope).toString());
  await Promise.allSettled(resolved.map((u) => cache.add(u)));
  console.log('Cache updated for:', resolved);
}