import {
  LOCAL_USER_ID,
  NotFoundError,
  ValidationError,
  type ExerciseHistoryEntry,
  type ID,
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
  compact,
} from '../rules';
import { newId } from '../utils';
import type { SqliteContext } from './context';
import { inTransaction, type SqlParam } from './driver';
import {
  WORKOUTS,
  WORKOUT_EXERCISES,
  WORKOUT_SETS,
  exists,
  fromRow,
  insertRow,
  selectAll,
  selectById,
  updateRow,
} from './tables';

/** Most recent first; ties resolved by creation order (later wins), like the in-memory repo. */
const RECENT_FIRST = '"startedAt" DESC, rowid DESC';
/** Soft-deleted workouts are tombstones: every read skips them. */
const LIVE = '"deletedAt" IS NULL';

export function createWorkoutRepo({ db, now }: SqliteContext): WorkoutRepo {
  /** Live (not soft-deleted) workouts only: a tombstone is invisible to everything but restore. */
  const getWorkout = async (id: ID): Promise<Workout> => {
    const found = await selectById(db, WORKOUTS, id);
    if (!found || found.deletedAt !== undefined) throw new NotFoundError('Workout', id);
    return found;
  };
  const getWorkoutExercise = async (id: ID): Promise<WorkoutExercise> => {
    const found = await selectById(db, WORKOUT_EXERCISES, id);
    if (!found) throw new NotFoundError('WorkoutExercise', id);
    return found;
  };
  const getSet = async (id: ID): Promise<WorkoutSet> => {
    const found = await selectById(db, WORKOUT_SETS, id);
    if (!found) throw new NotFoundError('WorkoutSet', id);
    return found;
  };

  const setsOf = (workoutExerciseId: ID) =>
    selectAll(
      db,
      WORKOUT_SETS,
      '"workoutExerciseId" = ?',
      [workoutExerciseId],
      '"setIndex", rowid',
    );

  const exercisesOf = (workoutId: ID) =>
    selectAll(db, WORKOUT_EXERCISES, '"workoutId" = ?', [workoutId], '"order", rowid');

  const withSets = async (e: WorkoutExercise): Promise<WorkoutExerciseDetail> => ({
    ...e,
    sets: await setsOf(e.id),
  });

  const detail = async (workout: Workout): Promise<WorkoutDetail> => {
    const exercises = [];
    for (const e of await exercisesOf(workout.id)) exercises.push(await withSets(e));
    return { ...workout, exercises };
  };

  /** Rewrites `order` as 0..n-1 following the current order (only rows that changed). */
  const renumber = async (workoutId: ID): Promise<void> => {
    for (const [i, e] of (await exercisesOf(workoutId)).entries()) {
      if (e.order !== i) {
        await db.run('UPDATE workout_exercises SET "order" = ? WHERE "id" = ?', [i, e.id]);
      }
    }
  };

  const assertExercisesExist = async (inputs: { exerciseId: ID }[]): Promise<void> => {
    for (const e of inputs) {
      if (!(await exists(db, 'exercises', e.exerciseId))) {
        throw new NotFoundError('Exercise', e.exerciseId);
      }
    }
  };

  const insertExercise = async (
    workoutId: ID,
    order: number,
    input: Parameters<typeof buildWorkoutExercise>[2],
    origin: Parameters<typeof buildWorkoutExercise>[3],
  ): Promise<WorkoutExercise> => {
    const built = buildWorkoutExercise(workoutId, order, input, origin);
    await insertRow(db, WORKOUT_EXERCISES, built.exercise);
    for (const set of built.sets) await insertRow(db, WORKOUT_SETS, set);
    return built.exercise;
  };

  return {
    async create(input) {
      if (input.routineId !== undefined && !(await exists(db, 'routines', input.routineId))) {
        throw new NotFoundError('Routine', input.routineId);
      }
      if (input.dayId !== undefined && !(await exists(db, 'routine_days', input.dayId))) {
        throw new NotFoundError('RoutineDay', input.dayId);
      }
      await assertExercisesExist(input.exercises);
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
      return inTransaction(db, async () => {
        await insertRow(db, WORKOUTS, workout);
        for (const [order, e] of input.exercises.entries()) {
          await insertExercise(workout.id, order, e, e.origin ?? 'planned');
        }
        return detail(workout);
      });
    },

    async getById(id) {
      const found = await selectById(db, WORKOUTS, id);
      return found && found.deletedAt === undefined ? detail(found) : null;
    },

    async getInProgress() {
      const [found] = await selectAll(
        db,
        WORKOUTS,
        `"finishedAt" IS NULL AND ${LIVE}`,
        [],
        RECENT_FIRST,
      );
      return found ?? null;
    },

    async listFinished(options) {
      const params: SqlParam[] = [];
      let where = `"finishedAt" IS NOT NULL AND ${LIVE}`;
      if (options?.since !== undefined) {
        where += ' AND "startedAt" >= ?';
        params.push(options.since);
      }
      const rows = await db.all(
        `SELECT * FROM workouts WHERE ${where} ORDER BY ${RECENT_FIRST} LIMIT ? OFFSET ?`,
        [...params, options?.limit ?? -1, options?.offset ?? 0],
      );
      return rows.map((r) => fromRow(WORKOUTS, r));
    },

    async getLastFinishedForRoutine(routineId) {
      const [found] = await selectAll(
        db,
        WORKOUTS,
        `"finishedAt" IS NOT NULL AND ${LIVE} AND "routineId" = ?`,
        [routineId],
        RECENT_FIRST,
      );
      return found ?? null;
    },

    async update(id, patch) {
      const current = await getWorkout(id);
      const next = applyPatch(
        current,
        patch.name === undefined ? patch : { ...patch, name: assertWorkoutName(patch.name) },
      );
      await updateRow(db, WORKOUTS, next);
      return next;
    },

    async discard(id) {
      const workout = await getWorkout(id);
      if (workout.finishedAt !== undefined) {
        throw new ValidationError('only a workout in progress can be discarded (use softDelete)');
      }
      // Exercises and sets go with it through ON DELETE CASCADE.
      await db.run('DELETE FROM workouts WHERE "id" = ?', [id]);
    },

    async softDelete(id) {
      const workout = await getWorkout(id);
      if (workout.finishedAt === undefined) {
        throw new ValidationError('a workout in progress cannot be deleted (use discard)');
      }
      await updateRow(db, WORKOUTS, { ...workout, deletedAt: now() });
    },

    async restore(id) {
      const workout = await selectById(db, WORKOUTS, id);
      if (!workout) throw new NotFoundError('Workout', id);
      const restored = { ...workout };
      delete restored.deletedAt;
      await updateRow(db, WORKOUTS, restored);
    },

    async updateWorkoutExercise(id, patch) {
      const we = await getWorkoutExercise(id);
      if (patch.skipped !== undefined) we.skipped = patch.skipped;
      await updateRow(db, WORKOUT_EXERCISES, we);
      return we;
    },

    async addWorkoutExercises(workoutId, inputs, options) {
      await getWorkout(workoutId);
      await assertExercisesExist(inputs);
      inputs.forEach(assertWorkoutExerciseInput);
      return inTransaction(db, async () => {
        const count = (await exercisesOf(workoutId)).length;
        const at =
          options?.afterOrder === undefined
            ? count
            : Math.min(Math.max(options.afterOrder + 1, 0), count);
        await db.run(
          'UPDATE workout_exercises SET "order" = "order" + ? WHERE "workoutId" = ? AND "order" >= ?',
          [inputs.length, workoutId, at],
        );
        const created: WorkoutExerciseDetail[] = [];
        for (const [i, input] of inputs.entries()) {
          created.push(await withSets(await insertExercise(workoutId, at + i, input, 'added')));
        }
        return created;
      });
    },

    async removeWorkoutExercise(id) {
      const we = await getWorkoutExercise(id);
      await inTransaction(db, async () => {
        // Its sets go with it through ON DELETE CASCADE.
        await db.run('DELETE FROM workout_exercises WHERE "id" = ?', [id]);
        await renumber(we.workoutId);
      });
    },

    async reorderWorkoutExercises(workoutId, orderedIds) {
      await getWorkout(workoutId);
      assertSameIds(
        (await exercisesOf(workoutId)).map((e) => e.id),
        orderedIds,
        'orderedIds',
      );
      await inTransaction(db, async () => {
        for (const [order, id] of orderedIds.entries()) {
          await db.run('UPDATE workout_exercises SET "order" = ? WHERE "id" = ?', [order, id]);
        }
      });
    },

    async addSet(workoutExerciseId) {
      await getWorkoutExercise(workoutExerciseId);
      return inTransaction(db, async () => {
        const existing = await setsOf(workoutExerciseId);
        const last = existing[existing.length - 1];
        const set: WorkoutSet = compact({
          id: newId(),
          workoutExerciseId,
          setIndex: existing.length,
          source: 'added',
          weightKg: last?.weightKg,
          completed: false,
        });
        await insertRow(db, WORKOUT_SETS, set);
        return set;
      });
    },

    async removeSet(setId) {
      const set = await getSet(setId);
      await inTransaction(db, async () => {
        await db.run('DELETE FROM workout_sets WHERE "id" = ?', [setId]);
        for (const [i, s] of (await setsOf(set.workoutExerciseId)).entries()) {
          if (s.setIndex !== i) {
            await db.run('UPDATE workout_sets SET "setIndex" = ? WHERE "id" = ?', [i, s.id]);
          }
        }
      });
    },

    async updateSet(setId, patch) {
      const current = await getSet(setId);
      if (patch.weightKg !== undefined && patch.weightKg !== null) {
        assertNonNegativeNumber(patch.weightKg, 'weightKg');
      }
      if (patch.reps !== undefined && patch.reps !== null) {
        assertNonNegativeInt(patch.reps, 'reps');
      }
      const next = applyPatch(current, patch);
      await updateRow(db, WORKOUT_SETS, next);
      return next;
    },

    async getExerciseHistory(exerciseId, options) {
      const limit =
        options?.limit === undefined ? undefined : assertPositiveInt(options.limit, 'limit');
      const params: SqlParam[] = [exerciseId];
      let where = 'we."exerciseId" = ? AND w."deletedAt" IS NULL';
      if (!options?.includeInProgress) where += ' AND w."finishedAt" IS NOT NULL';
      if (options?.excludeWorkoutId !== undefined) {
        where += ' AND w."id" <> ?';
        params.push(options.excludeWorkoutId);
      }
      const rows = await db.all(
        `SELECT we.* FROM workout_exercises we JOIN workouts w ON w."id" = we."workoutId"
         WHERE ${where} ORDER BY w."startedAt" DESC, w.rowid DESC, we."order", we.rowid
         LIMIT ?`,
        [...params, limit ?? -1],
      );
      const workouts = new Map<ID, Workout>();
      const entries: ExerciseHistoryEntry[] = [];
      for (const row of rows) {
        const we = fromRow(WORKOUT_EXERCISES, row);
        let workout = workouts.get(we.workoutId);
        if (!workout) {
          workout = await getWorkout(we.workoutId);
          workouts.set(workout.id, workout);
        }
        entries.push({ workout: { ...workout }, workoutExercise: we, sets: await setsOf(we.id) });
      }
      return entries;
    },
  };
}
