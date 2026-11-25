import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDomainServices,
  createInMemoryRepositories,
  type Repositories,
  type WorkoutDetail,
} from '@gym/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { GestureHandlerRootView, State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ConfirmHost } from '../components/ConfirmDialog';
import { SWIPE_ACTIVATE_X, SWIPE_FAIL_Y } from '../components/SwipeToDelete';
import { UndoToastHost } from '../components/UndoToast';
import { ActiveWorkout } from '../components/workout/ActiveWorkout';
import { DataProvider } from '../data/DataProvider';
import { needsWeight } from '../lib/weightRule';
import { colors } from '../theme';

import { router, routeParams } from './routerMock';

jest.mock(
  'expo-router',
  () => (jest.requireActual('./routerMock') as typeof import('./routerMock')).expoRouterMock,
);
jest.mock('../components/workout/RestTimerBar', () => ({ RestTimerBar: () => null }));
jest.mock('../lib/useNow', () => ({ useNow: () => Date.now() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};
const REMOVAL_MS = 150;
/** Past half the screen: a full swipe. */
const FULL = -Dimensions.get('window').width * 0.8;

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const settle = () => wait(0);

/** The owner's case: a free workout with "Aperturas con mancuernas" (3 sets, no history). */
async function openFlyes() {
  const repos: Repositories = createInMemoryRepositories();
  const services = createDomainServices(repos);
  const catalog = await repos.exercises.list();
  const flyes = catalog.find((e) => e.name === 'Aperturas con mancuernas')!;
  const free = await services.startFreeWorkout();
  await services.addExercisesToWorkout(free.id, [flyes.id]);
  const initial = (await repos.workouts.getById(free.id))!;
  await render(
    <GestureHandlerRootView>
      <SafeAreaProvider initialMetrics={METRICS}>
        <DataProvider repositories={repos}>
          <ActiveWorkout
            initial={initial}
            names={Object.fromEntries(catalog.map((e) => [e.id, e.name]))}
            previous={{}}
            bests={{}}
            unit="kg"
            restTimerEnabled={false}
            restNotifications="off"
            needsWeight={Object.fromEntries(catalog.map((e) => [e.id, needsWeight(e)]))}
            removalDelayMs={REMOVAL_MS}
          />
          <ConfirmHost />
          <UndoToastHost />
        </DataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
  return { repos, initial, setIds: initial.exercises[0]!.sets.map((s) => s.id) };
}

async function stored(repos: Repositories, w: WorkoutDetail) {
  return (await repos.workouts.getById(w.id))!.exercises[0]!.sets;
}

const setRows = () => screen.queryAllByLabelText(/^Serie \d+/);

async function tapCheck(n: number) {
  await fireEvent.press(screen.getByLabelText(`Completar serie ${n}`));
  await settle();
}

/** A pan on the set's row, from rest to `x` and released there. */
async function swipe(setId: string, x: number, y = 0) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(`swipe-set-${setId}`), [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: x / 2, translationY: y / 2 },
      { state: State.ACTIVE, translationX: x, translationY: y },
      { state: State.END, translationX: x, translationY: y },
    ]);
  });
  await settle();
}

type JsonNode = {
  type: string;
  props: { style?: unknown };
  children: (JsonNode | string)[] | null;
};

/** Red views that can be seen: not at opacity 0 themselves or through a parent. */
function visibleDanger(): JsonNode[] {
  const found: JsonNode[] = [];
  const walk = (node: JsonNode | string, hidden: boolean) => {
    if (typeof node === 'string') return;
    const style = (StyleSheet.flatten(node.props.style as never) ?? {}) as {
      backgroundColor?: string;
      opacity?: number;
    };
    const isHidden = hidden || style.opacity === 0;
    if (!isHidden && style.backgroundColor === colors.danger) found.push(node);
    for (const child of node.children ?? []) walk(child, isHidden);
  };
  const tree = screen.toJSON() as JsonNode | JsonNode[] | null;
  for (const root of Array.isArray(tree) ? tree : tree ? [tree] : []) walk(root, false);
  return found;
}

/** The "Quitar" actions that take touches: only a revealed one does. */
function openActions() {
  return screen.getAllByLabelText('Quitar', { includeHiddenElements: true }).filter((q) => {
    let n = q.parent;
    while (n && n.props.pointerEvents === undefined) n = n.parent;
    return n?.props.pointerEvents === 'auto';
  });
}

