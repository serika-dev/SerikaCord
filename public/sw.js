// SerikaCord Service Worker
// Handles caching and local notifications

const CACHE_NAME = 'serikacord-v1';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Activate immediately
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    // Take control of all clients immediately
    self.clients.claim();
});

// Fetch event - network first, fall back to cache
self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip API requests - they should always be fresh
    if (event.request.url.includes('/api/')) return;

    // Skip non-http(s) requests (chrome-extension://, etc.) — Cache API can't handle them
    if (!event.request.url.startsWith('http')) return;

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone the response before caching
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon, tag, data } = event.data.payload;

        event.waitUntil(
            self.registration.showNotification(title, {
                body,
                icon: icon || '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png',
                tag: tag || 'serikacord-message',
                data: data || {},
                vibrate: [100, 50, 100],
                requireInteraction: false,
                actions: [
                    { action: 'open', title: 'Open' },
                    { action: 'dismiss', title: 'Dismiss' },
                ],
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

    if (data.channelId && data.serverId) {
        urlToOpen = `/channels/${data.serverId}/${data.channelId}`;
    } else if (data.channelId && data.isDM) {
        urlToOpen = `/channels/@me/${data.channelId}`;
    } else if (data.url) {
        urlToOpen = data.url;
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
self.addEventListener('notificationclose', (event) => {
    // Analytics or cleanup if needed
    console.log('Notification closed:', event.notification.tag);
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
