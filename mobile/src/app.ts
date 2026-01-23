import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Toast } from '@capacitor/toast';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';

// Initialize the app
const initApp = async () => {
  // Hide splash screen after app loads
  await SplashScreen.hide();
  
  // Configure status bar
  if (Capacitor.isNativePlatform()) {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0a0a0a' });
  }
  
  // Request push notification permissions
  if (Capacitor.isNativePlatform()) {
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive === 'prompt') {
      await PushNotifications.requestPermissions();
    }
    
    // Register for push notifications
    await PushNotifications.register();
    
    // Handle push notification received while app is open
    PushNotifications.addListener('pushNotificationReceived', notification => {
      console.log('Push notification received:', notification);
      // Show local notification
      LocalNotifications.schedule({
        notifications: [{
          title: notification.title || 'SerikaCord',
          body: notification.body || '',
          id: Date.now(),
        }]
      });
    });
    
    // Handle push notification action
    PushNotifications.addListener('pushNotificationActionPerformed', action => {
      console.log('Push notification action:', action);
      // Navigate to relevant page based on notification data
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
