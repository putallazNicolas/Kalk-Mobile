import type { NextUp } from './restNotificationText';
import type { NotificationPermission } from './restNotifications';

/**
 * Web preview stand-in for restNotifications.ts: the browser build has no local notifications, and
 * loading expo-notifications there only logs a push-token warning. Same API, nothing happens.
 */

export type { NextUp } from './restNotificationText';
export type { NotificationPermission } from './restNotifications';

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
