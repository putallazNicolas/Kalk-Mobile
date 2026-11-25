import {
  FREE_WORKOUT_DEFAULT_NAME,
  NotFoundError,
  ValidationError,
  type DataSnapshot,
  type MuscleGroup,
  type Repositories,
} from '../contracts';
import { createInMemoryRepositories } from '../memory';
import { createSqliteRepositories } from '../sqlite';
import { createSqlJsDriver } from '../testing/sqlJsDriver';
import { epley } from '../utils';
import { createDomainServices, muscleRegionOf } from './index';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const local = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min);

type Build = (now: () => Date) => Promise<Repositories>;
const BACKENDS: [string, Build][] = [
  ['in-memory', async (now) => createInMemoryRepositories({ seed: false, now })],
  [
    'sqlite',
    async (now) => createSqliteRepositories(await createSqlJsDriver(), { seed: false, now }),
  ],
];

describe('muscleRegionOf', () => {
  it('groups the muscle groups into the regions of the free workout name', () => {
    const regions: Record<MuscleGroup, string> = {
      quads: 'Piernas',
      hamstrings: 'Piernas',
      glutes: 'Piernas',
      calves: 'Piernas',
      chest: 'Pecho',
      back: 'Espalda',
      shoulders: 'Hombros',
      biceps: 'Brazos',
      triceps: 'Brazos',
      forearms: 'Brazos',
      core: 'Core',
      full_body: 'Cuerpo completo',
      cardio: 'Cardio',
    };
    for (const [group, region] of Object.entries(regions)) {
      expect(muscleRegionOf(group as MuscleGroup)).toBe(region);
    }
  });
});

