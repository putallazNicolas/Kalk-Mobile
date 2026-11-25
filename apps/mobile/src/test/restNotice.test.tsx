import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDomainServices,
  createInMemoryRepositories,
  type RestNotificationState,
  type Repositories,
  type WorkoutDetail,
} from '@gym/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfirmHost } from '../components/ConfirmDialog';
import { ActiveWorkout } from '../components/workout/ActiveWorkout';
import { nextUpAfter } from '../components/workout/useRestNotification';
import { DataProvider } from '../data/DataProvider';
import { restNotificationText } from '../lib/restNotificationText';

jest.mock(
  'expo-router',
  () => (jest.requireActual('./routerMock') as typeof import('./routerMock')).expoRouterMock,
);
jest.mock('../lib/useNow', () => ({ useNow: () => Date.now() }));
// The real bar animates an SVG ring; here it only exposes its two actions.
jest.mock('../components/workout/RestTimerBar', () => {
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    RestTimerBar: ({ onAddTime, onDismiss }: { onAddTime: () => void; onDismiss: () => void }) => (
      <>
        <Pressable accessibilityLabel="Sumar 15 segundos" onPress={onAddTime}>
          <Text>+15 s</Text>
        </Pressable>
        <Pressable accessibilityLabel="Cerrar descanso" onPress={onDismiss}>
          <Text>✕</Text>
        </Pressable>
      </>
    ),
  };
});

