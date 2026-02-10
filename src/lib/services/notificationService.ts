/**
 * Notification Service
 * Handles notifications across all platforms:
 * - Desktop: Electron native notifications OR browser Notification API
 * - Web: Service Worker notifications + Notification API
 * - Mobile (Capacitor): LocalNotifications plugin
 * 
 * This is a fully local system that relies on the website's SSE connection
 * for real-time updates - no Firebase or external push services required.
 */

// Types are declared in src/types/native.d.ts
// Capacitor imports are dynamically loaded and only available in mobile builds
/* eslint-disable @typescript-eslint/ban-ts-comment */

// Check platform
export const isElectron = (): boolean => {
    return typeof window !== 'undefined' && !!window.electron?.isElectron;
};

export const isCapacitor = (): boolean => {
    return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform();
};

export const isMobileApp = (): boolean => {
    return isCapacitor() && window.Capacitor!.isNativePlatform();
};

// Service worker registration
let swRegistration: ServiceWorkerRegistration | null = null;

/**
 * Register the service worker for web notifications
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return null;
    }

    // Don't register SW in Electron (it has its own notification system)
    if (isElectron()) {
        return null;
    }

    try {
        swRegistration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/',
        });
        console.log('Service Worker registered:', swRegistration.scope);

        // Handle messages from service worker
        navigator.serviceWorker.addEventListener('message', handleSWMessage);

        return swRegistration;
    } catch (error) {
        console.error('Service Worker registration failed:', error);
        return null;
    }
}

/**
 * Handle messages from the service worker
 */
function handleSWMessage(event: MessageEvent) {
    if (event.data?.type === 'NOTIFICATION_CLICK') {
        // Navigate to the URL from notification click
        if (event.data.url) {
            window.location.href = event.data.url;
        }
    }
}

// Notification state
let unreadCount = 0;
let notificationPermission: NotificationPermission | 'granted' | null = null;

/**
 * Request notification permissions
 */
export async function requestNotificationPermission(): Promise<boolean> {
    // Electron handles notifications natively
    if (isElectron()) {
        notificationPermission = 'granted';
        return true;
    }

    // Capacitor mobile - check LocalNotifications permission
    if (isMobileApp()) {
        try {
            // Dynamically import to avoid bundling issues
            // @ts-ignore - Capacitor modules only available in mobile build
            const { LocalNotifications } = await import(/* webpackIgnore: true */ '@capacitor/local-notifications');
            const result = await LocalNotifications.checkPermissions();

            if (result.display === 'granted') {
                notificationPermission = 'granted';
                return true;
            }

            if (result.display === 'prompt' || result.display === 'prompt-with-rationale') {
                const requested = await LocalNotifications.requestPermissions();
                notificationPermission = requested.display === 'granted' ? 'granted' : null;
                return requested.display === 'granted';
            }

            return false;
        } catch (error) {
            console.error('Failed to check mobile notification permissions:', error);
            return false;
        }
    }

    // Web browser
    if (typeof Notification === 'undefined') {
        return false;
    }

    if (Notification.permission === 'granted') {
        notificationPermission = 'granted';
        return true;
    }

    if (Notification.permission !== 'denied') {
        const result = await Notification.requestPermission();
        notificationPermission = result;
        return result === 'granted';
    }

    return false;
}

/**
 * Show a notification (platform-aware)
 */
