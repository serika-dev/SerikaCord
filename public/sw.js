// SerikaCord Service Worker
// Handles caching and local notifications

// Bump CACHE_VERSION whenever the caching rules change: activate deletes every
// other serikacord cache (v1 cached pages, RSC payloads and media).
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `serikacord-static-${CACHE_VERSION}`;
/** Entries kept in the runtime cache (oldest dropped first). */
const STATIC_CACHE_LIMIT = 300;
const PRECACHE = [
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// Install event - precache the notification / app icons
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .catch(() => { /* icons are a nicety, never block the update */ })
    );
    // Activate immediately
    self.skipWaiting();
});

// Activate event - drop caches from older versions
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames
                    .filter((name) => name.startsWith('serikacord') && name !== STATIC_CACHE)
                    .map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

/**
 * Only immutable, same-origin build assets and icons are cached. Pages
 * (navigations), RSC payloads, the API, streams and media always go to the
 * network: they are per-user and change constantly.
 */
function isCacheableRequest(request, url) {
    if (request.method !== 'GET') return false;
    if (url.origin !== self.location.origin) return false;
    if (request.mode === 'navigate') return false;
    if (request.headers.has('range')) return false;
    if (request.headers.get('RSC') || url.searchParams.has('_rsc')) return false;
    if (url.pathname.startsWith('/api/')) return false;
    // Content-hashed build output and app icons.
    return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

async function trimCache(cache) {
    const keys = await cache.keys();
    const excess = keys.length - STATIC_CACHE_LIMIT;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    // Only complete, same-origin successes (never 206 partials, errors or
    // opaque responses).
    if (response.ok && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        cache.put(request, copy)
            .then(() => trimCache(cache))
            .catch(() => { /* quota / transient: just don't cache */ });
    }
    return response;
}

// Fetch event - cache-first for static assets, everything else untouched
self.addEventListener('fetch', (event) => {
    const request = event.request;
    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }
    if (!isCacheableRequest(request, url)) return;
    event.respondWith(cacheFirst(request));
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon, tag, data, requireInteraction, renotify } = event.data.payload;

        event.waitUntil(
            self.registration.showNotification(title, {
                body,
                icon: icon || '/icons/icon-192x192.png',
                badge: '/icons/icon-72x72.png',
                // One notification per conversation: a newer one replaces it.
                tag: tag || 'serikacord-message',
                renotify: Boolean(renotify && tag),
                data: data || {},
                vibrate: [100, 50, 100],
                requireInteraction: Boolean(requireInteraction),
                actions: [
                    { action: 'open', title: 'Open' },
                    { action: 'dismiss', title: 'Dismiss' },
                ],
            })
        );
    }

    // The conversation was read (on any device): drop its notification.
    if (event.data && event.data.type === 'CLOSE_NOTIFICATIONS' && event.data.tag) {
        event.waitUntil(
            self.registration.getNotifications({ tag: event.data.tag }).then((list) => {
                list.forEach((n) => n.close());
            })
        );
    }

    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const action = event.action;
    const data = event.notification.data || {};

    if (action === 'dismiss') {
        return;
    }

    // Determine URL to open based on notification data
    let urlToOpen = '/channels/me';

    if (data.url) {
        urlToOpen = data.url;
    } else if (data.channelId && data.serverId) {
        urlToOpen = `/channels/${data.serverId}/${data.channelId}`;
    } else if (data.isDM && data.recipientId) {
        urlToOpen = `/dm/${data.recipientId}`;
    }

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Try to focus an existing window
            for (const client of clientList) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.focus();
                    client.postMessage({
                        type: 'NOTIFICATION_CLICK',
                        url: urlToOpen,
                        data,
                    });
                    return;
                }
            }
            // Open new window if no existing window
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});

// Handle notification close
self.addEventListener('notificationclose', () => {
    /* nothing to clean up */
});

// Background sync for offline message queue (if supported)
self.addEventListener('sync', (event) => {
    if (event.tag === 'send-pending-messages') {
        event.waitUntil(sendPendingMessages());
    }
});

// Send pending messages that were queued while offline
async function sendPendingMessages() {
    try {
        const db = await openMessageQueue();
        const pendingMessages = await getAllPendingMessages(db);

        for (const message of pendingMessages) {
            try {
                const response = await fetch(`/api/channels/${message.channelId}/messages`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: message.content }),
                });

                if (response.ok) {
                    await deletePendingMessage(db, message.id);
                }
            } catch (e) {
                console.error('Failed to send pending message:', e);
            }
        }
    } catch (e) {
        console.error('Failed to process pending messages:', e);
    }
}

// Simple IndexedDB helpers for offline message queue
function openMessageQueue() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('serikacord-offline', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('pending-messages')) {
                db.createObjectStore('pending-messages', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

function getAllPendingMessages(db) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('pending-messages', 'readonly');
        const store = transaction.objectStore('pending-messages');
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

function deletePendingMessage(db, id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('pending-messages', 'readwrite');
        const store = transaction.objectStore('pending-messages');
        const request = store.delete(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
    });
}
