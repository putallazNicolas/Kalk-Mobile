import type { NextUp } from './restNotificationText';
import type { NotificationDiagnostics, NotificationPermission } from './restNotifications';

/**
 * Web preview stand-in for restNotifications.ts: the browser build has no local notifications, and
 * loading expo-notifications there only logs a push-token warning. Same API, nothing happens.
 */

export type { NextUp } from './restNotificationText';
export type { NotificationDiagnostics, NotificationPermission } from './restNotifications';

export const restNotificationsSupported = false;

export function installRestNotificationHandler(): void {}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  return 'denied';
}

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export function openNotificationSettings(): void {}

export async function scheduleRestEnd(_seconds: number, _next: NextUp): Promise<string | null> {
  return null;
}

export async function cancelRestEnd(_id: string | null): Promise<void> {}

export function lastNotificationError(): string | null {
  return null;
}

export async function readNotificationDiagnostics(): Promise<NotificationDiagnostics> {
  return { permission: null, scheduled: null, lastError: null };
}

export async function scheduleTestNotification(): Promise<string | null> {
  return null;
}
