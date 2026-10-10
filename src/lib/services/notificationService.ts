/**
 * Notification Service
 * Handles notifications across all platforms:
 * - Desktop: Electron native notifications OR browser Notification API
 * - Web: Service Worker notifications + Notification API
 * - Mobile (Capacitor): LocalNotifications plugin while the app is running;
 *   server pushes (FCM, src/lib/native/push.ts) cover it when it isn't.
 */

import { addNativeListener, callNative, hasNativePlugin } from '@/lib/native/bridge';
import { nativeAppState } from '@/lib/native/push';

import { closeDesktopNotification, isDesktopShell, showDesktopNotification } from '@/lib/desktop/bridge';

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
        if (event.data.url) navigateInApp(String(event.data.url));
    }
}

/**
 * Open an in-app URL from a notification click. The app shell listens for
 * `serika:navigate` and routes client-side (no reload); without a listener we
 * fall back to a full navigation.
 */
export function navigateInApp(url: string): void {
    if (typeof window === 'undefined') return;
    // Only same-origin paths.
    if (!url.startsWith('/') || url.startsWith('//')) return;
    window.focus();
    const ev = new CustomEvent('serika:navigate', { detail: url, cancelable: true });
    window.dispatchEvent(ev);
    if (!ev.defaultPrevented) window.location.href = url;
}

// Notification state
let unreadCount = 0;
let notificationPermission: NotificationPermission | 'granted' | null = null;

/**
 * Request notification permissions
 */
export async function requestNotificationPermission(): Promise<boolean> {
    // Native shells handle notifications themselves
    if (isElectron() || isDesktopShell()) {
        notificationPermission = 'granted';
        return true;
    }

    // Capacitor mobile - check LocalNotifications permission
    if (isMobileApp()) {
        if (!hasNativePlugin('LocalNotifications')) return false;
        const result = await callNative<{ display?: string }>('LocalNotifications', 'checkPermissions');
        if (result?.display === 'granted') {
            notificationPermission = 'granted';
            return true;
        }
        if (result?.display === 'prompt' || result?.display === 'prompt-with-rationale') {
            const requested = await callNative<{ display?: string }>('LocalNotifications', 'requestPermissions');
            notificationPermission = requested?.display === 'granted' ? 'granted' : null;
            return requested?.display === 'granted';
        }
        return false;
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

// Page-created notifications by tag, so closeNotification() can find them.
const openNotifications = new Map<string, Notification>();

/**
 * Close a web notification shown with this tag (an incoming call that was
 * answered or stopped ringing). Best-effort; native shells keep theirs.
 */
export async function closeNotification(tag: string): Promise<void> {
    closeDesktopNotification(tag);
    // Native app: drop delivered pushes / local notifications for it too.
    if (isMobileApp()) void callNative('SerikaNative', 'clearNotifications', { tag });
    openNotifications.get(tag)?.close();
    openNotifications.delete(tag);
    // Messages to the worker are handled in order, so this also closes a
    // notification whose SHOW_NOTIFICATION is still queued there.
    try {
        swRegistration?.active?.postMessage({ type: 'CLOSE_NOTIFICATIONS', tag });
    } catch {
        /* worker gone */
    }
    try {
        const list = await swRegistration?.getNotifications({ tag });
        list?.forEach((n) => n.close());
    } catch {
        /* not supported */
    }
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
        /** Replacing a notification with the same tag alerts again. */
        renotify?: boolean;
        data?: Record<string, unknown>;
        onClick?: () => void;
    } = {}
): Promise<void> {
    // SerikaCord desktop app: native OS notification (avatar, click to jump,
    // closed once the conversation is read).
    if (isDesktopShell()) {
        const url = typeof options.data?.url === 'string' ? options.data.url : null;
        showDesktopNotification(title, body, {
            tag: options.tag,
            icon: options.icon || '/icons/icon-192x192.png',
            url,
            requireInteraction: options.requireInteraction,
            onClick: options.onClick,
        });
        return;
    }

    // Electron: Use native notifications via IPC
    if (isElectron()) {
        await window.electron!.notifications.show(title, body, options);
        return;
    }

    // Capacitor Mobile: Use LocalNotifications
    if (isMobileApp()) {
        // In the background the server push already notifies this phone.
        if (nativeAppState.background && nativeAppState.pushActive) return;
        if (!hasNativePlugin('LocalNotifications')) return;
        await callNative('LocalNotifications', 'schedule', {
            notifications: [{
                title,
                body,
                // Java int; stays unique enough within a session.
                id: Math.floor(Date.now() % 2_000_000_000),
                extra: { ...(options.data || {}), tag: options.tag },
                group: options.tag,
                // Channel created by newer APKs (MainActivity); older ones use the default.
                ...(hasNativePlugin('SerikaNative') ? { channelId: 'messages' } : {}),
                smallIcon: 'ic_stat_serika',
                iconColor: '#8B5CF6',
            }],
        });
        return;
    }

    // Web: nothing can be shown without permission (the service worker would
    // reject silently).
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

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
                requireInteraction: options.requireInteraction,
                renotify: Boolean(options.renotify && options.tag),
            },
        });
        return;
    }

    // Fallback: Direct Notification API
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        // Same tag replaces the previous one (grouped per conversation).
        if (options.tag) openNotifications.get(options.tag)?.close();
        const notification = new Notification(title, {
            body,
            icon: options.icon || '/icons/icon-192x192.png',
            tag: options.tag,
            requireInteraction: options.requireInteraction,
            ...(options.renotify && options.tag ? { renotify: true } : {}),
        } as NotificationOptions);
        if (options.tag) {
            openNotifications.set(options.tag, notification);
            notification.onclose = () => {
                if (openNotifications.get(options.tag!) === notification) openNotifications.delete(options.tag!);
            };
        }

        const url = typeof options.data?.url === 'string' ? options.data.url : null;
        if (options.onClick || url) {
            notification.onclick = () => {
                window.focus();
                if (options.onClick) options.onClick();
                else if (url) navigateInApp(url);
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
        addNativeListener('LocalNotifications', 'localNotificationActionPerformed', (event) => {
            const data = ((event as { notification?: { extra?: Record<string, unknown> } })?.notification?.extra || {}) as Record<string, unknown>;
            // Navigate in-app (no reload) based on notification data.
            if (typeof data.url === 'string') navigateInApp(data.url);
            else if (data.channelId && data.serverId) navigateInApp(`/channels/${data.serverId}/${data.channelId}`);
            else if (data.channelId && data.isDM) navigateInApp(data.recipientId ? `/dm/${data.recipientId}` : '/channels/messages');
            else if (data.type === 'friend-request') navigateInApp('/channels/me');
        });
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
