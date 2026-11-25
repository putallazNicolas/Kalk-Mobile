import { EXPORT_FORMAT, EXPORT_VERSION, type Repositories } from '../contracts';
import { createInMemoryRepositories } from '../memory';
import { createSqliteRepositories } from '../sqlite';
import { createSqlJsDriver } from '../testing/sqlJsDriver';
import { migrateExportPayload } from './exportMigrations';
import { createDomainServices } from './index';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const clock = () => NOW;
const viaJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Build = () => Promise<Repositories>;
const BACKENDS: [string, Build][] = [
  ['in-memory', async () => createInMemoryRepositories({ now: clock })],
  ['sqlite', async () => createSqliteRepositories(await createSqlJsDriver(), { now: clock })],
];

const ts = '2026-05-01T10:00:00.000Z';
const owner = { ownerId: 'local-user', createdBy: 'local-user' };

/** A file exactly as the previous app version (export v2) wrote it. */
const v2File = () => ({
  format: EXPORT_FORMAT,
  version: 2,
  exportedAt: ts,
  data: {
    exercises: [
      {
        id: 'e1',
        name: 'Curl',
        muscleGroup: 'biceps',
        isCustom: true,
        createdAt: ts,
        updatedAt: ts,
        ...owner,
      },
    ],
    routines: [
      {
        id: 'r1',
        name: 'R',
        isActive: true,
        archived: false,
        createdAt: ts,
        updatedAt: ts,
        ...owner,
      },
    ],
    routineDays: [{ id: 'd1', routineId: 'r1', name: 'Día A', order: 0 }],
    plannedExercises: [
      {
        id: 'p1',
        dayId: 'd1',
        exerciseId: 'e1',
        order: 0,
        repsMode: 'perSet',
        plannedSets: [{ reps: '5' }, { reps: '3' }],
        restSeconds: 90,
      },
    ],
    workouts: [
      {
        id: 'w1',
        routineId: 'r1',
        dayId: 'd1',
        dayNameSnapshot: 'Día A',
        startedAt: ts,
        finishedAt: '2026-05-01T11:00:00.000Z',
        notes: 'buen día',
        ...owner,
      },
      {
        id: 'w2',
        routineId: 'gone',
        dayNameSnapshot: 'Día viejo',
        startedAt: '2026-05-03T10:00:00.000Z',
        ...owner,
      },
    ],
    workoutExercises: [
      {
        id: 'we1',
        workoutId: 'w1',
        exerciseId: 'e1',
        order: 0,
        plannedSets: 2,
        plannedReps: '5 · 3',
        plannedSetReps: ['5', '3'],
        restSeconds: 90,
        skipped: false,
      },
      {
        id: 'we2',
        workoutId: 'w2',
        exerciseId: 'e1',
        order: 0,
        plannedSets: 1,
        plannedReps: '10',
        plannedSetReps: ['10'],
        skipped: true,
      },
    ],
    workoutSets: [
      {
        id: 's1',
        workoutExerciseId: 'we1',
        setIndex: 0,
        weightKg: 20,
        reps: 5,
        completed: true,
        completedAt: ts,
      },
      { id: 's2', workoutExerciseId: 'we1', setIndex: 1, weightKg: 20, completed: false },
      { id: 's3', workoutExerciseId: 'we2', setIndex: 0, completed: false },
    ],
    settings: { unit: 'lb', restTimerEnabled: false },
  },
});

describe('export v2 -> v3 step', () => {
  it('adds the v3 defaults and renames dayNameSnapshot, without mutating the input', () => {
    const file = v2File();
    const before = JSON.stringify(file);
    const migrated = migrateExportPayload(file) as unknown as ReturnType<typeof v2File>;
    expect(JSON.stringify(file)).toBe(before);
    expect(migrated.version).toBe(3);
    const [w1] = migrated.data.workouts as unknown as Record<string, unknown>[];
    expect(w1).toMatchObject({ kind: 'routine', name: 'Día A' });
    expect('dayNameSnapshot' in w1!).toBe(false);
    expect(migrated.data.workoutExercises.every((e) => 'origin' in e)).toBe(true);
    expect(migrated.data.settings).toEqual({
      unit: 'lb',
      restTimerEnabled: false,
      restNotifications: 'unasked',
    });
  });

  it('leaves malformed rows for the validator', () => {
    const file = v2File();
    (file.data as Record<string, unknown>).workouts = [42];
    expect((migrateExportPayload(file).data as { workouts: unknown[] }).workouts).toEqual([42]);
  });
});

