/**
 * Pure comparison of a routine workout against its planSnapshot (design/S6 §5). Shared by
 * `getPlanChanges` (what the card shows) and `applyPlanChanges` (what gets written).
 */
import type {
  ID,
  PlanChangeItem,
  PlanSnapshotItem,
  RoutineDayDetail,
  WorkoutDetail,
  WorkoutExerciseDetail,
  WorkoutSet,
} from '../contracts';

export interface PlanDiff {
  setsChanged: { plannedExerciseId: ID; exerciseId: ID; from: number; to: number }[];
  added: { workoutExerciseId: ID; exerciseId: ID; sets: number; reps: string }[];
  /** Planned exercises that were removed (or ended with no sets). */
  removed: { plannedExerciseId: ID; exerciseId: ID }[];
  reordered: boolean;
  /** What the day should end up with, in the workout's order. */
  finalOrder: { plannedExerciseId?: ID; workoutExerciseId: ID }[];
}

/** The most repeated reps among completed sets, "10" if there are none. Ties: the first seen. */
export function mostRepeatedReps(sets: WorkoutSet[]): string {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (s.completed && s.reps !== undefined && s.reps >= 1) {
      counts.set(s.reps, (counts.get(s.reps) ?? 0) + 1);
    }
  }
  let best: { reps: number; count: number } | undefined;
  for (const [reps, count] of counts) if (!best || count > best.count) best = { reps, count };
  return best ? String(best.reps) : '10';
}

const bySnapshotOrder = (a: PlanSnapshotItem, b: PlanSnapshotItem): number => a.order - b.order;

/** True when the day's planned exercises are exactly what the snapshot recorded. */
export function dayMatchesSnapshot(
  day: RoutineDayDetail | null,
  snapshot: PlanSnapshotItem[],
): boolean {
  if (!day || day.exercises.length !== snapshot.length) return false;
  const expected = [...snapshot].sort(bySnapshotOrder);
  const current = [...day.exercises].sort((a, b) => a.order - b.order);
  return expected.every((item, i) => {
    const p = current[i];
    return (
      p !== undefined &&
      p.id === item.plannedExerciseId &&
      p.exerciseId === item.exerciseId &&
      p.order === item.order &&
      p.plannedSets.length === item.sets
    );
  });
}

export function diffPlan(workout: WorkoutDetail, snapshot: PlanSnapshotItem[]): PlanDiff {
  const inSnapshot = new Set(snapshot.map((s) => s.plannedExerciseId));
  const planned = new Map<ID, WorkoutExerciseDetail>();
  const added: PlanDiff['added'] = [];
  const finalOrder: PlanDiff['finalOrder'] = [];
  for (const we of workout.exercises) {
    if (we.sets.length === 0) continue; // nothing left of it: a planned one counts as removed
    if (we.plannedExerciseId !== undefined && inSnapshot.has(we.plannedExerciseId)) {
      planned.set(we.plannedExerciseId, we);
      finalOrder.push({ plannedExerciseId: we.plannedExerciseId, workoutExerciseId: we.id });
    } else if (we.origin === 'added') {
      added.push({
        workoutExerciseId: we.id,
        exerciseId: we.exerciseId,
        sets: we.sets.length,
        reps: mostRepeatedReps(we.sets),
      });
      finalOrder.push({ workoutExerciseId: we.id });
    }
  }

  const ordered = [...snapshot].sort(bySnapshotOrder);
  const setsChanged = ordered.flatMap((item) => {
    const to = planned.get(item.plannedExerciseId)?.sets.length;
    return to !== undefined && to !== item.sets
      ? [
          {
            plannedExerciseId: item.plannedExerciseId,
            exerciseId: item.exerciseId,
            from: item.sets,
            to,
          },
        ]
      : [];
  });
  const removed = ordered
    .filter((i) => !planned.has(i.plannedExerciseId))
    .map((i) => ({ plannedExerciseId: i.plannedExerciseId, exerciseId: i.exerciseId }));

  const keptInSnapshot = ordered.map((i) => i.plannedExerciseId).filter((id) => planned.has(id));
  const keptInWorkout = finalOrder.flatMap((f) =>
    f.plannedExerciseId ? [f.plannedExerciseId] : [],
  );
  const reordered = keptInSnapshot.some((id, i) => id !== keptInWorkout[i]);

  return { setsChanged, added, removed, reordered, finalOrder };
}

export function hasChanges(diff: PlanDiff): boolean {
  return (
    diff.setsChanged.length > 0 ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.reordered
  );
}

/** The card's lines, in S6's order: sets, added, removed, order. */
export function planChangeItems(
  diff: PlanDiff,
  nameOf: (exerciseId: ID) => string,
): PlanChangeItem[] {
  return [
    ...diff.setsChanged.map((c): PlanChangeItem => ({
      kind: 'setsChanged',
      plannedExerciseId: c.plannedExerciseId,
      exerciseName: nameOf(c.exerciseId),
      from: c.from,
      to: c.to,
    })),
    ...diff.added.map((a): PlanChangeItem => ({
      kind: 'added',
      exerciseId: a.exerciseId,
      exerciseName: nameOf(a.exerciseId),
      sets: a.sets,
      reps: a.reps,
    })),
    ...diff.removed.map((r): PlanChangeItem => ({
      kind: 'removed',
      plannedExerciseId: r.plannedExerciseId,
      exerciseName: nameOf(r.exerciseId),
    })),
    ...(diff.reordered ? [{ kind: 'reordered' } as const] : []),
  ];
}
