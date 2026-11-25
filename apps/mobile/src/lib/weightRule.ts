import type { Equipment, Exercise } from '@gym/core';

/** Equipment whose sets are meaningless without a load. */
const LOADED: ReadonlySet<Equipment> = new Set([
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
]);

/**
 * Whether ✓ needs the kg typed in (design/S4: an empty field is not completed, the same as reps
 * with nothing planned). Bodyweight, bands, "other", cardio and exercises without equipment
 * complete without kg: their load is optional (a weighted pull-up still records its kg).
 */
export function needsWeight(exercise: Pick<Exercise, 'equipment' | 'muscleGroup'>): boolean {
  if (exercise.muscleGroup === 'cardio' || exercise.equipment === undefined) return false;
  return LOADED.has(exercise.equipment);
}