export async function showNotification(
    title: string,
    body: string,
    options: {
        icon?: string;
        tag?: string;
        requireInteraction?: boolean;
        data?: Record<string, unknown>;
        onClick?: () => void;
    } = {}
): Promise<void> {
    // Electron: Use native notifications via IPC
    if (isElectron()) {
        await window.electron!.notifications.show(title, body, options);
        return;
    }

    // Capacitor Mobile: Use LocalNotifications
    if (isMobileApp()) {
        try {
            // @ts-ignore - Capacitor modules only available in mobile build
            const { LocalNotifications } = await import(/* webpackIgnore: true */ '@capacitor/local-notifications');

            await LocalNotifications.schedule({
                notifications: [{
                    title,
                    body,
                    id: Date.now(),
                    extra: options.data || {},
                    smallIcon: 'ic_notification',
                    iconColor: '#8B5CF6',
                }],
            });
            return;
        } catch (error) {
            console.error('Failed to show mobile notification:', error);
        }
    }

    // Web: Try Service Worker first, fall back to Notification API
    if (swRegistration?.active) {
        // Use service worker for better background support
        swRegistration.active.postMessage({
            type: 'SHOW_NOTIFICATION',
            payload: {
                title,
                body,
                icon: options.icon || '/icons/icon-192x192.png',
                tag: options.tag,
                data: options.data,
            },
        });
        return;
    }

    // Fallback: Direct Notification API
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body,
            icon: options.icon || '/icons/icon-192x192.png',
            tag: options.tag,
            requireInteraction: options.requireInteraction,
        });

        if (options.onClick) {
            notification.onclick = () => {
                window.focus();
                options.onClick?.();
                notification.close();
            };
        }
    }
}

/**
 * Set the badge/unread count
 */
export function setBadgeCount(count: number): void {
    unreadCount = Math.max(0, count);

    // Electron: Use IPC badge API
    if (isElectron()) {
        window.electron!.badge.set(unreadCount);
        return;
    }

    // Update document title with count
    updateDocumentTitle(unreadCount);

    // PWA Badge API (works on mobile Chrome and some desktop browsers)
    if ('setAppBadge' in navigator) {
        if (unreadCount > 0) {
            (navigator as unknown as { setAppBadge: (n: number) => void }).setAppBadge(unreadCount);
        } else {
            (navigator as unknown as { clearAppBadge: () => void }).clearAppBadge();
        }
    }

    // Update favicon with badge (browser fallback)
    updateFaviconBadge(unreadCount);
}

/**
 * Increment the badge count
 */
export function incrementBadge(amount = 1): void {
    setBadgeCount(unreadCount + amount);
}

/**
 * Get current unread count
 */
export function getUnreadCount(): number {
    return unreadCount;
}

/**
 * Clear the badge
 */
export function clearBadge(): void {
    setBadgeCount(0);

    if (isElectron()) {
        window.electron!.badge.clear();
    }
}

// Store original title
let originalTitle = '';

/**
 * Update document title with unread count
 */
function updateDocumentTitle(count: number): void {
    if (typeof document === 'undefined') return;

    // Store original title on first call
    if (!originalTitle) {
        // Remove any existing count prefix
        originalTitle = document.title.replace(/^\(\d+\+?\)\s*/, '');
    }

    if (count > 0) {
        const countDisplay = count > 99 ? '99+' : count;
        document.title = `(${countDisplay}) ${originalTitle}`;
    } else {
        document.title = originalTitle;
    }
}

// Favicon badge state
let originalFaviconUrl: string | null = null;

/**
 * Update favicon with notification badge
 */
