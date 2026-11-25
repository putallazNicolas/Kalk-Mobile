import type { DeletionImpactRecord, DomainServices, Repositories, WeightUnit } from '@gym/core';

import { confirm, showUndoToast, type ConfirmImpact } from '../components';
import { attempt } from './errors';
import { formatNumber, formatWeekdayShort, formatWeight, kgToUnit } from './format';
import { bumpHistoryVersion } from './historyVersion';

/**
 * The impact box of the delete dialog (design/S6 §4): what each record goes back to.
 * Undefined when the workout had no records (no box).
 */
export function buildImpact(
  records: DeletionImpactRecord[],
  unit: WeightUnit,
): ConfirmImpact | undefined {
  const [only] = records;
  if (!only) return undefined;
  if (records.length > 1)
    return {
      heading: 'Récords',
      lead: `Tenía ${records.length} récords: vuelven a los anteriores.`,
    };
  if (!only.previous)
    return {
      heading: 'Tenía 1 récord',
      lead: `${only.exerciseName} se queda sin récord: no hay un entrenamiento anterior.`,
    };
  const { weightKg, reps, e1rmKg } = only.previous;
  return {
    heading: 'Tenía 1 récord',
    lead: `${only.exerciseName} vuelve a su récord anterior:`,
    emphasis: `${formatNumber(kgToUnit(weightKg, unit))} × ${reps}`,
    tail: `(e1RM ${formatWeight(e1rmKg, unit)}).`,
  };
}

interface DeleteContext {
  repos: Repositories;
  services: DomainServices;
  unit: WeightUnit;
}

/**
 * Deletes a finished workout the way design/S6 §1 chose: a dialog that says what is lost (and what
 * happens to the records), then a soft delete and a 5 s "Deshacer". Resolves true when deleted.
 */
export async function deleteFinishedWorkout(
  { repos, services, unit }: DeleteContext,
  workoutId: string,
): Promise<boolean> {
  const info = await attempt(async () => ({
    summary: await services.getWorkoutSummary(workoutId),
    impact: await services.getDeletionImpact(workoutId),
  }));
  if (!info) return false;
  const { workout, completedSets } = info.summary;
  const started = new Date(workout.startedAt);
  const ok = await confirm({
    title: `¿Eliminar ${workout.name} del ${formatWeekdayShort(started).toLowerCase()} ${started.getDate()}?`,
    message:
      completedSets === 1
        ? 'Se borra su serie del historial y del progreso.'
        : `Se borran sus ${completedSets} series del historial y del progreso.`,
    impact: buildImpact(info.impact, unit),
    confirmLabel: 'Eliminar',
    destructive: true,
  });
  if (!ok) return false;
  const done = await attempt(async () => {
    await repos.workouts.softDelete(workoutId);
    return true;
  });
  if (!done) return false;
  bumpHistoryVersion();
  showUndoToast({
    message: `${workout.name} eliminado`,
    onUndo: () => {
      void attempt(() => repos.workouts.restore(workoutId)).then(bumpHistoryVersion);
    },
  });
  return true;
}
