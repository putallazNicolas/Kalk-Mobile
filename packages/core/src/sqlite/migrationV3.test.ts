import { createDomainServices } from '../services';
import { createSqlJsDriver } from '../testing/sqlJsDriver';
import { epley } from '../utils';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, runMigrations } from './migrations';
import { createSqliteRepositories } from './index';

const NOW = new Date('2026-03-11T12:00:00.000Z'); // a Wednesday
const clock = () => NOW;

const version = async (driver: Awaited<ReturnType<typeof createSqlJsDriver>>) =>
  (await driver.first<{ user_version: number }>('PRAGMA user_version'))?.user_version;

/**
 * Builds a database exactly as the PREVIOUS app version (schema v2) left it, with the data of
 * someone who has been training for a couple of weeks: a routine with three days, three finished
 * workouts (one with personal records), one in progress, and non-default settings.
 */
async function buildV2Database() {
  const driver = await createSqlJsDriver();
  await runMigrations(
    driver,
    MIGRATIONS.filter((m) => m.version <= 2),
  );
  expect(await version(driver)).toBe(2);
  const owner = ['local-user', 'local-user'];
  const t = '2026-02-20T09:00:00.000Z';

  const insertExercise = (id: string, name: string, group: string, custom: 0 | 1) =>
    driver.run(
      `INSERT INTO exercises ("id","name","muscleGroup","equipment","isCustom","createdAt","updatedAt","ownerId","createdBy")
       VALUES (?,?,?,NULL,?,?,?,?,?)`,
      [id, name, group, custom, t, t, ...owner],
    );
  await insertExercise('seed-squat', 'Sentadilla', 'quads', 0);
  await insertExercise('seed-bench-press', 'Press banca', 'chest', 0);
  await insertExercise('custom-curl', 'Mi curl', 'biceps', 1);

  await driver.run(
    `INSERT INTO routines ("id","name","isActive","archived","createdAt","updatedAt","ownerId","createdBy")
     VALUES ('r1','Push Pull Legs',1,0,?,?,?,?)`,
    [t, t, ...owner],
  );
  for (const [id, name, order] of [
    ['d1', 'Piernas', 0],
    ['d2', 'Empuje', 1],
    ['d3', 'Tirón', 2],
  ] as const) {
    await driver.run(
      `INSERT INTO routine_days ("id","routineId","name","order") VALUES (?,?,?,?)`,
      [id, 'r1', name, order],
    );
  }
  const insertPlanned = (id: string, day: string, ex: string, order: number, reps: string) =>
    driver.run(
      `INSERT INTO planned_exercises ("id","dayId","exerciseId","order","repsMode","plannedSets","restSeconds","notes")
       VALUES (?,?,?,?,?,?,90,NULL)`,
      [id, day, ex, order, 'same', JSON.stringify([{ reps }, { reps }, { reps }])],
    );
  await insertPlanned('p1', 'd1', 'seed-squat', 0, '5');
  await insertPlanned('p2', 'd1', 'custom-curl', 1, '12');
  await insertPlanned('p3', 'd2', 'seed-bench-press', 0, '8');

  const insertWorkout = (
    id: string,
    day: string,
    name: string,
    start: string,
    end: string | null,
  ) =>
    driver.run(
      `INSERT INTO workouts ("id","routineId","dayId","dayNameSnapshot","startedAt","finishedAt","notes","ownerId","createdBy")
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, 'r1', day, name, start, end, end ? 'sin dolor' : null, ...owner],
    );
  await insertWorkout(
    'w1',
    'd1',
    'Piernas',
    '2026-03-02T10:00:00.000Z',
    '2026-03-02T11:00:00.000Z',
  );
  await insertWorkout('w2', 'd2', 'Empuje', '2026-03-04T10:00:00.000Z', '2026-03-04T10:50:00.000Z');
  await insertWorkout(
    'w3',
    'd1',
    'Piernas',
    '2026-03-09T10:00:00.000Z',
    '2026-03-09T11:15:00.000Z',
  );
  await insertWorkout('w4', 'd2', 'Empuje', '2026-03-11T10:00:00.000Z', null);

  const insertWe = (id: string, w: string, ex: string, order: number, reps: string, n: number) =>
    driver.run(
      `INSERT INTO workout_exercises ("id","workoutId","exerciseId","order","plannedSets","plannedReps","plannedSetReps","restSeconds","notes","skipped")
       VALUES (?,?,?,?,?,?,?,90,NULL,0)`,
      [id, w, ex, order, n, reps, JSON.stringify(Array.from({ length: n }, () => reps))],
    );
  await insertWe('we1', 'w1', 'seed-squat', 0, '5', 3);
  await insertWe('we2', 'w1', 'custom-curl', 1, '12', 2);
  await insertWe('we3', 'w2', 'seed-bench-press', 0, '8', 3);
  await insertWe('we4', 'w3', 'seed-squat', 0, '5', 3);
  await insertWe('we5', 'w3', 'custom-curl', 1, '12', 1);
  await insertWe('we6', 'w4', 'seed-bench-press', 0, '8', 3);

  const insertSet = (
    id: string,
    we: string,
    idx: number,
    kg: number | null,
    reps: number | null,
    done: 0 | 1,
  ) =>
    driver.run(
      `INSERT INTO workout_sets ("id","workoutExerciseId","setIndex","weightKg","reps","completed","completedAt")
       VALUES (?,?,?,?,?,?,?)`,
      [id, we, idx, kg, reps, done, done ? '2026-03-02T10:30:00.000Z' : null],
    );
  await insertSet('s1', 'we1', 0, 100, 5, 1);
  await insertSet('s2', 'we1', 1, 100, 5, 1);
  await insertSet('s3', 'we1', 2, 100, null, 0);
  await insertSet('s4', 'we2', 0, 20, 12, 1);
  await insertSet('s5', 'we2', 1, 20, 10, 1);
  await insertSet('s6', 'we3', 0, 80, 8, 1);
  await insertSet('s7', 'we3', 1, 80, 8, 1);
  await insertSet('s8', 'we3', 2, 80, null, 0);
  await insertSet('s9', 'we4', 0, 105, 5, 1);
  await insertSet('s10', 'we4', 1, 102.5, 5, 1);
  await insertSet('s11', 'we4', 2, 100, 4, 1);
  await insertSet('s12', 'we5', 0, 22.5, 12, 1);
  await insertSet('s13', 'we6', 0, 82.5, null, 0);
  await insertSet('s14', 'we6', 1, 82.5, null, 0);
  await insertSet('s15', 'we6', 2, 82.5, null, 0);

  await driver.run(`INSERT INTO settings ("key","value") VALUES ('unit','"lb"')`);
  await driver.run(`INSERT INTO settings ("key","value") VALUES ('restTimerEnabled','false')`);
  return driver;
}

describe('sqlite migration v2 -> v3 with real v2 data', () => {
  it('migrates in one step and records the version', async () => {
    const driver = await buildV2Database();
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
    await createSqliteRepositories(driver, { seed: false });
    expect(await version(driver)).toBe(LATEST_SCHEMA_VERSION);
    await runMigrations(driver); // idempotent
    expect(await version(driver)).toBe(LATEST_SCHEMA_VERSION);
  });

  it('keeps every stored value: the old columns are identical, the new ones take their defaults', async () => {
    const driver = await buildV2Database();
    const before = {
      workouts: await driver.all('SELECT * FROM workouts ORDER BY id'),
      exercises: await driver.all('SELECT * FROM workout_exercises ORDER BY id'),
      sets: await driver.all('SELECT * FROM workout_sets ORDER BY id'),
      settings: await driver.all('SELECT * FROM settings ORDER BY key'),
      planned: await driver.all('SELECT * FROM planned_exercises ORDER BY id'),
    };
    await createSqliteRepositories(driver, { seed: false });

    const workouts = await driver.all<Record<string, unknown>>(
      'SELECT * FROM workouts ORDER BY id',
    );
    expect(workouts).toHaveLength(4);
    for (const [i, row] of workouts.entries()) {
      const { dayNameSnapshot, ...old } = before.workouts[i] as Record<string, unknown>;
      expect(row).toEqual({
        ...old,
        name: dayNameSnapshot, // the column was renamed, the value is the same
        kind: 'routine',
        planSnapshot: null,
        planChangeDecision: null,
        deletedAt: null,
      });
    }
    const exercises = await driver.all<Record<string, unknown>>(
      'SELECT * FROM workout_exercises ORDER BY id',
    );
    expect(exercises).toEqual(
      before.exercises.map((row) => ({ ...row, origin: 'planned', plannedExerciseId: null })),
    );
    const sets = await driver.all<Record<string, unknown>>(
      'SELECT * FROM workout_sets ORDER BY id',
    );
    expect(sets).toEqual(before.sets.map((row) => ({ ...row, source: 'planned' })));
    expect(await driver.all('SELECT * FROM settings ORDER BY key')).toEqual(before.settings);
    expect(await driver.all('SELECT * FROM planned_exercises ORDER BY id')).toEqual(before.planned);
  });

  it('changes nothing the user sees', async () => {
    const driver = await buildV2Database();
    const repos = await createSqliteRepositories(driver, { seed: false });
    const services = createDomainServices(repos, { now: clock });

    // history, most recent first, with their names
    expect((await repos.workouts.listFinished()).map((w) => [w.id, w.name])).toEqual([
      ['w3', 'Piernas'],
      ['w2', 'Empuje'],
      ['w1', 'Piernas'],
    ]);
    const w1 = (await repos.workouts.getById('w1'))!;
    expect(w1).toMatchObject({
      name: 'Piernas',
      kind: 'routine',
      routineId: 'r1',
      dayId: 'd1',
      notes: 'sin dolor',
      startedAt: '2026-03-02T10:00:00.000Z',
      finishedAt: '2026-03-02T11:00:00.000Z',
    });
    expect(w1.exercises.map((e) => [e.exerciseId, e.order, e.origin])).toEqual([
      ['seed-squat', 0, 'planned'],
      ['custom-curl', 1, 'planned'],
    ]);
    expect(w1.exercises[0]).toMatchObject({
      plannedSets: 3,
      plannedReps: '5',
      plannedSetReps: ['5', '5', '5'],
      restSeconds: 90,
      skipped: false,
    });
    expect(
      w1.exercises[0]!.sets.map((s) => [s.setIndex, s.weightKg, s.reps, s.completed, s.source]),
    ).toEqual([
      [0, 100, 5, true, 'planned'],
      [1, 100, 5, true, 'planned'],
      [2, 100, undefined, false, 'planned'],
    ]);
    for (const w of [
      w1,
      ...(await Promise.all(['w2', 'w3', 'w4'].map((id) => repos.workouts.getById(id)))),
    ]) {
      expect('planSnapshot' in w!).toBe(false);
      expect('planChangeDecision' in w!).toBe(false);
      expect('deletedAt' in w!).toBe(false);
      for (const e of w!.exercises) expect('plannedExerciseId' in e).toBe(false);
    }

    // summaries: volume and personal records
    const s1 = await services.getWorkoutSummary('w1');
    expect(s1).toMatchObject({ volumeKg: 1440, completedSets: 4, totalSets: 5, exerciseCount: 2 });
    expect(s1.personalRecords).toEqual([]); // the first time is never a record
    const s2 = await services.getWorkoutSummary('w2');
    expect(s2).toMatchObject({ volumeKg: 1280, completedSets: 2, totalSets: 3 });
    expect(s2.personalRecords).toEqual([]);
    const s3 = await services.getWorkoutSummary('w3');
    expect(s3).toMatchObject({ volumeKg: 1707.5, completedSets: 4, totalSets: 4 });
    expect(
      s3.personalRecords.map((r) => [r.exerciseName, r.type, r.valueKg, r.previousKg]),
    ).toEqual([
      ['Sentadilla', 'weight', 105, 100],
      ['Sentadilla', 'e1rm', epley(105, 5), epley(100, 5)],
      ['Mi curl', 'weight', 22.5, 20],
      ['Mi curl', 'e1rm', epley(22.5, 12), epley(20, 12)],
    ]);
    expect(s3.exercises[0]!.bestSet).toEqual({
      weightKg: 105,
      reps: 5,
      e1rmKg: epley(105, 5),
    });

    // recent workouts
    expect(
      (await services.getRecentWorkouts(10)).map((i) => [
        i.workout.id,
        i.durationSeconds,
        i.volumeKg,
        i.completedSets,
      ]),
    ).toEqual([
      ['w3', 4500, 1707.5, 4],
      ['w2', 3000, 1280, 2],
      ['w1', 3600, 1440, 4],
    ]);

    // exercise progress and previous performance
    expect(
      (await services.getExerciseProgress('seed-squat')).map((p) => [
        p.workoutId,
        p.bestWeightKg,
        p.bestE1rmKg,
        p.volumeKg,
        p.sets.length,
      ]),
    ).toEqual([
      ['w1', 100, epley(100, 5), 1000, 2],
      ['w3', 105, epley(105, 5), 1437.5, 3],
    ]);
    expect((await services.getPreviousPerformance('seed-bench-press'))?.sets).toEqual([
      { setIndex: 0, weightKg: 80, reps: 8 },
      { setIndex: 1, weightKg: 80, reps: 8 },
    ]);

    // weekly stats (Feb 23 week, Mar 2 week, Mar 9 week): the workout in progress does not count
    expect((await services.getWeeklyStats(3)).map((w) => [w.workouts, w.volumeKg])).toEqual([
      [0, 0],
      [2, 1440 + 1280],
      [1, 1707.5],
    ]);

    // Hoy: the day after the last finished one (w3 was Piernas)
    expect((await services.getSuggestedNextDay())?.day).toMatchObject({ id: 'd2', name: 'Empuje' });

    // the workout in progress is still there, with its prefilled weights
    const open = (await repos.workouts.getInProgress())!;
    expect(open).toMatchObject({ id: 'w4', name: 'Empuje' });
    expect(
      (await repos.workouts.getById('w4'))!.exercises[0]!.sets.map((s) => [
        s.weightKg,
        s.completed,
      ]),
    ).toEqual([
      [82.5, false],
      [82.5, false],
      [82.5, false],
    ]);

    // settings: what was stored stays, the new one has its default
    expect(await repos.settings.get()).toEqual({
      unit: 'lb',
      restTimerEnabled: false,
      restNotifications: 'unasked',
    });

    // no old workout offers a routine update
    for (const id of ['w1', 'w2', 'w3', 'w4']) {
      expect((await services.getPlanChanges(id)).status).toBe('none');
    }
    // the routine itself is untouched
    const routine = (await repos.routines.getById('r1'))!;
    expect(routine.days.map((d) => [d.name, d.exercises.length])).toEqual([
      ['Piernas', 2],
      ['Empuje', 1],
      ['Tirón', 0],
    ]);
  });

  it('exports every old workout as a v3 file', async () => {
    const repos = await createSqliteRepositories(await buildV2Database(), { seed: false });
    const payload = await createDomainServices(repos, { now: clock }).exportAllData();
    expect(payload.version).toBe(3);
    expect(payload.data.workouts.map((w) => [w.id, w.kind, w.name])).toEqual([
      ['w1', 'routine', 'Piernas'],
      ['w2', 'routine', 'Empuje'],
      ['w3', 'routine', 'Piernas'],
      ['w4', 'routine', 'Empuje'],
    ]);
    expect(payload.data.workoutSets).toHaveLength(15);
  });

  it('keeps the migrated database fully usable', async () => {
    const repos = await createSqliteRepositories(await buildV2Database(), { seed: false });
    const services = createDomainServices(repos, { now: clock });

    // finish the workout in progress and start a free one
    await services.completeSet('s13', { weightKg: 82.5, reps: 8 });
    expect((await services.finishWorkout('w4')).name).toBe('Empuje');
    const free = await services.startFreeWorkout();
    await services.addExercisesToWorkout(free.id, ['seed-squat']);
    expect(
      (await repos.workouts.getById(free.id))!.exercises[0]!.sets.map((s) => s.weightKg),
    ).toEqual([105, 102.5, 100]); // prefilled from w3, set by set
    await services.finishWorkout(free.id);

    // soft delete and restore an old workout
    await repos.workouts.softDelete('w3');
    expect((await services.getExerciseProgress('seed-squat')).map((p) => p.workoutId)).toEqual([
      'w1',
    ]);
    // w4 beat the 80 kg of w2 on the bench: deleting it would go back to that
    expect(await services.getDeletionImpact('w4')).toEqual([
      {
        exerciseId: 'seed-bench-press',
        exerciseName: 'Press banca',
        previous: { weightKg: 80, reps: 8, e1rmKg: epley(80, 8) },
      },
    ]);
    await repos.workouts.restore('w3');
    expect((await services.getExerciseProgress('seed-squat')).map((p) => p.workoutId)).toEqual([
      'w1',
      'w3',
    ]);

    // a new workout from a day carries the v3 data
    const next = await services.startWorkoutFromDay('d1');
    expect(next.planSnapshot).toHaveLength(2);
    expect(next.exercises[0]).toMatchObject({ origin: 'planned', plannedExerciseId: 'p1' });
  });

  it('rolls back the whole migration if a step fails (old data stays as it was)', async () => {
    const driver = await buildV2Database();
    const v3 = MIGRATIONS.find((m) => m.version === 3)!;
    const broken = [
      ...MIGRATIONS.filter((m) => m.version <= 2),
      { version: 3, up: [...v3.up, 'THIS IS NOT SQL'] },
    ];
    await expect(runMigrations(driver, broken)).rejects.toBeDefined();
    expect(await version(driver)).toBe(2);
    const row = await driver.first<Record<string, unknown>>(
      `SELECT * FROM workouts WHERE "id" = 'w3'`,
    );
    expect(row).toMatchObject({ dayNameSnapshot: 'Piernas' });
    expect(row).not.toHaveProperty('kind');
    expect(await driver.all('SELECT * FROM workout_sets')).toHaveLength(15);
    // and a later attempt with the real migration still succeeds
    await runMigrations(driver);
    expect(await version(driver)).toBe(LATEST_SCHEMA_VERSION);
    expect(await driver.all('SELECT * FROM workout_sets')).toHaveLength(15);
  });
});