function updateFaviconBadge(count: number): void {
    if (typeof document === 'undefined') return;

    const link: HTMLLinkElement = document.querySelector("link[rel~='icon']") || document.createElement('link');

    // Store original favicon
    if (!originalFaviconUrl) {
        originalFaviconUrl = link.href || '/favicon.ico';
    }

    if (count === 0) {
        // Reset to original favicon
        link.href = originalFaviconUrl;
        return;
    }

    // Create canvas to draw badge
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Load original favicon
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = originalFaviconUrl;

    img.onload = () => {
        // Draw original favicon
        ctx.drawImage(img, 0, 0, 32, 32);

        // Draw badge circle
        ctx.beginPath();
        ctx.arc(24, 8, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#EF4444';
        ctx.fill();

        // Draw count text
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const displayCount = count > 9 ? '9+' : String(count);
        ctx.fillText(displayCount, 24, 8);

        // Update favicon
        link.type = 'image/x-icon';
        link.rel = 'shortcut icon';
        link.href = canvas.toDataURL();

        // Ensure link is in document
        if (!document.querySelector("link[rel~='icon']")) {
            document.head.appendChild(link);
        }
    };
}

/**
 * Handle new message notification
 */
export async function notifyNewMessage(
    channelId: string,
    channelName: string,
    senderName: string,
    messageContent: string,
    options: {
        serverId?: string;
        serverName?: string;
        isDM?: boolean;
        recipientId?: string;
    } = {}
): Promise<void> {
    // Increment badge
    incrementBadge();

    // Format notification content
    const title = options.isDM
        ? senderName
        : `#${channelName} (${options.serverName || 'Server'})`;

    const body = options.isDM
        ? messageContent
        : `${senderName}: ${messageContent}`;

    // Show notification with navigation data
    await showNotification(title, body.slice(0, 100), {
        tag: `message-${channelId}`,
        data: {
            channelId,
            serverId: options.serverId,
            isDM: options.isDM,
            recipientId: options.recipientId,
        },
        onClick: () => {
            // Navigate to the channel
            if (options.isDM) {
                if (options.recipientId) {
                    window.location.href = `/dm/${options.recipientId}`;
                } else {
                    window.location.href = '/channels/messages';
                }
            } else if (options.serverId) {
                window.location.href = `/channels/${options.serverId}/${channelId}`;
            }
        },
    });
}

/**
 * Handle mention notification
 */
export async function notifyMention(
    channelId: string,
    channelName: string,
    senderName: string,
    serverId?: string,
    serverName?: string
): Promise<void> {
    incrementBadge();

    const title = 'New Mention';
    const body = `${senderName} mentioned you in #${channelName}${serverName ? ` (${serverName})` : ''}`;

    await showNotification(title, body, {
        tag: `mention-${channelId}`,
        requireInteraction: true,
        data: {
            channelId,
            serverId,
        },
        onClick: () => {
            if (serverId) {
                window.location.href = `/channels/${serverId}/${channelId}`;
            }
        },
    });
}

/**
 * Handle friend request notification
 */
export async function notifyFriendRequest(
    fromUsername: string,
    fromUserId: string
): Promise<void> {
    incrementBadge();

    await showNotification('Friend Request', `${fromUsername} sent you a friend request`, {
        tag: `friend-${fromUserId}`,
        data: {
            type: 'friend-request',
            userId: fromUserId,
        },
        onClick: () => {
            window.location.href = '/channels/me';
        },
    });
}

/**
 * Initialize the notification service
 * Call this once when the app starts
 */
export async function initNotificationService(): Promise<void> {
    // Register service worker (for web)
    await registerServiceWorker();

    // Request permissions
    await requestNotificationPermission();

    // Setup Capacitor LocalNotification listeners for mobile
    if (isMobileApp()) {
        try {
            // @ts-ignore - Capacitor modules only available in mobile build
            const { LocalNotifications } = await import(/* webpackIgnore: true */ '@capacitor/local-notifications');

            // Handle notification tap
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            LocalNotifications.addListener('localNotificationActionPerformed', (notification: any) => {
                const data = notification.notification.extra || {};

                // Navigate based on notification data
                if (data.channelId && data.serverId) {
                    window.location.href = `/channels/${data.serverId}/${data.channelId}`;
                } else if (data.channelId && data.isDM) {
                    if (data.recipientId) {
                        window.location.href = `/dm/${data.recipientId}`;
                    } else {
                        window.location.href = '/channels/messages';
                    }
                } else if (data.type === 'friend-request') {
                    window.location.href = '/channels/me';
                }
            });
        } catch (error) {
            console.error('Failed to setup mobile notification listeners:', error);
        }
    }
}

// Auto-initialize when imported (client-side only)
if (typeof window !== 'undefined') {
    // Defer initialization to avoid blocking
    if (document.readyState === 'complete') {
        initNotificationService();
    } else {
        window.addEventListener('load', () => {
            initNotificationService();
        });
    }
}
