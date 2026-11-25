import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { restNotificationText, type NextUp } from './restNotificationText';

export type { NextUp } from './restNotificationText';

/**
 * Local notification when a rest ends (design/S6 §6). Only local notifications: no push, no
 * server. The id of the scheduled one lives in memory while the rest lasts.
 */

/** Native only: the web preview loads restNotifications.web.ts instead of this file. */
export const restNotificationsSupported = Platform.OS !== 'web';

let handlerSet = false;
/**
 * With the app in the foreground the notification is not shown, listed or played: the haptic and
 * "A LA BARRA" already say the rest is over (S6 §6).
 */
export function installRestNotificationHandler(): void {
  if (!restNotificationsSupported || handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

/** Read every time, never stored (S6 §3). */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!restNotificationsSupported) return 'denied';
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** Asks iOS (only after "Activar aviso" or turning the Perfil switch on). True if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!restNotificationsSupported) return false;
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return status === 'granted';
}

/** "Abrir Ajustes" when the permission was denied in iOS. */
export function openNotificationSettings(): void {
  void Linking.openSettings();
}

/** Schedules the end-of-rest notification `seconds` from now. Returns its id, or null. */
export async function scheduleRestEnd(seconds: number, next: NextUp): Promise<string | null> {
  if (!restNotificationsSupported || seconds < 1) return null;
  const { title, body } = restNotificationText(next);
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(seconds),
        repeats: false,
      },
    });
  } catch {
    return null;
  }
}

export async function cancelRestEnd(id: string | null): Promise<void> {
  if (!restNotificationsSupported || id === null) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered or gone: nothing to cancel.
  }
}
