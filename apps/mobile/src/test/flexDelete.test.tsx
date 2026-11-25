import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import {
  createDomainServices,
  createInMemoryRepositories,
  type DomainServices,
  type Repositories,
} from '@gym/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HoyScreen from '../app/(tabs)/index';
import { ConfirmHost } from '../components/ConfirmDialog';
import { UndoToastHost } from '../components/UndoToast';
import ReorderSheet from '../app/reordenar/[workoutId]';
import { ActiveWorkout } from '../components/workout/ActiveWorkout';
import { DataProvider } from '../data/DataProvider';
import { buildImpact } from '../lib/deleteWorkout';

import { router, routeParams } from './routerMock';

jest.mock(
  'expo-router',
  () => (jest.requireActual('./routerMock') as typeof import('./routerMock')).expoRouterMock,
);

jest.mock('../components/workout/RestTimerBar', () => ({ RestTimerBar: () => null }));
// A ticking clock updates state outside act() while the tests await the repositories.
jest.mock('../lib/useNow', () => ({ useNow: () => Date.now() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};
const DAY_MS = 86_400_000;

interface Fixture {
  repos: Repositories;
  services: DomainServices;
  /** Seed exercise ids, in the order the day plans them. */
  exercises: [string, string];
  dayId: string;
  /** Trains the day once: each pair is [kg, reps] of the single set of that exercise. */
  train: (...sets: [number, number][]) => Promise<string>;
}

/** A routine with one day and two exercises, and a clock that moves a day per workout. */
async function fixture(): Promise<Fixture> {
  let clock = Date.now() - 5 * DAY_MS;
  const now = () => new Date(clock);
  const repos = createInMemoryRepositories({ now });
  const services = createDomainServices(repos, { now });
  const catalog = await repos.exercises.list();
  const [first, second] = [catalog[0]!, catalog[1]!];
  const routine = await repos.routines.create({ name: 'Fuerza' });
  await repos.routines.setActive(routine.id);
  const day = await repos.routines.addDay(routine.id, { name: 'Piernas A' });
  await repos.routines.addPlannedExercises(day.id, [
    { exerciseId: first.id },
    { exerciseId: second.id },
  ]);
  return {
    repos,
    services,
    exercises: [first.id, second.id],
    dayId: day.id,
    async train(...sets) {
      const workout = await services.startWorkoutFromDay(day.id);
      for (const [i, [weightKg, reps]] of sets.entries()) {
        const setId = workout.exercises[i]!.sets[0]!.id;
        await services.completeSet(setId, { weightKg, reps });
      }
      clock += 30 * 60_000;
      await services.finishWorkout(workout.id);
      clock += DAY_MS;
      return workout.id;
    },
  };
}

function renderWith(fx: Fixture, ui: ReactElement) {
  return render(
    <GestureHandlerRootView>
      <SafeAreaProvider initialMetrics={METRICS}>
        <DataProvider repositories={fx.repos}>
          {ui}
          <ConfirmHost />
          <UndoToastHost />
        </DataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

describe('the impact box of the delete dialog', () => {
  it('names the record a workout goes back to, with its set and e1RM', async () => {
    const fx = await fixture();
    await fx.train([100, 5]);
    const second = await fx.train([105, 5]);
    const impact = buildImpact(await fx.services.getDeletionImpact(second), 'kg');
    expect(impact).toBeDefined();
    expect(impact?.heading).toBe('Tenía 1 récord');
    expect(impact?.lead).toMatch(/ vuelve a su récord anterior:$/);
    expect(impact?.emphasis).toBe('100 × 5');
    expect(impact?.tail).toBe('(e1RM 116,7 kg).');
  });

  it('shows the figures in the unit of the person', async () => {
    const fx = await fixture();
    await fx.train([100, 5]);
    const second = await fx.train([105, 5]);
    const impact = buildImpact(await fx.services.getDeletionImpact(second), 'lb');
    expect(impact?.emphasis).toBe('220,5 × 5');
    expect(impact?.tail).toBe('(e1RM 257,2 lb).');
  });

  it('with several records only counts them', async () => {
    const fx = await fixture();
    await fx.train([100, 5], [60, 5]);
    const second = await fx.train([105, 5], [65, 5]);
    const impact = buildImpact(await fx.services.getDeletionImpact(second), 'kg');
    expect(impact?.lead).toBe('Tenía 2 récords: vuelven a los anteriores.');
    expect(impact?.emphasis).toBeUndefined();
  });

  it('is absent when the workout set no record', async () => {
    const fx = await fixture();
    await fx.train([100, 5]);
    const second = await fx.train([90, 5]);
    expect(buildImpact(await fx.services.getDeletionImpact(second), 'kg')).toBeUndefined();
  });
});

describe('deleting a finished workout from Hoy', () => {
  beforeEach(() => {
    routeParams.current = {};
  });

  async function deleteSecond() {
    const fx = await fixture();
    const first = await fx.train([100, 5]);
    const second = await fx.train([105, 5]);
    await renderWith(fx, <HoyScreen />);
    // Newest first; the swipe has an accessible alternative on the row itself.
    const rows = await screen.findAllByLabelText(/^Piernas A, /);
    expect(rows).toHaveLength(2);
    await fireEvent(rows[0]!, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    return { fx, first, second };
  }

  it('asks first, explaining the record that goes back', async () => {
    const { fx, second } = await deleteSecond();
    expect(await screen.findByText(/¿Eliminar Piernas A del/i)).toBeTruthy();
    expect(screen.getByText('Se borra su serie del historial y del progreso.')).toBeTruthy();
    const box = screen.getByLabelText('Récords que se ven afectados');
    expect(within(box).getByText('Tenía 1 récord')).toBeTruthy();
    expect(within(box).getByText(/vuelve a su récord anterior:/)).toBeTruthy();
    expect(within(box).getByText(/100 × 5/)).toBeTruthy();
    // Nothing is deleted until the person confirms.
    expect(await fx.repos.workouts.getById(second)).not.toBeNull();
  });

  it('cancelling keeps the workout', async () => {
    const { fx, second } = await deleteSecond();
    await fireEvent.press(await screen.findByLabelText('Cancelar'));
    await settle();
    expect(await fx.repos.workouts.getById(second)).not.toBeNull();
    expect(screen.queryByLabelText('Deshacer')).toBeNull();
  });

  it('deletes on confirm and "Deshacer" brings it back', async () => {
    const { fx, first, second } = await deleteSecond();
    await fireEvent.press(await screen.findByLabelText('Eliminar'));
    await settle();

    expect(await fx.repos.workouts.getById(second)).toBeNull();
    expect(await fx.repos.workouts.getById(first)).not.toBeNull();
    expect(await screen.findByText('Piernas A eliminado')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Piernas A, /)).toHaveLength(1);

    await fireEvent.press(screen.getByLabelText('Deshacer'));
    await settle();

    expect(await fx.repos.workouts.getById(second)).not.toBeNull();
    expect(await screen.findAllByLabelText(/^Piernas A, /)).toHaveLength(2);
  });
});

describe('Entrenando: discard', () => {
  beforeEach(() => {
    router.dismissAll.mockClear();
  });

  async function openWorkout(completeFirstSet: boolean) {
    const fx = await fixture();
    const started = await fx.services.startWorkoutFromDay(fx.dayId);
    if (completeFirstSet)
      await fx.services.completeSet(started.exercises[0]!.sets[0]!.id, { weightKg: 60, reps: 10 });
    const initial = (await fx.repos.workouts.getById(started.id))!;
    await renderWith(
      fx,
      <ActiveWorkout
        initial={initial}
        names={{}}
        previous={{}}
        bests={{}}
        unit="kg"
        restTimerEnabled={false}
        restNotifications="off"
      />,
    );
    return { fx, id: started.id };
  }

  const openMenu = () => fireEvent.press(screen.getByLabelText('Opciones del entrenamiento'));

  it('with completed sets it says what is lost and discards on confirm', async () => {
    const { fx, id } = await openWorkout(true);
    await openMenu();
    await fireEvent.press(screen.getByLabelText('Descartar entrenamiento, 1 serie'));
    expect(await screen.findByText('¿Descartar Piernas A?')).toBeTruthy();
    expect(
      screen.getByText(
        'Se borra la serie que cargaste hoy y no queda en el historial. La rutina no cambia.',
      ),
    ).toBeTruthy();
    expect(await fx.repos.workouts.getById(id)).not.toBeNull();

    await fireEvent.press(screen.getByLabelText('Descartar'));
    await settle();
    expect(await fx.repos.workouts.getById(id)).toBeNull();
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it('"Seguir" keeps the workout', async () => {
    const { fx, id } = await openWorkout(true);
    await openMenu();
    await fireEvent.press(screen.getByLabelText('Descartar entrenamiento, 1 serie'));
    await fireEvent.press(await screen.findByLabelText('Seguir'));
    await settle();
    expect(await fx.repos.workouts.getById(id)).not.toBeNull();
    expect(router.dismissAll).not.toHaveBeenCalled();
  });

  it('without completed sets it discards right away', async () => {
    const { fx, id } = await openWorkout(false);
    await openMenu();
    await fireEvent.press(screen.getByLabelText('Descartar entrenamiento'));
    await settle();
    expect(screen.queryByText(/¿Descartar/)).toBeNull();
    expect(await fx.repos.workouts.getById(id)).toBeNull();
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it('"Finalizar" with nothing done offers to discard instead of saving an empty workout', async () => {
    const { fx, id } = await openWorkout(false);
    // "Finalizar" waits on the dialog, so the press must not be awaited.
    void fireEvent.press(screen.getByLabelText('Finalizar'));
    expect(await screen.findByText('No hay nada para guardar')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Descartar'));
    await settle();
    expect(await fx.repos.workouts.getById(id)).toBeNull();
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
  });

  it('"Agregar ejercicio" opens the picker for this workout, after the exercise in progress', async () => {
    const { id } = await openWorkout(false);
    router.push.mockClear();
    await openMenu();
    // The sheet's row (the end-of-list button has the same label and is rendered before it).
    await fireEvent.press(screen.getAllByLabelText('Agregar ejercicio').at(-1)!);
    await settle();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/elegir-ejercicio',
      params: { workoutId: id, afterOrder: '0' },
    });
  });
});

describe('Reordenar ejercicios', () => {
  it('moves the pending exercises and keeps the finished one on top', async () => {
    const fx = await fixture();
    const catalog = await fx.repos.exercises.list();
    const started = await fx.services.startWorkoutFromDay(fx.dayId);
    // Three exercises; the second is finished, so it must end up first and locked.
    await fx.services.addExercisesToWorkout(started.id, [catalog[2]!.id]);
    await fx.services.completeSet(started.exercises[1]!.sets[0]!.id, { weightKg: 50, reps: 10 });
    for (const set of started.exercises[1]!.sets.slice(1))
      await fx.services.completeSet(set.id, { weightKg: 50, reps: 10 });
    routeParams.current = { workoutId: started.id };
    await renderWith(fx, <ReorderSheet />);

    const orderedIds = async () =>
      (await fx.repos.workouts.getById(started.id))!.exercises.map((e) => e.exerciseId);
    await screen.findByText('Reordenar ejercicios');
    expect(screen.queryByLabelText(`Subir ${catalog[1]!.name}`)).toBeNull();

    // The first pending one is the planned first exercise: it goes down one place.
    await fireEvent.press(screen.getByLabelText(`Bajar ${catalog[0]!.name}`));
    await settle();
    expect(await orderedIds()).toEqual([catalog[1]!.id, catalog[2]!.id, catalog[0]!.id]);
  });
});
