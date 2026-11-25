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

/** The last thing that failed, for the Perfil diagnostics (Expo Go shows no console). */
let lastError: string | null = null;
export function lastNotificationError(): string | null {
  return lastError;
}

/** Never swallowed in silence: kept for the diagnostics and logged while developing. */
function report(what: string, error: unknown): void {
  lastError = `${what}: ${error instanceof Error ? error.message : String(error)}`;
  if (__DEV__) console.warn(`[rest notification] ${lastError}`);
}

/** Read every time, never stored (S6 §3). */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!restNotificationsSupported) return 'denied';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch (error) {
    report('reading the permission', error);
    return 'undetermined';
  }
}

/** Asks iOS (only after "Activar aviso" or turning the Perfil switch on). True if granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!restNotificationsSupported) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return status === 'granted';
  } catch (error) {
    report('asking for the permission', error);
    return false;
  }
}

/** "Abrir Ajustes" when the permission was denied in iOS. */
export function openNotificationSettings(): void {
  void Linking.openSettings();
}

/** Schedules a local notification `seconds` from now. Returns its id, or null. */
async function scheduleIn(seconds: number, title: string, body: string): Promise<string | null> {
  try {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.round(seconds),
        repeats: false,
      },
    });
  } catch (error) {
    report('scheduling', error);
    return null;
  }
}

/** Schedules the end-of-rest notification `seconds` from now. Returns its id, or null. */
export async function scheduleRestEnd(seconds: number, next: NextUp): Promise<string | null> {
  if (!restNotificationsSupported || seconds < 1) return null;
  let text;
  try {
    text = restNotificationText(next);
  } catch (error) {
    report('building the text', error);
    return null;
  }
  return scheduleIn(seconds, text.title, text.body);
}

export async function cancelRestEnd(id: string | null): Promise<void> {
  if (!restNotificationsSupported || id === null) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (error) {
    // Already delivered or gone: nothing left to cancel, but say so while developing.
    report('cancelling', error);
  }
}

/** What the Perfil diagnostics show (all read now, nothing stored). */
export interface NotificationDiagnostics {
  /** The whole getPermissionsAsync() answer, iOS fields included. */
  permission: Record<string, unknown> | null;
  scheduled: number | null;
  lastError: string | null;
}

export async function readNotificationDiagnostics(): Promise<NotificationDiagnostics> {
  let permission: Record<string, unknown> | null = null;
  let scheduled: number | null = null;
  try {
    permission = { ...(await Notifications.getPermissionsAsync()) };
  } catch (error) {
    report('reading the permission', error);
  }
  try {
    scheduled = (await Notifications.getAllScheduledNotificationsAsync()).length;
  } catch (error) {
    report('listing the scheduled ones', error);
  }
  return { permission, scheduled, lastError };
}

/** "Probar aviso en 5 s": the same kind of notification as a rest, to try with the phone locked. */
export async function scheduleTestNotification(): Promise<string | null> {
  if (!restNotificationsSupported) return null;
  return scheduleIn(5, 'Prueba de Kalk', 'Si ves esto con el teléfono bloqueado, el aviso anda.');
}