let mockPermission = 'granted';
let mockNextId = 0;
// Built inside the factory (jest.mock is hoisted above the imports); read back with requireMock.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  scheduleNotificationAsync: jest.fn(async (_req: unknown) => `n${++mockNextId}`),
  cancelScheduledNotificationAsync: jest.fn(async (_id: string) => undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
type Fn = jest.Mock<(...args: unknown[]) => unknown>;
const mockNotifications = jest.requireMock<Record<string, Fn>>('expo-notifications') as {
  getPermissionsAsync: Fn;
  requestPermissionsAsync: Fn;
  scheduleNotificationAsync: Fn;
  cancelScheduledNotificationAsync: Fn;
};

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

async function open(mode: RestNotificationState, restSeconds = 90) {
  const repos: Repositories = createInMemoryRepositories();
  const services = createDomainServices(repos);
  const catalog = await repos.exercises.list();
  const routine = await repos.routines.create({ name: 'Fuerza' });
  await repos.routines.setActive(routine.id);
  const day = await repos.routines.addDay(routine.id, { name: 'Piernas A' });
  await repos.routines.addPlannedExercises(day.id, [
    { exerciseId: catalog[0]!.id, plannedSets: [{ reps: '10' }, { reps: '10' }], restSeconds },
    { exerciseId: catalog[1]!.id, restSeconds },
  ]);
  const started = await services.startWorkoutFromDay(day.id);
  const initial = (await repos.workouts.getById(started.id))!;
  const names = Object.fromEntries(catalog.map((e) => [e.id, e.name]));
  const view = await render(
    <GestureHandlerRootView>
      <SafeAreaProvider initialMetrics={METRICS}>
        <DataProvider repositories={repos}>
          <ActiveWorkout
            initial={initial}
            names={names}
            previous={{}}
            bests={{}}
            unit="kg"
            restTimerEnabled
            restNotifications={mode}
          />
          <ConfirmHost />
        </DataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
  return {
    repos,
    initial,
    names,
    first: names[catalog[0]!.id]!,
    second: names[catalog[1]!.id]!,
    view,
  };
}

async function complete(setNumber: number) {
  // Reps come from the plan, so ✓ completes it with nothing typed.
  await fireEvent.press(screen.getAllByLabelText(`Completar serie ${setNumber}`)[0]!);
  await settle();
}

type Scheduled = { content: { body: string }; trigger: { seconds: number } };
const lastScheduled = () =>
  mockNotifications.scheduleNotificationAsync.mock.calls.at(-1)?.[0] as Scheduled | undefined;

beforeEach(() => {
  mockPermission = 'granted';
  mockNextId = 0;
  jest.clearAllMocks();
});

describe('end-of-rest notification', () => {
  it('"on": schedules the rest with the next set, and +15 s reschedules it', async () => {
    const { first } = await open('on');
    await complete(1);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(lastScheduled()!.trigger.seconds).toBe(90);
    // The device language picks ES or EN (lib/restNotifications.test.ts covers both texts).
    expect(lastScheduled()!.content.body).toBe(
      restNotificationText({ exerciseName: first, setNumber: 2, totalSets: 2, newExercise: false })
        .body,
    );

    await fireEvent.press(screen.getByLabelText('Sumar 15 segundos'));
    await settle();
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n1');
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(lastScheduled()!.trigger.seconds).toBe(105);
  });

  it('the last set of an exercise announces the next exercise', async () => {
    const { second } = await open('on');
    await complete(1);
    await complete(2);
    expect(lastScheduled()!.content.body).toBe(
      restNotificationText({ exerciseName: second, setNumber: 1, totalSets: 3, newExercise: true })
        .body,
    );
    // The new rest replaced the previous one.
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n1');
  });

  it('closing the timer or leaving the screen cancels it', async () => {
    const { view } = await open('on');
    await complete(1);
    await fireEvent.press(screen.getByLabelText('Cerrar descanso'));
    await settle();
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n1');

    await complete(2);
    // Finishing or discarding leaves Entrenando: the screen unmounts with the rest running.
    await act(async () => view.unmount());
    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('n2');
  });

  it('"off" or a denied permission: nothing is scheduled and nothing is asked', async () => {
    await open('off');
    await complete(1);
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();

    mockPermission = 'denied';
    await open('on');
    await complete(1);
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('first-rest prompt', () => {
  it('"Activar aviso" asks iOS, saves "on" and schedules the rest in progress', async () => {
    const { repos } = await open('unasked');
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();
    await complete(1);
    expect(screen.getByText('¿Te avisamos al terminar?')).toBeTruthy();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Activar aviso'));
    await settle();
    expect(mockNotifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect((await repos.settings.get()).restNotifications).toBe('on');
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('iOS denies it: saved as "off"', async () => {
    mockPermission = 'denied';
    const { repos } = await open('unasked');
    await complete(1);
    await fireEvent.press(screen.getByText('Activar aviso'));
    await settle();
    expect((await repos.settings.get()).restNotifications).toBe('off');
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('"Ahora no" saves "off" without asking iOS, and the next rests do not ask', async () => {
    const { repos } = await open('unasked');
    await complete(1);
    await fireEvent.press(screen.getByText('Ahora no'));
    await settle();
    expect((await repos.settings.get()).restNotifications).toBe('off');
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();

    await complete(2);
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();
  });

  it('only the first rest: ignored, it goes away with that rest', async () => {
    await open('unasked');
    await complete(1);
    expect(screen.getByText('¿Te avisamos al terminar?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cerrar descanso'));
    await settle();
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();
    await complete(2);
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();
  });

  it('"Sin descanso" shows no timer, so no prompt either', async () => {
    await open('unasked', 0);
    await complete(1);
    expect(screen.queryByText('¿Te avisamos al terminar?')).toBeNull();
  });
});

describe('nextUpAfter', () => {
  it('skips skipped exercises and wraps to the ones above; null when all is done', async () => {
    const { initial, names } = await open('off');
    const [a, b] = initial.exercises as [
      WorkoutDetail['exercises'][0],
      WorkoutDetail['exercises'][0],
    ];
    const done = (e: typeof a) => ({ ...e, sets: e.sets.map((s) => ({ ...s, completed: true })) });
    const w = (exercises: typeof initial.exercises) => ({ ...initial, exercises });

    expect(nextUpAfter(w([a, done(b)]), b.id, names)).toMatchObject({
      setNumber: 1,
      totalSets: 2,
      newExercise: true,
    });
    expect(nextUpAfter(w([a, { ...done(b), skipped: true }]), a.id, names)?.newExercise).toBe(
      false,
    );
    expect(nextUpAfter(w([{ ...a, skipped: true }, done(b)]), b.id, names)).toBeNull();
  });
});
