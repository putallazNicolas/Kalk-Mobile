import { describe, expect, it } from '@jest/globals';
import type { WorkoutDetail, WorkoutExerciseDetail, WorkoutSet } from '@gym/core';

import { sessionSummary } from './workoutStats';

function set(weightKg: number | undefined, reps: number, completed = true): WorkoutSet {
  return { weightKg, reps, completed } as WorkoutSet;
}
function exercise(sets: WorkoutSet[], skipped = false): WorkoutExerciseDetail {
  return { sets, skipped } as WorkoutExerciseDetail;
}
function workout(exercises: WorkoutExerciseDetail[]): WorkoutDetail {
  return { exercises } as WorkoutDetail;
}

describe('sessionSummary ("Sesión completa")', () => {
  it('exercises, sets and volume in the person unit', () => {
    const w = workout([
      exercise([set(100, 10), set(100, 10), set(100, 8)]),
      exercise([set(60, 12), set(60, 12)]),
      exercise([set(20, 10)], true),
    ]);
    expect(sessionSummary(w, 'kg')).toBe('2 ejercicios · 5 series · 4.240 kg');
    expect(sessionSummary(w, 'lb')).toBe('2 ejercicios · 5 series · 9.348 lb');
  });

  it('singular, and no volume when it is 0', () => {
    expect(sessionSummary(workout([exercise([set(undefined, 8)])]), 'kg')).toBe(
      '1 ejercicio · 1 serie',
    );
  });

  it('only exercises with a completed set count', () => {
    const w = workout([exercise([set(50, 5)]), exercise([set(50, 5, false)])]);
    expect(sessionSummary(w, 'kg')).toBe('1 ejercicio · 1 serie · 250 kg');
  });
});
