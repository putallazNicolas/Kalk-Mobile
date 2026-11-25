/* global jest */
/**
 * Jest only. Under Jest the worklets resolve to their web build (see `resolver` in jest.config.js),
 * which has no UI runtime: gesture handler asks for its holder when it loads, so it gets an empty one.
 */
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  getUIRuntimeHolder: () => ({}),
}));

/**
 * expo-notifications warns about remote push in Expo Go as soon as it loads (jest-expo runs as
 * Expo Go). Tests never touch real notifications: a quiet stand-in, which a test can replace
 * with its own jest.mock (restNotice.test.tsx does).
 */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  scheduleNotificationAsync: jest.fn(async () => 'notification'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
