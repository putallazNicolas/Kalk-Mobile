import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDomainServices,
  createInMemoryRepositories,
  type DomainServices,
  type Repositories,
  type WorkoutDetail,
} from '@gym/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import PickExerciseScreen from '../app/elegir-ejercicio';
import SummaryScreen from '../app/resumen/[workoutId]';
import { ConfirmHost } from '../components/ConfirmDialog';
import { UndoToastHost } from '../components/UndoToast';
import { ActiveWorkout } from '../components/workout/ActiveWorkout';
import { DataProvider } from '../data/DataProvider';

import { router, routeParams } from './routerMock';

jest.mock(
  'expo-router',
  () => (jest.requireActual('./routerMock') as typeof import('./routerMock')).expoRouterMock,
);
// Gestures cannot run under Jest: the swipeable row renders plain and the tests use the row's
// accessibility action "Quitar serie", which does the same as a full swipe.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}));
jest.mock('../components/workout/RestTimerBar', () => ({ RestTimerBar: () => null }));
jest.mock('../lib/useNow', () => ({ useNow: () => Date.now() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};
/** Short enough to wait for in a test; the app waits the toast's 5 s. */
const REMOVAL_MS = 150;

interface Fixture {
  repos: Repositories;
  services: DomainServices;
  dayId: string;
  names: Record<string, string>;
  /** Catalog exercise ids planned in the day, in order. */
  planned: [string, string];
  /** A catalog exercise that is not in the day. */
  other: string;
}

/** A routine with one day ("Piernas A") and two planned exercises. */
async function fixture(): Promise<Fixture> {
  const repos = createInMemoryRepositories();
  const services = createDomainServices(repos);
  const catalog = await repos.exercises.list();
  const routine = await repos.routines.create({ name: 'Fuerza' });
  await repos.routines.setActive(routine.id);
  const day = await repos.routines.addDay(routine.id, { name: 'Piernas A' });
  await repos.routines.addPlannedExercises(day.id, [
    { exerciseId: catalog[0]!.id },
    { exerciseId: catalog[1]!.id },
  ]);
  return {
    repos,
    services,
    dayId: day.id,
    names: Object.fromEntries(catalog.map((e) => [e.id, e.name])),
    planned: [catalog[0]!.id, catalog[1]!.id],
    other: catalog[2]!.id,
  };
}

function renderWith(f: Fixture, ui: ReactElement) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <DataProvider repositories={f.repos}>
        {ui}
        <ConfirmHost />
        <UndoToastHost />
      </DataProvider>
    </SafeAreaProvider>,
  );
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const settle = () => wait(0);

async function workoutOf(f: Fixture, id: string): Promise<WorkoutDetail> {
  return (await f.repos.workouts.getById(id))!;
}

/** Starts the day and renders Entrenando; `prepare` can complete sets before it opens. */
async function openWorkout(
  f: Fixture,
  prepare?: (w: WorkoutDetail) => Promise<void>,
  removalDelayMs = REMOVAL_MS,
) {
  const started = await f.services.startWorkoutFromDay(f.dayId);
  await prepare?.(started);
  const initial = await workoutOf(f, started.id);
  await renderWith(
    f,
    <ActiveWorkout
      initial={initial}
      names={f.names}
      previous={{}}
      bests={{}}
      unit="kg"
      restTimerEnabled={false}
      removalDelayMs={removalDelayMs}
    />,
  );
  return initial;
}

const removeAction = { nativeEvent: { actionName: 'delete' } };
const setCount = () => screen.queryAllByLabelText(/^Serie \d+/).length;

beforeEach(() => {
  routeParams.current = {};
  router.push.mockClear();
  router.replace.mockClear();
});

describe('"+ Serie"', () => {
  it('adds a set, copies the weight of the last one and tags it AGREGADA', async () => {
    const f = await fixture();
    const initial = await openWorkout(f, async (w) => {
      await f.repos.workouts.updateSet(w.exercises[0]!.sets[0]!.id, { weightKg: 60 });
      await f.repos.workouts.updateSet(w.exercises[0]!.sets.at(-1)!.id, { weightKg: 62.5 });
    });
    const before = initial.exercises[0]!.sets.length;
    expect(screen.queryByText('Agregada')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Agregar serie'));
    await settle();

    const stored = (await workoutOf(f, initial.id)).exercises[0]!.sets;
    expect(stored).toHaveLength(before + 1);
    expect(stored.at(-1)).toMatchObject({ source: 'added', weightKg: 62.5, completed: false });
    expect(setCount()).toBe(before + 1);
    expect(screen.getByText('Agregada')).toBeTruthy();
  });
});

describe('removing a set', () => {
  async function removeFirstSet() {
    const f = await fixture();
    const initial = await openWorkout(f);
    const sets = initial.exercises[0]!.sets.length;
    expect(setCount()).toBe(sets);
    await fireEvent(screen.getByLabelText('Serie 1'), 'accessibilityAction', removeAction);
    return { f, initial, sets };
  }

  it('is gone from the screen at once but nothing is written until the toast expires', async () => {
    const { f, initial, sets } = await removeFirstSet();
    expect(await screen.findByText('Serie quitada')).toBeTruthy();
    expect(setCount()).toBe(sets - 1);
    expect((await workoutOf(f, initial.id)).exercises[0]!.sets).toHaveLength(sets);

    await wait(REMOVAL_MS * 3);
    expect((await workoutOf(f, initial.id)).exercises[0]!.sets).toHaveLength(sets - 1);
  });

  it('"Deshacer" brings it back and writes nothing', async () => {
    const { f, initial, sets } = await removeFirstSet();
    await fireEvent.press(await screen.findByLabelText('Deshacer'));
    expect(setCount()).toBe(sets);

    await wait(REMOVAL_MS * 3);
    expect((await workoutOf(f, initial.id)).exercises[0]!.sets).toHaveLength(sets);
    expect(setCount()).toBe(sets);
  });

  it('a second removal writes the first one', async () => {
    const { f, initial, sets } = await removeFirstSet();
    await fireEvent(screen.getByLabelText('Serie 1'), 'accessibilityAction', removeAction);
    await settle();
    expect((await workoutOf(f, initial.id)).exercises[0]!.sets).toHaveLength(sets - 1);
  });

  it('finishing writes a pending removal BEFORE finishing, so the totals are right', async () => {
    const f = await fixture();
    let total = 0;
    const initial = await openWorkout(
      f,
      async (w) => {
        // Everything done but the last set of the second exercise: the one that gets removed.
        const all = w.exercises.flatMap((e) => e.sets);
        total = all.length;
        for (const s of all.slice(0, -1))
          await f.services.completeSet(s.id, { weightKg: 50, reps: 10 });
      },
      60_000,
    );
    // The open exercise is the second one, with a single pending set.
    await fireEvent(
      screen.getByLabelText(`Serie ${initial.exercises[1]!.sets.length}`),
      'accessibilityAction',
      removeAction,
    );
    await settle();
    expect((await workoutOf(f, initial.id)).exercises[1]!.sets).toHaveLength(
      initial.exercises[1]!.sets.length,
    );

    await fireEvent.press(screen.getByLabelText('Finalizar'));
    await settle();

    const done = await workoutOf(f, initial.id);
    expect(done.finishedAt).toBeDefined();
    expect(done.exercises[1]!.sets).toHaveLength(initial.exercises[1]!.sets.length - 1);
    expect(done.exercises.flatMap((e) => e.sets)).toHaveLength(total - 1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    const summary = await f.services.getWorkoutSummary(initial.id);
    expect(summary.totalSets).toBe(total - 1);
    expect(summary.completedSets).toBe(total - 1);
  });
});

describe('ExerciseMenu', () => {
  const openMenu = (name: string) => fireEvent.press(screen.getByLabelText(`Menú de ${name}`));

  it('"Mover abajo" reorders and saves', async () => {
    const f = await fixture();
    const initial = await openWorkout(f);
    await openMenu(f.names[f.planned[0]]!);
    await fireEvent.press(screen.getByLabelText('Mover abajo'));
    await settle();
    const ids = (await workoutOf(f, initial.id)).exercises.map((e) => e.exerciseId);
    expect(ids).toEqual([f.planned[1], f.planned[0]]);
  });

  it('the first exercise cannot go up', async () => {
    const f = await fixture();
    await openWorkout(f);
    await openMenu(f.names[f.planned[0]]!);
    expect(screen.queryByLabelText('Mover arriba')).toBeNull();
    expect(screen.getByLabelText('Mover abajo')).toBeTruthy();
  });

  it('a long press on another row opens the same menu', async () => {
    const f = await fixture();
    await openWorkout(f);
    const row = screen.getByLabelText(new RegExp(`^Siguiente: ${f.names[f.planned[1]]}`));
    await fireEvent(row, 'longPress');
    expect(await screen.findByLabelText('Quitar ejercicio')).toBeTruthy();
  });

  it('"Quitar ejercicio" removes it from the screen and writes after the toast', async () => {
    const f = await fixture();
    const initial = await openWorkout(f);
    await openMenu(f.names[f.planned[0]]!);
    await fireEvent.press(screen.getByLabelText('Quitar ejercicio'));
    await settle();

    expect(await screen.findByText(`${f.names[f.planned[0]]} quitado`)).toBeTruthy();
    expect((await workoutOf(f, initial.id)).exercises).toHaveLength(2);
    await wait(REMOVAL_MS * 3);
    const left = (await workoutOf(f, initial.id)).exercises;
    expect(left.map((e) => e.exerciseId)).toEqual([f.planned[1]]);
  });

  it('"Quitar ejercicio" with "Deshacer" keeps it', async () => {
    const f = await fixture();
    const initial = await openWorkout(f);
    await openMenu(f.names[f.planned[0]]!);
    await fireEvent.press(screen.getByLabelText('Quitar ejercicio'));
    await fireEvent.press(await screen.findByLabelText('Deshacer'));
    await wait(REMOVAL_MS * 3);
    expect((await workoutOf(f, initial.id)).exercises).toHaveLength(2);
    expect(screen.getByLabelText(`Menú de ${f.names[f.planned[0]]}`)).toBeTruthy();
  });

  it('removing an exercise with done sets asks first and says how many are lost', async () => {
    const f = await fixture();
    const initial = await openWorkout(f, async (w) => {
      await f.services.completeSet(w.exercises[0]!.sets[0]!.id, { weightKg: 50, reps: 10 });
      await f.services.completeSet(w.exercises[0]!.sets[1]!.id, { weightKg: 50, reps: 10 });
    });
    await openMenu(f.names[f.planned[0]]!);
    await fireEvent.press(screen.getByLabelText('Quitar ejercicio'));
    expect(await screen.findByText(`¿Quitar ${f.names[f.planned[0]]}?`)).toBeTruthy();
    expect(
      screen.getByText('Se pierden las 2 series que ya hiciste de este ejercicio.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Cancelar'));
    await wait(REMOVAL_MS * 3);
    expect((await workoutOf(f, initial.id)).exercises).toHaveLength(2);

    await openMenu(f.names[f.planned[0]]!);
    await fireEvent.press(screen.getByLabelText('Quitar ejercicio'));
    await fireEvent.press(await screen.findByLabelText('Quitar'));
    await wait(REMOVAL_MS * 3);
    expect((await workoutOf(f, initial.id)).exercises).toHaveLength(1);
  });

  it('"Reemplazar ejercicio" opens the picker for this one, after the same position', async () => {
    const f = await fixture();
    const initial = await openWorkout(f);
    await openMenu(f.names[f.planned[0]]!);
    await fireEvent.press(screen.getByLabelText('Reemplazar ejercicio'));
    await settle();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/elegir-ejercicio',
      params: {
        workoutId: initial.id,
        afterOrder: '0',
        replaceId: initial.exercises[0]!.id,
      },
    });
  });
});

describe('PlanChangesCard in the Resumen', () => {
  /** A finished routine workout that added a set to the first exercise and dropped the second. */
  async function finishedWithChanges(f: Fixture) {
    const w = await f.services.startWorkoutFromDay(f.dayId);
    await f.repos.workouts.addSet(w.exercises[0]!.id);
    await f.repos.workouts.removeWorkoutExercise(w.exercises[1]!.id);
    const current = await workoutOf(f, w.id);
    for (const s of current.exercises[0]!.sets)
      await f.services.completeSet(s.id, { weightKg: 50, reps: 10 });
    await f.services.finishWorkout(w.id);
    routeParams.current = { workoutId: w.id };
    return w.id;
  }

  const planOfDay = async (f: Fixture) => (await f.repos.routines.getDay(f.dayId))!.exercises;

  it('lists the changes; "Actualizar" changes the routine', async () => {
    const f = await fixture();
    const before = (await planOfDay(f))[0]!.plannedSets.length;
    await finishedWithChanges(f);
    await renderWith(f, <SummaryScreen />);

    expect(await screen.findByText('Cambiaste el plan de Piernas A')).toBeTruthy();
    expect(
      screen.getByText(`${f.names[f.planned[0]]}: ${before} → ${before + 1} series`),
    ).toBeTruthy();
    expect(screen.getByText(f.names[f.planned[1]]!)).toBeTruthy();
    // Nothing changed yet: the routine only changes if the owner taps "Actualizar".
    expect(await planOfDay(f)).toHaveLength(2);

    await fireEvent.press(screen.getByLabelText('Actualizar Piernas A'));
    await settle();

    const day = await planOfDay(f);
    expect(day).toHaveLength(1);
    expect(day[0]!.exerciseId).toBe(f.planned[0]);
    expect(day[0]!.plannedSets).toHaveLength(before + 1);
    expect(
      screen.getByText('Listo: Piernas A queda con estos cambios desde el próximo entreno.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Actualizar Piernas A')).toBeNull();
  });

  it('"Dejar la rutina como está" does not touch the routine', async () => {
    const f = await fixture();
    const id = await finishedWithChanges(f);
    await renderWith(f, <SummaryScreen />);

    await fireEvent.press(await screen.findByLabelText('Dejar la rutina como está'));
    await settle();

    expect(await planOfDay(f)).toHaveLength(2);
    expect(
      screen.getByText('La rutina queda igual. Los cambios quedan solo en este entreno.'),
    ).toBeTruthy();
    expect((await workoutOf(f, id)).planChangeDecision).toBe('kept');
  });

  it('shows no card when the plan did not change', async () => {
    const f = await fixture();
    const w = await f.services.startWorkoutFromDay(f.dayId);
    for (const s of w.exercises.flatMap((e) => e.sets))
      await f.services.completeSet(s.id, { weightKg: 50, reps: 10 });
    await f.services.finishWorkout(w.id);
    routeParams.current = { workoutId: w.id };
    await renderWith(f, <SummaryScreen />);

    expect(await screen.findByText('Entrenamiento terminado')).toBeTruthy();
    expect(screen.queryByText(/Cambiaste el plan/)).toBeNull();
    expect(screen.queryByLabelText('Dejar la rutina como está')).toBeNull();
  });

  it('says the routine changed while training and offers nothing', async () => {
    const f = await fixture();
    const w = await f.services.startWorkoutFromDay(f.dayId);
    await f.repos.workouts.addSet(w.exercises[0]!.id);
    // The routine is edited meanwhile.
    await f.repos.routines.addPlannedExercises(f.dayId, [{ exerciseId: f.other }]);
    for (const s of (await workoutOf(f, w.id)).exercises.flatMap((e) => e.sets))
      await f.services.completeSet(s.id, { weightKg: 50, reps: 10 });
    await f.services.finishWorkout(w.id);
    routeParams.current = { workoutId: w.id };
    await renderWith(f, <SummaryScreen />);

    expect(
      await screen.findByText('La rutina cambió mientras entrenabas. Editala en Rutinas'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Actualizar Piernas A')).toBeNull();
    expect(await planOfDay(f)).toHaveLength(3);
  });
});

describe('Elegir ejercicio in replace mode', () => {
  it('picks one exercise and puts it where the old one was', async () => {
    const f = await fixture();
    const w = await f.services.startWorkoutFromDay(f.dayId);
    routeParams.current = {
      workoutId: w.id,
      afterOrder: '0',
      replaceId: w.exercises[0]!.id,
    };
    await renderWith(f, <PickExerciseScreen />);

    const pick = async (name: string) =>
      fireEvent.press(await screen.findByLabelText(new RegExp(`^${name}, `)));
    await pick(f.names[f.other]!);
    // Single select: choosing another one moves the selection instead of adding to it.
    await pick(f.names[f.planned[1]]!);
    await pick(f.names[f.other]!);
    await fireEvent.press(screen.getByLabelText('Reemplazar'));
    await settle();

    const ids = (await workoutOf(f, w.id)).exercises.map((e) => e.exerciseId);
    expect(ids).toEqual([f.other, f.planned[1]]);
    expect(router.back).toHaveBeenCalled();
  });
});
