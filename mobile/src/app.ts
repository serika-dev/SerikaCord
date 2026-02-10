import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Toast } from '@capacitor/toast';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';

// Helper to set user status
const setUserStatus = async (status: 'online' | 'idle' | 'offline') => {
  try {
    await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
      credentials: 'include',
    });
  } catch (error) {
    console.error('Failed to update status:', error);
  }
};

// Initialize the app
const initApp = async () => {
  // Hide splash screen after app loads
  await SplashScreen.hide();

  // Configure status bar
  if (Capacitor.isNativePlatform()) {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0a0a0a' });
  }
  
  // Set user online when app starts
  await setUserStatus('online');
  
  // Request push notification permissions
  if (Capacitor.isNativePlatform()) {
    // Request notification permissions
    const permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display === 'prompt' || permStatus.display === 'prompt-with-rationale') {
      await LocalNotifications.requestPermissions();
    }

    // Handle notification tap - navigate to the relevant channel
    LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      console.log('Notification tapped:', notification);
      const extra = notification.notification.extra || {};

      // Navigate based on notification data
      if (extra.channelId && extra.serverId) {
        window.location.href = `/channels/${extra.serverId}/${extra.channelId}`;
      } else if (extra.channelId && extra.isDM) {
        window.location.href = `/channels/@me/${extra.channelId}`;
      } else if (extra.type === 'friend-request') {
        window.location.href = '/channels/me';
      } else if (extra.type === 'mention') {
        window.location.href = `/channels/${extra.serverId}/${extra.channelId}`;
      }
    });

    // Handle notification received while app is in foreground
    LocalNotifications.addListener('localNotificationReceived', (notification) => {
      console.log('Notification received in foreground:', notification);
      // Optionally show in-app notification banner
    });
  }

  // Handle app URL open (deep links)
  App.addListener('appUrlOpen', async ({ url }) => {
    console.log('App opened with URL:', url);
    // Handle serikacord:// deep links
    if (url.startsWith('serikacord://')) {
      const path = url.replace('serikacord://', '/');
      window.location.href = path;
    }
  });

  // Handle back button on Android
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.exitApp();
    }
  });
  
  // Handle app state changes (foreground/background)
  App.addListener('appStateChange', async ({ isActive }) => {
    if (isActive) {
      // App came to foreground - set online
      await setUserStatus('online');
    } else {
      // App went to background - set offline
      await setUserStatus('offline');
    }
  });
  
  // Handle app pause (going to background)
  App.addListener('pause', async () => {
    await setUserStatus('offline');
  });
  
  // Handle app resume (coming back from background)
  App.addListener('resume', async () => {
    await setUserStatus('online');
  });
  
  // Handle keyboard events
  if (Capacitor.isNativePlatform()) {
    Keyboard.addListener('keyboardWillShow', info => {
      document.body.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      document.body.classList.add('keyboard-open');
    });

    Keyboard.addListener('keyboardWillHide', () => {
      document.body.style.setProperty('--keyboard-height', '0px');
      document.body.classList.remove('keyboard-open');
    });
  }
};

// Haptic feedback utility
export const haptic = {
  light: () => Haptics.impact({ style: ImpactStyle.Light }),
  medium: () => Haptics.impact({ style: ImpactStyle.Medium }),
  heavy: () => Haptics.impact({ style: ImpactStyle.Heavy }),
};

// Toast utility
export const toast = {
  show: (text: string, duration: 'short' | 'long' = 'short') => {
    Toast.show({ text, duration });
  }
};

// Share utility
export const share = async (title: string, text: string, url?: string) => {
  try {
    await Share.share({ title, text, url });
  } catch (error) {
    console.error('Error sharing:', error);
  }
};

// Open external URL
export const openExternal = async (url: string) => {
  await Browser.open({ url });
};

// Check if running as native app
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

// Initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'complete') {
    initApp();
  } else {
    document.addEventListener('DOMContentLoaded', initApp);
  }
}

export default {
  haptic,
  toast,
  share,
  openExternal,
  isNative,
  platform,
};
