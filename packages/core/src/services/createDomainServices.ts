import {
  FREE_WORKOUT_DEFAULT_NAME,
  MAX_PLANNED_SETS,
  NotFoundError,
  ValidationError,
  type CreateDomainServices,
  type DeletionImpactRecord,
  type Exercise,
  type ExerciseProgressPoint,
  type ID,
  type NewWorkoutExerciseInput,
  type PersonalRecord,
  type PlanChanges,
  type PlannedSet,
  type PreviousPerformance,
  type WeeklyStat,
  type WorkoutDetail,
  type WorkoutListItem,
  type WorkoutSummary,
  type WorkoutSummaryExercise,
} from '../contracts';
import { summarizePlannedSets } from '../plan';
import {
  buildExportPayload,
  importResultOf,
  parseImportPayload,
  withoutDeletedWorkouts,
} from './dataExport';
import { freeWorkoutName } from './muscleRegions';
import { dayMatchesSnapshot, diffPlan, hasChanges, planChangeItems } from './planChanges';
import {
  bestSetOf,
  completedSets,
  durationSeconds,
  maxE1rmOf,
  maxWeightOf,
  volumeOf,
  weekStartOf,
} from './stats';

export const createDomainServices: CreateDomainServices = (repos, options = {}) => {
  const clock = options.now ?? (() => new Date());
  const nowIso = (): string => clock().toISOString();

  const requireWorkout = async (id: ID): Promise<WorkoutDetail> => {
    const w = await repos.workouts.getById(id);
    if (!w) throw new NotFoundError('Workout', id);
    return w;
  };

  const allSets = (w: WorkoutDetail) => w.exercises.flatMap((e) => e.sets);

  const getPreviousPerformance = async (
    exerciseId: ID,
    opts?: { excludeWorkoutId?: ID },
  ): Promise<PreviousPerformance | null> => {
    const history = await repos.workouts.getExerciseHistory(exerciseId, {
      excludeWorkoutId: opts?.excludeWorkoutId,
    });
    // Most recent finished session that actually has completed sets.
    for (const entry of history) {
      const done = completedSets(entry.sets);
      if (done.length === 0) continue;
      return {
        workoutId: entry.workout.id,
        date: entry.workout.startedAt,
        sets: done.map((s) => ({
          setIndex: s.setIndex,
          ...(s.weightKg !== undefined ? { weightKg: s.weightKg } : {}),
          ...(s.reps !== undefined ? { reps: s.reps } : {}),
        })),
      };
    }
    return null;
  };

  /** Pending sets whose weight is prefilled from the last session of the exercise. */
  const prefilledSets = async (exerciseId: ID, count: number) => {
    const prevSets = (await getPreviousPerformance(exerciseId))?.sets ?? [];
    return Array.from({ length: count }, (_, i) => {
      const match = prevSets.find((s) => s.setIndex === i) ?? prevSets[prevSets.length - 1];
      return match?.weightKg !== undefined ? { weightKg: match.weightKg } : {};
    });
  };

  const requireInProgress = async (workoutId: ID): Promise<WorkoutDetail> => {
    const workout = await requireWorkout(workoutId);
    if (workout.finishedAt !== undefined) throw new ValidationError('the workout is finished');
    return workout;
  };

  const exerciseCatalog = async (ids: ID[]): Promise<Map<ID, Exercise>> =>
    new Map((await repos.exercises.getByIds([...new Set(ids)])).map((e) => [e.id, e]));

  /** Records set in a workout vs. everything that started before it (the summary's rule). */
  const personalRecordsOf = async (
    detail: WorkoutDetail,
    catalog: Map<ID, Exercise>,
  ): Promise<PersonalRecord[]> => {
    const personalRecords: PersonalRecord[] = [];
    const exerciseIds = [...new Set(detail.exercises.map((e) => e.exerciseId))];
    for (const exerciseId of exerciseIds) {
      const current = detail.exercises
        .filter((e) => e.exerciseId === exerciseId)
        .flatMap((e) => e.sets);
      const history = await repos.workouts.getExerciseHistory(exerciseId, {
        excludeWorkoutId: detail.id,
        includeInProgress: true,
      });
      const previous = history
        .filter((h) => h.workout.startedAt < detail.startedAt)
        .flatMap((h) => completedSets(h.sets));
      if (previous.length === 0) continue;
      const exerciseName = catalog.get(exerciseId)?.name ?? '';
      const checks = [
        { type: 'weight' as const, now: maxWeightOf(current), before: maxWeightOf(previous) },
        { type: 'e1rm' as const, now: maxE1rmOf(current), before: maxE1rmOf(previous) },
      ];
      for (const c of checks) {
        if (c.now > c.before) {
          personalRecords.push({
            exerciseId,
            exerciseName,
            type: c.type,
            valueKg: c.now,
            previousKg: c.before,
          });
        }
      }
    }
    return personalRecords;
  };

  const getPlanChanges = async (workoutId: ID): Promise<PlanChanges> => {
    const workout = await requireWorkout(workoutId);
    const snapshot = workout.planSnapshot;
    if (workout.kind !== 'routine' || !snapshot) return { status: 'none', items: [] };
    const dayName = workout.name;
    if (workout.planChangeDecision) {
      return { status: 'decided', dayName, items: [], decision: workout.planChangeDecision };
    }
    const diff = diffPlan(workout, snapshot);
    if (!hasChanges(diff)) return { status: 'none', dayName, items: [] };
    const day = workout.dayId ? await repos.routines.getDay(workout.dayId) : null;
    if (!dayMatchesSnapshot(day, snapshot)) return { status: 'routineChanged', dayName, items: [] };
    const catalog = await exerciseCatalog([
      ...workout.exercises.map((e) => e.exerciseId),
      ...snapshot.map((i) => i.exerciseId),
    ]);
    return {
      status: 'changed',
      dayName,
      items: planChangeItems(diff, (id) => catalog.get(id)?.name ?? ''),
    };
  };

  const workoutEnd = (w: { startedAt: string; finishedAt?: string }): string =>
    w.finishedAt ?? nowIso();

  return {
    async startWorkoutFromDay(dayId) {
      const day = await repos.routines.getDay(dayId);
      if (!day) throw new NotFoundError('RoutineDay', dayId);
      if (await repos.workouts.getInProgress()) {
        throw new ValidationError('another workout is already in progress');
      }
      const exercises: NewWorkoutExerciseInput[] = [];
      for (const planned of day.exercises) {
        const plannedSetReps = planned.plannedSets.map((set) => set.reps);
        exercises.push({
          exerciseId: planned.exerciseId,
          plannedExerciseId: planned.id,
          plannedSets: plannedSetReps.length,
          plannedReps: summarizePlannedSets(planned),
          plannedSetReps,
          restSeconds: planned.restSeconds,
          notes: planned.notes,
          sets: await prefilledSets(planned.exerciseId, plannedSetReps.length),
        });
      }
      return repos.workouts.create({
        kind: 'routine',
        routineId: day.routineId,
        dayId: day.id,
        name: day.name,
        planSnapshot: day.exercises.map((p) => ({
          plannedExerciseId: p.id,
          exerciseId: p.exerciseId,
          order: p.order,
          sets: p.plannedSets.length,
        })),
        startedAt: nowIso(),
        exercises,
      });
    },

    async startFreeWorkout() {
      if (await repos.workouts.getInProgress()) {
        throw new ValidationError('another workout is already in progress');
      }
      return repos.workouts.create({
        kind: 'free',
        name: FREE_WORKOUT_DEFAULT_NAME,
        startedAt: nowIso(),
        exercises: [],
      });
    },

    async addExercisesToWorkout(workoutId, exerciseIds, options) {
      await requireInProgress(workoutId);
      const inputs: NewWorkoutExerciseInput[] = [];
      for (const exerciseId of exerciseIds) {
        inputs.push({
          exerciseId,
          plannedSets: 3,
          plannedReps: '10',
          plannedSetReps: ['10', '10', '10'],
          sets: await prefilledSets(exerciseId, 3),
        });
      }
      await repos.workouts.addWorkoutExercises(workoutId, inputs, options);
      return requireWorkout(workoutId);
    },

    async getSuggestedNextDay() {
      const routine = await repos.routines.getActive();
      if (!routine || routine.days.length === 0) return null;
      const last = await repos.workouts.getLastFinishedForRoutine(routine.id);
      const lastIndex = last?.dayId ? routine.days.findIndex((d) => d.id === last.dayId) : -1;
      const day = routine.days[lastIndex === -1 ? 0 : (lastIndex + 1) % routine.days.length];
      if (!day) return null;
      const found = await repos.exercises.getByIds(day.exercises.map((p) => p.exerciseId));
      const byId = new Map<ID, Exercise>(found.map((e) => [e.id, e]));
      const exercises = day.exercises.flatMap((p) => {
        const e = byId.get(p.exerciseId);
        return e ? [e] : [];
      });
      const { id, name, isActive, archived, createdAt, updatedAt, ownerId, createdBy } = routine;
      return {
        routine: { id, name, isActive, archived, createdAt, updatedAt, ownerId, createdBy },
        day,
        exercises,
      };
    },

    getPreviousPerformance,

    async completeSet(setId, values) {
      return repos.workouts.updateSet(setId, {
        ...(values.weightKg !== undefined ? { weightKg: values.weightKg } : {}),
        ...(values.reps !== undefined ? { reps: values.reps } : {}),
        completed: true,
        completedAt: nowIso(),
      });
    },

    async uncompleteSet(setId) {
      return repos.workouts.updateSet(setId, { completed: false, completedAt: null });
    },

    async finishWorkout(workoutId, opts) {
      const workout = await requireWorkout(workoutId);
      const autoName =
        workout.kind === 'free' && workout.name === FREE_WORKOUT_DEFAULT_NAME
          ? freeWorkoutName(
              workout,
              await exerciseCatalog(workout.exercises.map((e) => e.exerciseId)),
            )
          : undefined;
      return repos.workouts.update(workoutId, {
        finishedAt: nowIso(),
        ...(opts?.notes !== undefined ? { notes: opts.notes } : {}),
        ...(autoName !== undefined ? { name: autoName } : {}),
      });
    },

    getPlanChanges,

    async applyPlanChanges(workoutId) {
      const changes = await getPlanChanges(workoutId);
      if (changes.status !== 'changed') {
        throw new ValidationError(`the plan has nothing to apply (${changes.status})`);
      }
      const workout = await requireWorkout(workoutId);
      const day = workout.dayId ? await repos.routines.getDay(workout.dayId) : null;
      if (!day) throw new NotFoundError('RoutineDay', workout.dayId ?? '');
      const diff = diffPlan(workout, workout.planSnapshot ?? []);
      const plannedById = new Map(day.exercises.map((p) => [p.id, p]));

      // Not one transaction: services only see the repositories (see DECISIONS). The day keeps
      // a valid shape after each step.
      for (const change of diff.setsChanged) {
        const planned = plannedById.get(change.plannedExerciseId);
        if (!planned) continue;
        // "same": every set has the same reps, so copying the last one is copying them all.
        // "perSet": new sets copy the last one and the removed ones come off the end.
        const sets = planned.plannedSets;
        const plannedSets: PlannedSet[] = Array.from(
          { length: Math.min(change.to, MAX_PLANNED_SETS) },
          (_, i) => ({ reps: (sets[i] ?? sets[sets.length - 1])?.reps ?? '10' }),
        );
        await repos.routines.updatePlannedExercise(planned.id, { plannedSets });
      }
      const created = await repos.routines.addPlannedExercises(
        day.id,
        diff.added.map((a) => ({
          exerciseId: a.exerciseId,
          repsMode: 'same' as const,
          plannedSets: Array.from({ length: Math.min(a.sets, MAX_PLANNED_SETS) }, () => ({
            reps: a.reps,
          })),
        })),
      );
      for (const removed of diff.removed) {
        await repos.routines.deletePlannedExercise(removed.plannedExerciseId);
      }
      const newIdOf = new Map(diff.added.map((a, i) => [a.workoutExerciseId, created[i]?.id]));
      await repos.routines.reorderPlannedExercises(
        day.id,
        diff.finalOrder.flatMap((f) => {
          const id = f.plannedExerciseId ?? newIdOf.get(f.workoutExerciseId);
          return id === undefined ? [] : [id];
        }),
      );
      await repos.workouts.update(workoutId, { planChangeDecision: 'applied' });
    },

    async keepPlan(workoutId) {
      await requireWorkout(workoutId);
      await repos.workouts.update(workoutId, { planChangeDecision: 'kept' });
    },

    async getDeletionImpact(workoutId) {
      const detail = await requireWorkout(workoutId);
      const catalog = await exerciseCatalog(detail.exercises.map((e) => e.exerciseId));
      const records = await personalRecordsOf(detail, catalog);
      const impact: DeletionImpactRecord[] = [];
      for (const exerciseId of new Set(records.map((r) => r.exerciseId))) {
        const history = await repos.workouts.getExerciseHistory(exerciseId, {
          excludeWorkoutId: workoutId,
        });
        const previous = bestSetOf(
          history.filter((h) => h.workout.startedAt < detail.startedAt).flatMap((h) => h.sets),
        );
        impact.push({
          exerciseId,
          exerciseName: catalog.get(exerciseId)?.name ?? '',
          ...(previous ? { previous } : {}),
        });
      }
      return impact;
    },

    async getWorkoutSummary(workoutId): Promise<WorkoutSummary> {
      const detail = await requireWorkout(workoutId);
      const { exercises: workoutExercises, ...workout } = detail;
      const sets = allSets(detail);
      const catalog = await exerciseCatalog(workoutExercises.map((e) => e.exerciseId));

      const exercises: WorkoutSummaryExercise[] = workoutExercises.map((we) => {
        const bestSet = bestSetOf(we.sets);
        return {
          workoutExerciseId: we.id,
          exerciseId: we.exerciseId,
          exerciseName: catalog.get(we.exerciseId)?.name ?? '',
          completedSets: completedSets(we.sets).length,
          totalSets: we.sets.length,
          volumeKg: volumeOf(we.sets),
          skipped: we.skipped,
          ...(bestSet ? { bestSet } : {}),
        };
      });

      const personalRecords = await personalRecordsOf(detail, catalog);

      return {
        workout,
        durationSeconds: durationSeconds(workout.startedAt, workoutEnd(workout)),
        completedSets: completedSets(sets).length,
        totalSets: sets.length,
        volumeKg: volumeOf(sets),
        exerciseCount: exercises.filter((e) => e.completedSets > 0).length,
        exercises,
        personalRecords,
      };
    },

    async getRecentWorkouts(limit) {
      if (!(limit > 0)) return [];
      const finished = await repos.workouts.listFinished({ limit: Math.floor(limit) });
      const items: WorkoutListItem[] = [];
      for (const w of finished) {
        const detail = await requireWorkout(w.id);
        const sets = allSets(detail);
        items.push({
          workout: w,
          durationSeconds: durationSeconds(w.startedAt, workoutEnd(w)),
          volumeKg: volumeOf(sets),
          completedSets: completedSets(sets).length,
        });
      }
      return items;
    },

    async getExerciseProgress(exerciseId) {
      const history = await repos.workouts.getExerciseHistory(exerciseId);
      const points: ExerciseProgressPoint[] = [];
      for (const entry of [...history].reverse()) {
        const done = completedSets(entry.sets);
        if (done.length === 0) continue;
        points.push({
          workoutId: entry.workout.id,
          date: entry.workout.startedAt,
          bestWeightKg: maxWeightOf(done),
          bestE1rmKg: maxE1rmOf(done),
          volumeKg: volumeOf(done),
          sets: done,
        });
      }
      return points;
    },

    async getWeeklyStats(weeks) {
      const count = Math.floor(weeks);
      if (!(count > 0)) return [];
      const current = weekStartOf(clock());
      const starts: Date[] = [];
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(current);
        d.setDate(d.getDate() - 7 * i);
        starts.push(d);
      }
      const stats = new Map<number, WeeklyStat>(
        starts.map((d) => [d.getTime(), { weekStart: d.toISOString(), workouts: 0, volumeKg: 0 }]),
      );
      const oldest = starts[0];
      if (!oldest) return [];
      const finished = await repos.workouts.listFinished({ since: oldest.toISOString() });
      for (const w of finished) {
        const stat = stats.get(weekStartOf(new Date(w.startedAt)).getTime());
        if (!stat) continue;
        stat.workouts += 1;
        stat.volumeKg += volumeOf(allSets(await requireWorkout(w.id)));
      }
      return starts.flatMap((d) => {
        const s = stats.get(d.getTime());
        return s ? [s] : [];
      });
    },

    async exportAllData(opts) {
      return buildExportPayload(
        withoutDeletedWorkouts(await repos.backup.snapshot()),
        nowIso(),
        opts?.appVersion,
      );
    },

    async importAllData(payload) {
      const snapshot = parseImportPayload(payload, { seedCreatedAt: nowIso() });
      await repos.backup.restore(snapshot);
      return importResultOf(snapshot);
    },
  };
};