beforeEach(() => {
  routeParams.current = {};
  router.push.mockClear();
});

describe('✓ never removes a set', () => {
  it('tapping ✓ on each of 3 sets keeps the 3 and completes them', async () => {
    const { repos, initial } = await openFlyes();
    await fireEvent.changeText(screen.getByLabelText('Kg, serie 1'), '12');
    for (const n of [1, 2, 3]) await tapCheck(n);
    await wait(REMOVAL_MS * 2);

    const sets = await stored(repos, initial);
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.completed)).toBe(true);
    // The weight carries over to the next set, so all three have it.
    expect(sets.map((s) => s.weightKg)).toEqual([12, 12, 12]);
    expect(screen.queryByText('Serie quitada')).toBeNull();
  });

  it('the completed row has no visible red while it is not swiped', async () => {
    await openFlyes();
    await fireEvent.changeText(screen.getByLabelText('Kg, serie 1'), '12');
    await tapCheck(1);
    expect(visibleDanger()).toEqual([]);
    expect(openActions()).toHaveLength(0);
    // Its own background is opaque: nothing behind it shows through.
    expect(colors.successRow).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('a set goes only with a full swipe or "Quitar"', () => {
  it('the swipe needs a clear horizontal drag and gives way to a vertical scroll', async () => {
    const { setIds } = await openFlyes();
    const gesture = getByGestureTestId(`swipe-set-${setIds[0]}`) as unknown as {
      config: Record<string, unknown>;
    };
    expect(gesture.config).toMatchObject({
      activeOffsetXStart: -SWIPE_ACTIVATE_X,
      activeOffsetXEnd: SWIPE_ACTIVATE_X,
      failOffsetYStart: -SWIPE_FAIL_Y,
      failOffsetYEnd: SWIPE_FAIL_Y,
    });
    expect(SWIPE_ACTIVATE_X).toBeGreaterThanOrEqual(15);
  });

  it('a short swipe only reveals "Quitar"', async () => {
    const { repos, initial, setIds } = await openFlyes();
    await swipe(setIds[1]!, -70);
    expect(setRows()).toHaveLength(3);
    // Only that row's action takes touches (its red is drawn by the row's offset on the UI thread).
    expect(openActions()).toHaveLength(1);

    await wait(REMOVAL_MS * 2);
    expect(await stored(repos, initial)).toHaveLength(3);
  });

  it('a swipe to the right does nothing', async () => {
    const { setIds } = await openFlyes();
    await swipe(setIds[1]!, 200);
    expect(setRows()).toHaveLength(3);
    expect(openActions()).toHaveLength(0);
    expect(visibleDanger()).toEqual([]);
  });

  it('a full swipe removes it, with "Deshacer" for 5 s', async () => {
    const { repos, initial, setIds } = await openFlyes();
    await swipe(setIds[1]!, FULL);
    expect(setRows()).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('Deshacer'));
    await settle();
    expect(setRows()).toHaveLength(3);

    await swipe(setIds[1]!, FULL);
    await wait(REMOVAL_MS * 2);
    expect((await stored(repos, initial)).map((s) => s.id)).toEqual([setIds[0], setIds[2]]);
  });

  it('"Quitar" removes it once revealed', async () => {
    const { repos, initial, setIds } = await openFlyes();
    await swipe(setIds[2]!, -70);
    expect(openActions()).toHaveLength(1);
    await fireEvent.press(openActions()[0]!);
    await settle();
    expect(setRows()).toHaveLength(2);
    await wait(REMOVAL_MS * 2);
    expect(await stored(repos, initial)).toHaveLength(2);
  });
});

describe('empty kg (design/S4 rule for empty fields)', () => {
  it('a loaded exercise is not completed: the kg field gets focus instead', async () => {
    const { repos, initial } = await openFlyes();
    await tapCheck(1);
    expect((await stored(repos, initial))[0]!.completed).toBe(false);
    expect(screen.getByLabelText('Completar serie 1').props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('bodyweight and cardio complete without kg', () => {
    expect(needsWeight({ equipment: 'bodyweight', muscleGroup: 'back' })).toBe(false);
    expect(needsWeight({ equipment: 'machine', muscleGroup: 'cardio' })).toBe(false);
    expect(needsWeight({ equipment: undefined, muscleGroup: 'chest' })).toBe(false);
    expect(needsWeight({ equipment: 'dumbbell', muscleGroup: 'chest' })).toBe(true);
  });
});
