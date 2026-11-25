import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createDomainServices,
  createInMemoryRepositories,
  type DomainServices,
  type Repositories,
} from '@gym/core';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HoyScreen from '../app/(tabs)/index';
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
jest.mock('../components/workout/RestTimerBar', () => ({ RestTimerBar: () => null }));
jest.mock('../lib/useNow', () => ({ useNow: () => Date.now() }));

const METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

interface Fx {
  repos: Repositories;
  services: DomainServices;
}

function fx(): Fx {
  const repos = createInMemoryRepositories();
  return { repos, services: createDomainServices(repos) };
}

function renderWith({ repos }: Fx, ui: ReactElement) {
  return render(
    <GestureHandlerRootView>
      <SafeAreaProvider initialMetrics={METRICS}>
        <DataProvider repositories={repos}>
          {ui}
          <ConfirmHost />
          <UndoToastHost />
        </DataProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

/** A finished free workout with one completed set of the first catalog exercise. */
async function finishedFree({ repos, services }: Fx) {
  const free = await services.startFreeWorkout();
  const [exercise] = await repos.exercises.list();
  const withExercise = await services.addExercisesToWorkout(free.id, [exercise!.id]);
  const set = withExercise.exercises[0]!.sets[0]!;
  await services.completeSet(set.id, { weightKg: 50, reps: 10 });
  return services.finishWorkout(free.id);
}

describe('Entreno libre from Hoy', () => {
  beforeEach(() => {
    router.push.mockClear();
    routeParams.current = {};
  });

  it('Hoy vacía offers it and starts an empty free workout', async () => {
    const f = fx();
    await renderWith(f, <HoyScreen />);
    await fireEvent.press(await screen.findByText('Entreno libre, sin rutina'));
    await settle();
    const inProgress = await f.repos.workouts.getInProgress();
    expect(inProgress?.kind).toBe('free');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/entrenando/[workoutId]',
      params: { workoutId: inProgress!.id },
    });
  });

  it('with history, the row is there and the free workout carries the LIBRE tag', async () => {
    const f = fx();
    await finishedFree(f);
    await renderWith(f, <HoyScreen />);
    expect(await screen.findByLabelText('Entreno libre')).toBeTruthy();
    expect(screen.getByText('Libre')).toBeTruthy();
  });

  it('hides the row while a workout is in progress', async () => {
    const f = fx();
    await finishedFree(f);
    await f.services.startFreeWorkout();
    await renderWith(f, <HoyScreen />);
    expect(await screen.findByText('Continuar entrenamiento')).toBeTruthy();
    expect(screen.queryByLabelText('Entreno libre')).toBeNull();
  });
});

describe('Entrenando of a free workout', () => {
  beforeEach(() => {
    router.push.mockClear();
  });

  async function open(f: Fx, workoutId: string) {
    const initial = (await f.repos.workouts.getById(workoutId))!;
    await renderWith(
      f,
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
  }

  it('empty: says so and adds the first exercise at the end', async () => {
    const f = fx();
    const free = await f.services.startFreeWorkout();
    await open(f, free.id);
    expect(screen.getByText('Entrenando · Libre')).toBeTruthy();
    expect(screen.getByText('Sumá el primer ejercicio')).toBeTruthy();
    await fireEvent.press(screen.getByText('Agregar ejercicio'));
    await settle();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/elegir-ejercicio',
      params: { workoutId: free.id },
    });
  });

  it('marks exercises added to a routine workout as AGREGADO', async () => {
    const f = fx();
    const routine = await f.repos.routines.create({ name: 'Fuerza' });
    const day = await f.repos.routines.addDay(routine.id, { name: 'Piernas A' });
    const [a, b] = await f.repos.exercises.list();
    await f.repos.routines.addPlannedExercises(day.id, [{ exerciseId: a!.id }]);
    const started = await f.services.startWorkoutFromDay(day.id);
    await f.services.addExercisesToWorkout(started.id, [b!.id], { afterOrder: 0 });
    await open(f, started.id);
    expect(screen.getAllByText('Agregado')).toHaveLength(1);
    expect(screen.getByLabelText('Agregar ejercicio')).toBeTruthy();
  });
});

describe('Resumen of a free workout', () => {
  it('shows the automatic name and lets you rename it', async () => {
    const f = fx();
    const finished = await finishedFree(f);
    expect(finished.name).toMatch(/^Libre · /);
    routeParams.current = { workoutId: finished.id };
    await renderWith(f, <SummaryScreen />);
    expect(await screen.findByText('Entrenamiento terminado · Libre')).toBeTruthy();
    const input = screen.getByLabelText('Nombre del entreno');
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, 'Piernas en casa');
    await fireEvent(input, 'endEditing');
    await settle();
    expect((await f.repos.workouts.getById(finished.id))?.name).toBe('Piernas en casa');
  });
});
