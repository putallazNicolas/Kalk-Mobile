import {
  LOCAL_USER_ID,
  NotFoundError,
  type ExerciseHistoryEntry,
  type ID,
  ValidationError,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
  type WorkoutExerciseDetail,
  type WorkoutRepo,
  type WorkoutSet,
} from '../contracts';
import {
  applyPatch,
  assertNonNegativeInt,
  assertNonNegativeNumber,
  assertPositiveInt,
  assertSameIds,
  assertWorkoutExerciseInput,
  assertWorkoutName,
  buildWorkoutExercise,
  cloneWorkout,
  cloneWorkoutExercise,
  compact,
} from '../rules';
import { newId } from '../utils';
import type { MemoryContext } from './state';

export function createWorkoutRepo({ state, now }: MemoryContext): WorkoutRepo {
  /** Live (not soft-deleted) workouts only: a tombstone is invisible to everything but restore. */
  const getWorkout = (id: ID): Workout => {
    const found = state.workouts.get(id);
    if (!found || found.deletedAt !== undefined) throw new NotFoundError('Workout', id);
    return found;
  };
  const live = (): Workout[] => [...state.workouts.values()].filter((w) => !w.deletedAt);
  const getWorkoutExercise = (id: ID): WorkoutExercise => {
    const found = state.workoutExercises.get(id);
    if (!found) throw new NotFoundError('WorkoutExercise', id);
    return found;
  };
  const getSet = (id: ID): WorkoutSet => {
    const found = state.workoutSets.get(id);
    if (!found) throw new NotFoundError('WorkoutSet', id);
    return found;
  };

  const exercisesOf = (workoutId: ID): WorkoutExercise[] =>
    [...state.workoutExercises.values()]
      .filter((e) => e.workoutId === workoutId)
      .sort((a, b) => a.order - b.order);

  const setsOf = (workoutExerciseId: ID): WorkoutSet[] =>
    [...state.workoutSets.values()]
      .filter((s) => s.workoutExerciseId === workoutExerciseId)
      .sort((a, b) => a.setIndex - b.setIndex);

  const exerciseDetail = (e: WorkoutExercise): WorkoutExerciseDetail => ({
    ...cloneWorkoutExercise(e),
    sets: setsOf(e.id).map((s) => ({ ...s })),
  });

  const detail = (workout: Workout): WorkoutDetail => ({
    ...cloneWorkout(workout),
    exercises: exercisesOf(workout.id).map(exerciseDetail),
  });

  const renumber = (workoutId: ID): void => {
    exercisesOf(workoutId).forEach((e, i) => {
      e.order = i;
    });
  };

  const assertExercisesExist = (inputs: { exerciseId: ID }[]): void => {
    for (const e of inputs) {
      if (!state.exercises.has(e.exerciseId)) throw new NotFoundError('Exercise', e.exerciseId);
    }
  };

  /** Most recent first; ties resolved by creation order (later wins). */
  const byStartedDesc = (workouts: Workout[]): Workout[] =>
    workouts
      .reverse()
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));

  const finished = (): Workout[] => byStartedDesc(live().filter((w) => w.finishedAt !== undefined));

  return {
    async create(input) {
      if (input.routineId !== undefined && !state.routines.has(input.routineId)) {
        throw new NotFoundError('Routine', input.routineId);
      }
      if (input.dayId !== undefined && !state.routineDays.has(input.dayId)) {
        throw new NotFoundError('RoutineDay', input.dayId);
      }
      assertExercisesExist(input.exercises);
      input.exercises.forEach(assertWorkoutExerciseInput);

      const workout: Workout = compact({
        id: newId(),
        kind: input.kind,
        routineId: input.routineId,
        dayId: input.dayId,
        name: input.name,
        startedAt: input.startedAt ?? now(),
        planSnapshot: input.planSnapshot?.map((i) => ({ ...i })),
        ownerId: LOCAL_USER_ID,
        createdBy: LOCAL_USER_ID,
      });
      state.workouts.set(workout.id, workout);

      input.exercises.forEach((e, order) => {
        const built = buildWorkoutExercise(workout.id, order, e, e.origin ?? 'planned');
        state.workoutExercises.set(built.exercise.id, built.exercise);
        for (const set of built.sets) state.workoutSets.set(set.id, set);
      });
      return detail(workout);
    },

    async getById(id) {
      const found = state.workouts.get(id);
      return found && !found.deletedAt ? detail(found) : null;
    },

    async getInProgress() {
      const open = byStartedDesc(live().filter((w) => !w.finishedAt));
      const first = open[0];
      return first ? cloneWorkout(first) : null;
    },

    async listFinished(options) {
      let list = finished();
      if (options?.since !== undefined) {
        const since = options.since;
        list = list.filter((w) => w.startedAt >= since);
      }
      const offset = options?.offset ?? 0;
      const end = options?.limit === undefined ? undefined : offset + options.limit;
      return list.slice(offset, end).map(cloneWorkout);
    },

    async getLastFinishedForRoutine(routineId) {
      const found = finished().find((w) => w.routineId === routineId);
      return found ? cloneWorkout(found) : null;
    },

    async update(id, patch) {
      const current = getWorkout(id);
      const next = applyPatch(
        current,
        patch.name === undefined ? patch : { ...patch, name: assertWorkoutName(patch.name) },
      );
      state.workouts.set(id, next);
      return cloneWorkout(next);
    },

    async discard(id) {
      const workout = getWorkout(id);
      if (workout.finishedAt !== undefined) {
        throw new ValidationError('only a workout in progress can be discarded (use softDelete)');
      }
      for (const we of exercisesOf(id)) {
        for (const s of setsOf(we.id)) state.workoutSets.delete(s.id);
        state.workoutExercises.delete(we.id);
      }
      state.workouts.delete(id);
    },

    async softDelete(id) {
      const workout = getWorkout(id);
      if (workout.finishedAt === undefined) {
        throw new ValidationError('a workout in progress cannot be deleted (use discard)');
      }
      workout.deletedAt = now();
    },

    async restore(id) {
      const workout = state.workouts.get(id);
      if (!workout) throw new NotFoundError('Workout', id);
      delete workout.deletedAt;
    },

    async updateWorkoutExercise(id, patch) {
      const we = getWorkoutExercise(id);
      if (patch.skipped !== undefined) we.skipped = patch.skipped;
      return cloneWorkoutExercise(we);
    },

    async addWorkoutExercises(workoutId, inputs, options) {
      getWorkout(workoutId);
      assertExercisesExist(inputs);
      inputs.forEach(assertWorkoutExerciseInput);
      const existing = exercisesOf(workoutId);
      const at =
        options?.afterOrder === undefined
          ? existing.length
          : Math.min(Math.max(options.afterOrder + 1, 0), existing.length);
      for (const e of existing) if (e.order >= at) e.order += inputs.length;
      const created = inputs.map((input, i) => {
        const built = buildWorkoutExercise(workoutId, at + i, input, 'added');
        state.workoutExercises.set(built.exercise.id, built.exercise);
        for (const set of built.sets) state.workoutSets.set(set.id, set);
        return built.exercise;
      });
      return created.map(exerciseDetail);
    },

    async removeWorkoutExercise(id) {
      const we = getWorkoutExercise(id);
      for (const s of setsOf(id)) state.workoutSets.delete(s.id);
      state.workoutExercises.delete(id);
      renumber(we.workoutId);
    },

    async reorderWorkoutExercises(workoutId, orderedIds) {
      getWorkout(workoutId);
      assertSameIds(
        exercisesOf(workoutId).map((e) => e.id),
        orderedIds,
        'orderedIds',
      );
      orderedIds.forEach((id, order) => {
        getWorkoutExercise(id).order = order;
      });
    },

    async addSet(workoutExerciseId) {
      getWorkoutExercise(workoutExerciseId);
      const existing = setsOf(workoutExerciseId);
      const last = existing[existing.length - 1];
      const set: WorkoutSet = compact({
        id: newId(),
        workoutExerciseId,
        setIndex: existing.length,
        source: 'added',
        weightKg: last?.weightKg,
        completed: false,
      });
      state.workoutSets.set(set.id, set);
      return { ...set };
    },

    async removeSet(setId) {
      const set = getSet(setId);
      state.workoutSets.delete(setId);
      setsOf(set.workoutExerciseId).forEach((s, i) => {
        s.setIndex = i;
      });
    },

    async updateSet(setId, patch) {
      const current = getSet(setId);
      if (patch.weightKg !== undefined && patch.weightKg !== null) {
        assertNonNegativeNumber(patch.weightKg, 'weightKg');
      }
      if (patch.reps !== undefined && patch.reps !== null) {
        assertNonNegativeInt(patch.reps, 'reps');
      }
      const next = applyPatch(current, patch);
      state.workoutSets.set(setId, next);
      return { ...next };
    },

    async getExerciseHistory(exerciseId, options) {
      const limit =
        options?.limit === undefined ? undefined : assertPositiveInt(options.limit, 'limit');
      const workouts = byStartedDesc(
        live().filter(
          (w) =>
            w.id !== options?.excludeWorkoutId &&
            (options?.includeInProgress || w.finishedAt !== undefined),
        ),
      );
      const entries: ExerciseHistoryEntry[] = [];
      for (const workout of workouts) {
        for (const we of exercisesOf(workout.id)) {
          if (we.exerciseId !== exerciseId) continue;
          entries.push({
            workout: cloneWorkout(workout),
            workoutExercise: cloneWorkoutExercise(we),
            sets: setsOf(we.id).map((s) => ({ ...s })),
          });
        }
        if (limit !== undefined && entries.length >= limit) break;
      }
      return limit === undefined ? entries : entries.slice(0, limit);
    },
  };
}
