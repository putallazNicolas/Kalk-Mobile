import {
  FREE_WORKOUT_DEFAULT_NAME,
  type Exercise,
  type ID,
  type MuscleGroup,
  type WorkoutDetail,
} from '../contracts';

export const MUSCLE_REGIONS = [
  'Piernas',
  'Pecho',
  'Espalda',
  'Hombros',
  'Brazos',
  'Core',
  'Cuerpo completo',
  'Cardio',
] as const;
export type MuscleRegion = (typeof MUSCLE_REGIONS)[number];

const REGION_OF: Record<MuscleGroup, MuscleRegion> = {
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

/** The coarse region a muscle group belongs to, as shown in the name of a free workout. */
export function muscleRegionOf(group: MuscleGroup): MuscleRegion {
  return REGION_OF[group];
}

/**
 * "Libre · <región>" or "Libre · <región> y <región>" from the (up to) two regions with the most
 * completed sets; ties go to the region that shows up first in the workout. No completed sets
 * keeps FREE_WORKOUT_DEFAULT_NAME.
 */
export function freeWorkoutName(workout: WorkoutDetail, catalog: Map<ID, Exercise>): string {
  const completed = new Map<MuscleRegion, number>();
  for (const we of workout.exercises) {
    const group = catalog.get(we.exerciseId)?.muscleGroup;
    if (!group) continue;
    const region = muscleRegionOf(group);
    const done = we.sets.filter((s) => s.completed).length;
    completed.set(region, (completed.get(region) ?? 0) + done);
  }
  const top = [...completed.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]) // stable: ties keep their order of first appearance
    .slice(0, 2)
    .map(([region]) => region);
  return top.length === 0 ? FREE_WORKOUT_DEFAULT_NAME : `Libre · ${top.join(' y ')}`;
}