describe.each(BACKENDS)('flexibility services on %s', (_name, build) => {
  async function setup(start = local(2026, 3, 4)) {
    let current = start;
    const now = () => current;
    const repos = await build(now);
    const services = createDomainServices(repos, { now });
    const exercise = async (name: string, muscleGroup: MuscleGroup = 'quads') =>
      (await repos.exercises.create({ name, muscleGroup })).id;
    return {
      repos,
      services,
      exercise,
      advance: (ms: number) => {
        current = new Date(current.getTime() + ms);
      },
    };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  /** One routine with day "Día A" (A same 3x8-10 rest 90, B perSet 5·3·1, C 2x12) and "Día B". */
  async function routineFixture(ctx: Ctx) {
    const { repos } = ctx;
    const a = await ctx.exercise('A');
    const b = await ctx.exercise('B');
    const c = await ctx.exercise('C');
    const routine = await repos.routines.create({ name: 'Rutina' });
    const day = await repos.routines.addDay(routine.id, { name: 'Día A' });
    const other = await repos.routines.addDay(routine.id, { name: 'Día B' });
    const [pa, pb, pc] = await repos.routines.addPlannedExercises(day.id, [
      {
        exerciseId: a,
        plannedSets: [{ reps: '8-10' }, { reps: '8-10' }, { reps: '8-10' }],
        restSeconds: 90,
        notes: 'n',
      },
      {
        exerciseId: b,
        repsMode: 'perSet',
        plannedSets: [{ reps: '5' }, { reps: '3' }, { reps: '1' }],
      },
      { exerciseId: c, plannedSets: [{ reps: '12' }, { reps: '12' }] },
    ]);
    await repos.routines.addPlannedExercises(other.id, [{ exerciseId: a }]);
    await repos.routines.setActive(routine.id);
    return { routine, day, other, ids: { a, b, c }, planned: { a: pa!, b: pb!, c: pc! } };
  }

  async function complete(ctx: Ctx, setId: string, weightKg: number, reps: number) {
    await ctx.services.completeSet(setId, { weightKg, reps });
  }

  describe('startWorkoutFromDay (v3 fields)', () => {
    it('sets kind, name, planSnapshot and plannedExerciseId on every exercise', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const w = await ctx.services.startWorkoutFromDay(fx.day.id);
      expect(w).toMatchObject({ kind: 'routine', name: 'Día A', routineId: fx.routine.id });
      expect(w.planSnapshot).toEqual([
        { plannedExerciseId: fx.planned.a.id, exerciseId: fx.ids.a, order: 0, sets: 3 },
        { plannedExerciseId: fx.planned.b.id, exerciseId: fx.ids.b, order: 1, sets: 3 },
        { plannedExerciseId: fx.planned.c.id, exerciseId: fx.ids.c, order: 2, sets: 2 },
      ]);
      expect(w.exercises.map((e) => [e.origin, e.plannedExerciseId])).toEqual([
        ['planned', fx.planned.a.id],
        ['planned', fx.planned.b.id],
        ['planned', fx.planned.c.id],
      ]);
      expect(w.exercises.flatMap((e) => e.sets.map((s) => s.source))).toEqual(
        Array.from({ length: 8 }, () => 'planned'),
      );
    });
  });

  describe('startFreeWorkout', () => {
    it('starts an empty free workout and refuses a second one', async () => {
      const ctx = await setup();
      const w = await ctx.services.startFreeWorkout();
      expect(w).toMatchObject({ kind: 'free', name: FREE_WORKOUT_DEFAULT_NAME, exercises: [] });
      expect('routineId' in w).toBe(false);
      expect('planSnapshot' in w).toBe(false);
      expect((await ctx.repos.workouts.getInProgress())?.id).toBe(w.id);
      await expect(ctx.services.startFreeWorkout()).rejects.toBeInstanceOf(ValidationError);
      const fx = await routineFixture(ctx);
      await expect(ctx.services.startWorkoutFromDay(fx.day.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('is refused while a routine workout is in progress', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      await ctx.services.startWorkoutFromDay(fx.day.id);
      await expect(ctx.services.startFreeWorkout()).rejects.toBeInstanceOf(ValidationError);
    });

    it('never changes the suggested next day', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const first = await ctx.services.startWorkoutFromDay(fx.day.id);
      ctx.advance(MIN);
      await ctx.services.finishWorkout(first.id);
      ctx.advance(DAY);
      expect((await ctx.services.getSuggestedNextDay())?.day.id).toBe(fx.other.id);

      const free = await ctx.services.startFreeWorkout();
      await ctx.services.addExercisesToWorkout(free.id, [fx.ids.a]);
      ctx.advance(MIN);
      await ctx.services.finishWorkout(free.id);
      expect((await ctx.services.getSuggestedNextDay())?.day.id).toBe(fx.other.id);
      expect((await ctx.services.getRecentWorkouts(5)).map((i) => i.workout.id)).toContain(free.id);
    });
  });

  describe('addExercisesToWorkout', () => {
    it('adds 3 prefilled sets per exercise right after afterOrder', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const x = await ctx.exercise('X', 'chest');
      const y = await ctx.exercise('Y', 'chest');

      // history for X: 40, 42.5 kg
      const free = await ctx.services.startFreeWorkout();
      await ctx.services.addExercisesToWorkout(free.id, [x]);
      const [only] = (await ctx.repos.workouts.getById(free.id))!.exercises;
      await complete(ctx, only!.sets[0]!.id, 40, 10);
      await complete(ctx, only!.sets[1]!.id, 42.5, 8);
      ctx.advance(MIN);
      await ctx.services.finishWorkout(free.id);
      ctx.advance(DAY);

      const w = await ctx.services.startWorkoutFromDay(fx.day.id);
      const updated = await ctx.services.addExercisesToWorkout(w.id, [x, y], { afterOrder: 0 });
      expect(updated.exercises.map((e) => [e.order, e.exerciseId, e.origin])).toEqual([
        [0, fx.ids.a, 'planned'],
        [1, x, 'added'],
        [2, y, 'added'],
        [3, fx.ids.b, 'planned'],
        [4, fx.ids.c, 'planned'],
      ]);
      const [, ax, ay] = updated.exercises;
      expect(ax).toMatchObject({
        plannedSets: 3,
        plannedReps: '10',
        plannedSetReps: ['10', '10', '10'],
      });
      expect('plannedExerciseId' in ax!).toBe(false);
      // same setIndex, else the last previous set; reps empty; "planned" source
      expect(ax!.sets.map((s) => [s.setIndex, s.weightKg, s.reps, s.completed, s.source])).toEqual([
        [0, 40, undefined, false, 'planned'],
        [1, 42.5, undefined, false, 'planned'],
        [2, 42.5, undefined, false, 'planned'],
      ]);
      expect(ay!.sets.every((s) => s.weightKg === undefined)).toBe(true);
    });

    it('needs a workout in progress', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const w = await ctx.services.startWorkoutFromDay(fx.day.id);
      await expect(ctx.services.addExercisesToWorkout('nope', [fx.ids.a])).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(ctx.services.addExercisesToWorkout(w.id, ['nope'])).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await ctx.services.finishWorkout(w.id);
      await expect(ctx.services.addExercisesToWorkout(w.id, [fx.ids.a])).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  describe('finishWorkout names a free workout', () => {
    async function freeNamed(
      ctx: Ctx,
      exercises: { name: string; group: MuscleGroup; done: number }[],
      rename?: string,
    ) {
      const w = await ctx.services.startFreeWorkout();
      const ids: string[] = [];
      for (const e of exercises) ids.push(await ctx.exercise(e.name, e.group));
      const detail = await ctx.services.addExercisesToWorkout(w.id, ids);
      for (const [i, e] of exercises.entries()) {
        for (const set of detail.exercises[i]!.sets.slice(0, e.done)) {
          await complete(ctx, set.id, 20, 10);
        }
      }
      if (rename) await ctx.repos.workouts.update(w.id, { name: rename });
      return (await ctx.services.finishWorkout(w.id)).name;
    }

    it('uses the region with the most completed sets', async () => {
      const ctx = await setup();
      expect(
        await freeNamed(ctx, [
          { name: 'Sentadilla', group: 'quads', done: 3 },
          { name: 'Curl femoral', group: 'hamstrings', done: 2 },
        ]),
      ).toBe('Libre · Piernas');
    });

    it('uses the two best regions, most sets first', async () => {
      const ctx = await setup();
      expect(
        await freeNamed(ctx, [
          { name: 'Press', group: 'chest', done: 1 },
          { name: 'Remo', group: 'back', done: 3 },
          { name: 'Curl', group: 'biceps', done: 2 },
          { name: 'Triceps', group: 'triceps', done: 2 },
        ]),
      ).toBe('Libre · Brazos y Espalda');
    });

    it('breaks ties by first appearance in the workout', async () => {
      const ctx = await setup();
      expect(
        await freeNamed(ctx, [
          { name: 'Press', group: 'chest', done: 2 },
          { name: 'Remo', group: 'back', done: 2 },
          { name: 'Vuelos', group: 'shoulders', done: 2 },
        ]),
      ).toBe('Libre · Pecho y Espalda');
    });

    it('keeps "Entreno libre" with no completed sets', async () => {
      const ctx = await setup();
      expect(await freeNamed(ctx, [{ name: 'Press', group: 'chest', done: 0 }])).toBe(
        FREE_WORKOUT_DEFAULT_NAME,
      );
      const ctx2 = await setup();
      const w = await ctx2.services.startFreeWorkout();
      expect((await ctx2.services.finishWorkout(w.id)).name).toBe(FREE_WORKOUT_DEFAULT_NAME);
    });

    it('does not override a name the user chose, nor rename a routine workout', async () => {
      const ctx = await setup();
      expect(await freeNamed(ctx, [{ name: 'Press', group: 'chest', done: 3 }], 'Mi sesión')).toBe(
        'Mi sesión',
      );
      const ctx2 = await setup();
      const fx = await routineFixture(ctx2);
      const w = await ctx2.services.startWorkoutFromDay(fx.day.id);
      await complete(ctx2, w.exercises[0]!.sets[0]!.id, 10, 10);
      expect((await ctx2.services.finishWorkout(w.id)).name).toBe('Día A');
    });
  });

  describe('getPlanChanges / applyPlanChanges / keepPlan', () => {
    async function started(ctx: Ctx) {
      const fx = await routineFixture(ctx);
      const w = await ctx.services.startWorkoutFromDay(fx.day.id);
      return { ...fx, w };
    }
    const exerciseOf = (
      w: Awaited<ReturnType<Ctx['services']['startWorkoutFromDay']>>,
      i: number,
    ) => w.exercises[i]!;

    /** The messy workout: A 3→2 sets, B 3→4, X added after A, C removed, B and A swapped. */
    async function messyWorkout(ctx: Ctx) {
      const fx = await started(ctx);
      const { repos, services } = ctx;
      const [wa, wb, wc] = fx.w.exercises;
      await repos.workouts.removeSet(wa!.sets[2]!.id);
      await repos.workouts.addSet(wb!.id);
      await repos.workouts.removeWorkoutExercise(wc!.id);
      const x = await ctx.exercise('X', 'chest');
      const withX = await services.addExercisesToWorkout(fx.w.id, [x], { afterOrder: 0 });
      const xe = withX.exercises[1]!;
      await complete(ctx, xe.sets[0]!.id, 30, 8);
      await complete(ctx, xe.sets[1]!.id, 30, 8);
      await complete(ctx, xe.sets[2]!.id, 30, 10);
      // order now [A, X, B] -> [B, A, X]
      await repos.workouts.reorderWorkoutExercises(fx.w.id, [wb!.id, wa!.id, xe.id]);
      ctx.advance(MIN);
      await services.finishWorkout(fx.w.id);
      return { ...fx, x };
    }

    it('is "none" for free workouts, old workouts and workouts without changes', async () => {
      const ctx = await setup();
      const fx = await started(ctx);
      expect(await ctx.services.getPlanChanges(fx.w.id)).toEqual({
        status: 'none',
        dayName: 'Día A',
        items: [],
      });
      await ctx.services.finishWorkout(fx.w.id);
      expect((await ctx.services.getPlanChanges(fx.w.id)).status).toBe('none');

      const free = await ctx.services.startFreeWorkout();
      expect(await ctx.services.getPlanChanges(free.id)).toEqual({ status: 'none', items: [] });
      await expect(ctx.services.applyPlanChanges(free.id)).rejects.toBeInstanceOf(ValidationError);

      // a workout created before v3: routine kind but no planSnapshot
      await ctx.services.finishWorkout(free.id);
      const old = await ctx.repos.workouts.create({
        kind: 'routine',
        routineId: fx.routine.id,
        dayId: fx.day.id,
        name: 'Día A',
        exercises: [],
      });
      expect((await ctx.services.getPlanChanges(old.id)).status).toBe('none');
      await expect(ctx.services.getPlanChanges('nope')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('lists the structural changes in the order of the card', async () => {
      const ctx = await setup();
      const fx = await messyWorkout(ctx);
      const changes = await ctx.services.getPlanChanges(fx.w.id);
      expect(changes).toEqual({
        status: 'changed',
        dayName: 'Día A',
        items: [
          {
            kind: 'setsChanged',
            plannedExerciseId: fx.planned.a.id,
            exerciseName: 'A',
            from: 3,
            to: 2,
          },
          {
            kind: 'setsChanged',
            plannedExerciseId: fx.planned.b.id,
            exerciseName: 'B',
            from: 3,
            to: 4,
          },
          { kind: 'added', exerciseId: fx.x, exerciseName: 'X', sets: 3, reps: '8' },
          { kind: 'removed', plannedExerciseId: fx.planned.c.id, exerciseName: 'C' },
          { kind: 'reordered' },
        ],
      });
    });

    it('ignores kg, reps, skipped and completed flags: only structure counts', async () => {
      const ctx = await setup();
      const fx = await started(ctx);
      const [wa] = fx.w.exercises;
      await complete(ctx, wa!.sets[0]!.id, 100, 1);
      await ctx.repos.workouts.updateWorkoutExercise(exerciseOf(fx.w, 1).id, { skipped: true });
      await ctx.services.finishWorkout(fx.w.id);
      expect((await ctx.services.getPlanChanges(fx.w.id)).status).toBe('none');
    });

    it('does not count a reordering that only moves added exercises', async () => {
      const ctx = await setup();
      const fx = await started(ctx);
      const x = await ctx.exercise('X');
      const withX = await ctx.services.addExercisesToWorkout(fx.w.id, [x], { afterOrder: 0 });
      const ids = withX.exercises.map((e) => e.id);
      await ctx.repos.workouts.reorderWorkoutExercises(fx.w.id, [
        ids[0]!,
        ids[2]!,
        ids[1]!,
        ids[3]!,
      ]);
      await ctx.services.finishWorkout(fx.w.id);
      const { items } = await ctx.services.getPlanChanges(fx.w.id);
      expect(items.map((i) => i.kind)).toEqual(['added']);
    });

    it('is "routineChanged" when the day was edited or deleted meanwhile', async () => {
      const ctx = await setup();
      const fx = await started(ctx);
      await ctx.repos.workouts.addSet(exerciseOf(fx.w, 0).id);
      await ctx.services.finishWorkout(fx.w.id);
      expect((await ctx.services.getPlanChanges(fx.w.id)).status).toBe('changed');

      await ctx.repos.routines.updatePlannedExercise(fx.planned.c.id, {
        plannedSets: [{ reps: '12' }],
      });
      expect(await ctx.services.getPlanChanges(fx.w.id)).toEqual({
        status: 'routineChanged',
        dayName: 'Día A',
        items: [],
      });
      await expect(ctx.services.applyPlanChanges(fx.w.id)).rejects.toBeInstanceOf(ValidationError);

      await ctx.repos.routines.deleteDay(fx.day.id);
      expect((await ctx.services.getPlanChanges(fx.w.id)).status).toBe('routineChanged');
    });

    it('detects any edit of the day: added, removed or reordered planned exercises', async () => {
      for (const edit of ['add', 'remove', 'reorder'] as const) {
        const ctx = await setup();
        const fx = await started(ctx);
        await ctx.repos.workouts.addSet(exerciseOf(fx.w, 0).id);
        await ctx.services.finishWorkout(fx.w.id);
        if (edit === 'add') {
          await ctx.repos.routines.addPlannedExercises(fx.day.id, [{ exerciseId: fx.ids.a }]);
        } else if (edit === 'remove') {
          await ctx.repos.routines.deletePlannedExercise(fx.planned.c.id);
        } else {
          await ctx.repos.routines.reorderPlannedExercises(fx.day.id, [
            fx.planned.c.id,
            fx.planned.a.id,
            fx.planned.b.id,
          ]);
        }
        expect((await ctx.services.getPlanChanges(fx.w.id)).status).toBe('routineChanged');
      }
    });

    it('applyPlanChanges updates the day, keeps kg/reps/rest and stores "applied"', async () => {
      const ctx = await setup();
      const fx = await messyWorkout(ctx);
      await ctx.services.applyPlanChanges(fx.w.id);

      const day = (await ctx.repos.routines.getDay(fx.day.id))!;
      expect(day.exercises.map((p) => [p.order, p.exerciseId])).toEqual([
        [0, fx.ids.b],
        [1, fx.ids.a],
        [2, fx.x],
      ]);
      const [b, a, x] = day.exercises;
      // "perSet": the new set copies the last one
      expect(b).toMatchObject({
        id: fx.planned.b.id,
        repsMode: 'perSet',
        plannedSets: [{ reps: '5' }, { reps: '3' }, { reps: '1' }, { reps: '1' }],
      });
      // "same": count adjusted, reps copied; rest and notes untouched
      expect(a).toMatchObject({
        id: fx.planned.a.id,
        repsMode: 'same',
        plannedSets: [{ reps: '8-10' }, { reps: '8-10' }],
        restSeconds: 90,
        notes: 'n',
      });
      // the added exercise: as many sets as it ended with, the most repeated reps
      expect(x).toMatchObject({
        repsMode: 'same',
        plannedSets: [{ reps: '8' }, { reps: '8' }, { reps: '8' }],
      });
      expect(await ctx.repos.routines.getDay(fx.day.id)).not.toBeNull();
      expect(
        (await ctx.repos.routines.getById(fx.routine.id))!.days.find((d) => d.id === fx.other.id)!
          .exercises,
      ).toHaveLength(1); // other days untouched

      expect(await ctx.services.getPlanChanges(fx.w.id)).toEqual({
        status: 'decided',
        dayName: 'Día A',
        items: [],
        decision: 'applied',
      });
      expect((await ctx.repos.workouts.getById(fx.w.id))!.planChangeDecision).toBe('applied');
      await expect(ctx.services.applyPlanChanges(fx.w.id)).rejects.toBeInstanceOf(ValidationError);
      // the workout itself is untouched
      expect((await ctx.repos.workouts.getById(fx.w.id))!.exercises).toHaveLength(3);
    });

    it('applies growth in "same" mode and removal from the end in "perSet" mode', async () => {
      const ctx = await setup();
      const fx = await started(ctx);
      const [wa, wb] = fx.w.exercises;
      await ctx.repos.workouts.addSet(wa!.id);
      await ctx.repos.workouts.addSet(wa!.id);
      await ctx.repos.workouts.removeSet(wb!.sets[2]!.id);
      await ctx.services.finishWorkout(fx.w.id);
      await ctx.services.applyPlanChanges(fx.w.id);
      const [a, b, c] = (await ctx.repos.routines.getDay(fx.day.id))!.exercises;
      expect(a!.plannedSets).toEqual(Array.from({ length: 5 }, () => ({ reps: '8-10' })));
      expect(b!.plannedSets).toEqual([{ reps: '5' }, { reps: '3' }]);
      expect(c!.plannedSets).toHaveLength(2);
    });

    it('treats a planned exercise left without sets as removed', async () => {
      const ctx = await setup();
      const fx = await started(ctx);
      const wc = fx.w.exercises[2]!;
      for (const s of wc.sets) await ctx.repos.workouts.removeSet(s.id);
      await ctx.services.finishWorkout(fx.w.id);
      expect((await ctx.services.getPlanChanges(fx.w.id)).items).toEqual([
        { kind: 'removed', plannedExerciseId: fx.planned.c.id, exerciseName: 'C' },
      ]);
      await ctx.services.applyPlanChanges(fx.w.id);
      expect((await ctx.repos.routines.getDay(fx.day.id))!.exercises).toHaveLength(2);
    });

    it('keepPlan stores "kept" and the card never shows again', async () => {
      const ctx = await setup();
      const fx = await messyWorkout(ctx);
      await ctx.services.keepPlan(fx.w.id);
      expect(await ctx.services.getPlanChanges(fx.w.id)).toMatchObject({
        status: 'decided',
        decision: 'kept',
      });
      await expect(ctx.services.applyPlanChanges(fx.w.id)).rejects.toBeInstanceOf(ValidationError);
      expect((await ctx.repos.routines.getDay(fx.day.id))!.exercises).toHaveLength(3);
      await expect(ctx.services.keepPlan('nope')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('the next workout of the day snapshots the updated plan', async () => {
      const ctx = await setup();
      const fx = await messyWorkout(ctx);
      await ctx.services.applyPlanChanges(fx.w.id);
      ctx.advance(DAY);
      const next = await ctx.services.startWorkoutFromDay(fx.day.id);
      expect(next.exercises.map((e) => [e.exerciseId, e.plannedSets])).toEqual([
        [fx.ids.b, 4],
        [fx.ids.a, 2],
        [fx.x, 3],
      ]);
      await ctx.services.finishWorkout(next.id);
      expect((await ctx.services.getPlanChanges(next.id)).status).toBe('none');
    });
  });

  describe('soft delete and records (computed, never stored)', () => {
    async function threeSessions(ctx: Ctx) {
      const fx = await routineFixture(ctx);
      const train = async (weightKg: number, reps: number) => {
        const w = await ctx.services.startWorkoutFromDay(fx.day.id);
        await complete(ctx, w.exercises[0]!.sets[0]!.id, weightKg, reps);
        ctx.advance(30 * MIN);
        await ctx.services.finishWorkout(w.id);
        ctx.advance(DAY);
        return w.id;
      };
      const w1 = await train(100, 5);
      const w2 = await train(110, 5);
      const w3 = await train(105, 5);
      return { ...fx, w1, w2, w3 };
    }
    const prs = async (ctx: Ctx, id: string) =>
      (await ctx.services.getWorkoutSummary(id)).personalRecords.map((r) => [
        r.type,
        r.valueKg,
        r.previousKg,
      ]);

    it('deleting a record workout sends the records back to the previous best; restore undoes it', async () => {
      const ctx = await setup();
      const fx = await threeSessions(ctx);
      const progress = async () =>
        (await ctx.services.getExerciseProgress(fx.ids.a)).map((p) => p.bestWeightKg);
      const e1rm = (kg: number) => epley(kg, 5);

      expect(await progress()).toEqual([100, 110, 105]);
      expect(await prs(ctx, fx.w2)).toEqual([
        ['weight', 110, 100],
        ['e1rm', e1rm(110), e1rm(100)],
      ]);
      expect(await prs(ctx, fx.w3)).toEqual([]);
      expect(await ctx.services.getDeletionImpact(fx.w2)).toEqual([
        {
          exerciseId: fx.ids.a,
          exerciseName: 'A',
          previous: { weightKg: 100, reps: 5, e1rmKg: e1rm(100) },
        },
      ]);
      expect(await ctx.services.getDeletionImpact(fx.w3)).toEqual([]);
      expect(await ctx.services.getDeletionImpact(fx.w1)).toEqual([]); // first time: no PR

      await ctx.repos.workouts.softDelete(fx.w2);

      expect(await progress()).toEqual([100, 105]);
      expect(await prs(ctx, fx.w3)).toEqual([
        ['weight', 105, 100],
        ['e1rm', e1rm(105), e1rm(100)],
      ]);
      expect(await ctx.services.getDeletionImpact(fx.w3)).toEqual([
        {
          exerciseId: fx.ids.a,
          exerciseName: 'A',
          previous: { weightKg: 100, reps: 5, e1rmKg: e1rm(100) },
        },
      ]);
      expect((await ctx.services.getRecentWorkouts(10)).map((i) => i.workout.id)).toEqual([
        fx.w3,
        fx.w1,
      ]);
      const weeks = await ctx.services.getWeeklyStats(1);
      expect(weeks[0]).toMatchObject({ workouts: 2, volumeKg: 100 * 5 + 105 * 5 });
      expect(
        (await ctx.services.getPreviousPerformance(fx.ids.a))?.sets.map((s) => s.weightKg),
      ).toEqual([105]);
      await expect(ctx.services.getWorkoutSummary(fx.w2)).rejects.toBeInstanceOf(NotFoundError);
      await expect(ctx.services.getDeletionImpact(fx.w2)).rejects.toBeInstanceOf(NotFoundError);

      await ctx.repos.workouts.restore(fx.w2);

      expect(await progress()).toEqual([100, 110, 105]);
      expect(await prs(ctx, fx.w3)).toEqual([]);
      expect(await prs(ctx, fx.w2)).toEqual([
        ['weight', 110, 100],
        ['e1rm', e1rm(110), e1rm(100)],
      ]);
      expect((await ctx.services.getWeeklyStats(1))[0]).toMatchObject({ workouts: 3 });
    });

    it('deleting the last workout of a routine moves "Hoy" back and drops the previous kg', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const w = await ctx.services.startWorkoutFromDay(fx.day.id);
      await complete(ctx, w.exercises[0]!.sets[0]!.id, 50, 10);
      await ctx.services.finishWorkout(w.id);
      expect((await ctx.services.getSuggestedNextDay())?.day.id).toBe(fx.other.id);

      await ctx.repos.workouts.softDelete(w.id);
      expect((await ctx.services.getSuggestedNextDay())?.day.id).toBe(fx.day.id);
      expect(await ctx.services.getPreviousPerformance(fx.ids.a)).toBeNull();
      const again = await ctx.services.startWorkoutFromDay(fx.day.id);
      expect(again.exercises[0]!.sets.every((s) => s.weightKg === undefined)).toBe(true);

      await ctx.repos.workouts.discard(again.id);
      await ctx.repos.workouts.restore(w.id);
      expect((await ctx.services.getSuggestedNextDay())?.day.id).toBe(fx.other.id);
    });

    it('has no "previous" when the earlier history has no weights', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const first = await ctx.services.startWorkoutFromDay(fx.day.id);
      await ctx.services.completeSet(first.exercises[0]!.sets[0]!.id, { reps: 10 });
      ctx.advance(MIN);
      await ctx.services.finishWorkout(first.id);
      ctx.advance(DAY);
      const second = await ctx.services.startWorkoutFromDay(fx.day.id);
      await complete(ctx, second.exercises[0]!.sets[0]!.id, 50, 10);
      ctx.advance(MIN);
      await ctx.services.finishWorkout(second.id);
      expect(await ctx.services.getDeletionImpact(second.id)).toEqual([
        { exerciseId: fx.ids.a, exerciseName: 'A' },
      ]);
    });
  });

  describe('export', () => {
    it('exports version 3 without soft-deleted workouts, exercises or sets', async () => {
      const ctx = await setup();
      const fx = await routineFixture(ctx);
      const done = async () => {
        const w = await ctx.services.startWorkoutFromDay(fx.day.id);
        await complete(ctx, w.exercises[0]!.sets[0]!.id, 50, 10);
        ctx.advance(MIN);
        await ctx.services.finishWorkout(w.id);
        ctx.advance(DAY);
        return w.id;
      };
      const keep = await done();
      const gone = await done();
      await ctx.repos.workouts.softDelete(gone);

      const payload = await ctx.services.exportAllData();
      expect(payload.version).toBe(3);
      expect(payload.data.workouts.map((w) => w.id)).toEqual([keep]);
      expect(new Set(payload.data.workoutExercises.map((e) => e.workoutId))).toEqual(
        new Set([keep]),
      );
      expect(payload.data.workoutSets).toHaveLength(8);
      // the tombstone is still on the device
      expect((await ctx.repos.backup.snapshot()).workouts).toHaveLength(2);

      // v3 round trip keeps every new field
      const free = await ctx.services.startFreeWorkout();
      await ctx.services.addExercisesToWorkout(free.id, [fx.ids.a]);
      await ctx.services.keepPlan(keep);
      const full = JSON.parse(JSON.stringify(await ctx.services.exportAllData())) as Awaited<
        ReturnType<typeof ctx.services.exportAllData>
      >;
      const targetRepos = await build(() => new Date());
      await createDomainServices(targetRepos).importAllData(full);
      // (import re-adds the catalog, so compare the user's data)
      const withoutCatalog = (d: DataSnapshot): DataSnapshot => ({ ...d, exercises: [] });
      expect(withoutCatalog(await targetRepos.backup.snapshot())).toEqual(
        withoutCatalog(full.data),
      );
      const importedKeep = (await targetRepos.workouts.getById(keep))!;
      expect(importedKeep).toMatchObject({ kind: 'routine', planChangeDecision: 'kept' });
      expect(importedKeep.planSnapshot).toHaveLength(3);
      expect((await targetRepos.workouts.getById(free.id))!.exercises.map((e) => e.origin)).toEqual(
        ['added'],
      );
    });
  });
});