describe.each(BACKENDS)('importing a v2 file on %s', (_name, build) => {
  it('converts it to v3 and nothing the user sees changes', async () => {
    const repos = await build();
    const svc = createDomainServices(repos, { now: clock });
    const file = v2File();
    const result = await svc.importAllData(file);
    expect(result.workouts).toBe(2);

    const w1 = (await repos.workouts.getById('w1'))!;
    expect(w1).toMatchObject({
      kind: 'routine',
      name: 'Día A',
      notes: 'buen día',
      finishedAt: '2026-05-01T11:00:00.000Z',
      routineId: 'r1',
      dayId: 'd1',
    });
    expect('planSnapshot' in w1).toBe(false);
    expect('planChangeDecision' in w1).toBe(false);
    expect('deletedAt' in w1).toBe(false);
    expect(w1.exercises[0]).toMatchObject({ origin: 'planned', plannedSetReps: ['5', '3'] });
    expect('plannedExerciseId' in w1.exercises[0]!).toBe(false);
    expect(w1.exercises[0]!.sets.map((s) => [s.weightKg, s.reps, s.completed, s.source])).toEqual([
      [20, 5, true, 'planned'],
      [20, undefined, false, 'planned'],
    ]);
    // dangling routine link dropped, name kept; still the workout in progress
    expect(await repos.workouts.getInProgress()).toMatchObject({
      id: 'w2',
      name: 'Día viejo',
      kind: 'routine',
    });
    expect(await repos.settings.get()).toEqual({
      unit: 'lb',
      restTimerEnabled: false,
      restNotifications: 'unasked',
    });
    expect((await svc.getWorkoutSummary('w1')).volumeKg).toBe(100);
    expect((await svc.getPlanChanges('w1')).status).toBe('none');

    // the re-export is a valid v3 file that round-trips
    const exported = viaJson(await svc.exportAllData());
    expect(exported.version).toBe(EXPORT_VERSION);
    const target = await build();
    await createDomainServices(target, { now: clock }).importAllData(exported);
    expect(await target.backup.snapshot()).toEqual(exported.data);
  });

  it('does not convert a v3 file that lacks the v3 fields', async () => {
    const svc = createDomainServices(await build(), { now: clock });
    const file = v2File();
    (file as { version: number }).version = 3;
    await expect(svc.importAllData(file)).rejects.toThrow(/workouts\[0\]\.kind/);
  });

  it('still reports bad v2 rows with their table and index', async () => {
    const svc = createDomainServices(await build(), { now: clock });
    const file = v2File();
    delete (file.data.workouts[1] as Record<string, unknown>).dayNameSnapshot;
    await expect(svc.importAllData(file)).rejects.toThrow(/workouts\[1\]\.name/);
  });
});

describe.each(BACKENDS)('importing a v3 file on %s', (_name, build) => {
  it('accepts soft-delete fields, plan snapshots and decisions', async () => {
    const repos = await build();
    const svc = createDomainServices(repos, { now: clock });
    const file = migrateExportPayload(v2File()) as unknown as ReturnType<typeof v2File> & {
      data: { workouts: Record<string, unknown>[]; workoutExercises: Record<string, unknown>[] };
    };
    Object.assign(file.data.workouts[0]!, {
      planSnapshot: [{ plannedExerciseId: 'p1', exerciseId: 'e1', order: 0, sets: 2 }],
      planChangeDecision: 'kept',
    });
    Object.assign(file.data.workoutExercises[0]!, { plannedExerciseId: 'p1' });
    await svc.importAllData(file);
    const w1 = (await repos.workouts.getById('w1'))!;
    expect(w1.planSnapshot).toEqual([
      { plannedExerciseId: 'p1', exerciseId: 'e1', order: 0, sets: 2 },
    ]);
    expect(w1.planChangeDecision).toBe('kept');
    expect(w1.exercises[0]!.plannedExerciseId).toBe('p1');

    Object.assign(file.data.workouts[0]!, { deletedAt: ts });
    await svc.importAllData(file);
    expect(await repos.workouts.getById('w1')).toBeNull(); // tombstones survive an import

    Object.assign(file.data.workouts[0]!, { deletedAt: undefined, planChangeDecision: 'maybe' });
    await expect(svc.importAllData(file)).rejects.toThrow(/planChangeDecision/);
  });
});
