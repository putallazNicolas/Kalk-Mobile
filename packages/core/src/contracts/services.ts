/**
 * Domain services (V1 contract). Owned by the orchestrator.
 *
 * Services are pure orchestration on top of `Repositories`: they never touch storage directly,
 * so they work identically with the in-memory and the SQLite implementations.
 * Created with `createDomainServices(repos, options)`.
 */
import type {
  Exercise,
  ID,
  ISODateString,
  PlanChangeDecision,
  Routine,
  Workout,
  WorkoutSet,
} from './entities';
import type { DataSnapshot, Repositories, RoutineDayDetail, WorkoutDetail } from './repositories';

export interface ServiceOptions {
  /** Injectable clock for tests. Defaults to () => new Date(). */
  now?: () => Date;
}

export interface SuggestedDay {
  routine: Routine;
  day: RoutineDayDetail;
  /** Exercises of the day, in order (for the "Entrenamiento de hoy" card). */
  exercises: Exercise[];
}

export interface PreviousSet {
  setIndex: number;
  weightKg?: number;
  reps?: number;
}

export interface PreviousPerformance {
  workoutId: ID;
  date: ISODateString;
  /** Completed sets of the last session that included the exercise, by setIndex. */
  sets: PreviousSet[];
}

export interface BestSet {
  weightKg: number;
  reps: number;
  /** Epley estimate of this set. */
  e1rmKg: number;
}

export type PersonalRecordType = 'weight' | 'e1rm';

export interface PersonalRecord {
  exerciseId: ID;
  exerciseName: string;
  type: PersonalRecordType;
  /** New best, in kg. */
  valueKg: number;
  /** Previous best in kg, undefined if this is the first time the exercise is logged. */
  previousKg?: number;
}

export interface WorkoutSummaryExercise {
  workoutExerciseId: ID;
  exerciseId: ID;
  exerciseName: string;
  completedSets: number;
  totalSets: number;
  volumeKg: number;
  skipped: boolean;
  /** Completed set with the highest e1RM (ties: heavier weight). Undefined if none. */
  bestSet?: BestSet;
}

export interface WorkoutSummary {
  workout: Workout;
  /** finishedAt - startedAt (or now - startedAt while in progress), in whole seconds. */
  durationSeconds: number;
  completedSets: number;
  totalSets: number;
  /** Σ weightKg × reps over completed sets with both values. */
  volumeKg: number;
  /** Exercises with at least one completed set. */
  exerciseCount: number;
  exercises: WorkoutSummaryExercise[];
  /**
   * PRs set in this workout vs. all workouts that started before it. Only reported when
   * there is a previous history for that exercise (first session is not a "PR").
   */
  personalRecords: PersonalRecord[];
}

export interface WorkoutListItem {
  workout: Workout;
  durationSeconds: number;
  volumeKg: number;
  completedSets: number;
}

export interface ExerciseProgressPoint {
  workoutId: ID;
  date: ISODateString;
  bestWeightKg: number;
  bestE1rmKg: number;
  volumeKg: number;
  /** Completed sets of that session, for the history list. */
  sets: WorkoutSet[];
}

export interface WeeklyStat {
  /** Monday 00:00 local time of that week, ISO string. */
  weekStart: ISODateString;
  workouts: number;
  volumeKg: number;
}

export const EXPORT_FORMAT = 'gym-app-export';
/**
 * v2 (Ajustes UX): PlannedExercise has repsMode + plannedSets instead of sets + reps; WorkoutExercise
 * has plannedSetReps; Exercise has updatedAt and optional secondaryMuscleGroups / notes / archived.
 * v3 (Flexibilidad): Workout has kind, name (was dayNameSnapshot), planSnapshot,
 * planChangeDecision; WorkoutExercise has origin + plannedExerciseId; WorkoutSet has source;
 * Settings has restNotifications. Soft-deleted workouts are not exported.
 * importAllData still accepts v1 and v2 files and converts them.
 */
export const EXPORT_VERSION = 3;

export interface ExportPayload {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: ISODateString;
  /** App version that produced the file (informational). */
  appVersion?: string;
  data: DataSnapshot;
}

/** One structural change of a routine workout against its planSnapshot (design/S6 §5). */
export type PlanChangeItem =
  | { kind: 'added'; exerciseId: ID; exerciseName: string; sets: number; reps: string }
  | { kind: 'removed'; plannedExerciseId: ID; exerciseName: string }
  | { kind: 'setsChanged'; plannedExerciseId: ID; exerciseName: string; from: number; to: number }
  | { kind: 'reordered' };

/**
 * What the "Actualizar <día>" card of the summary shows:
 * - "none": no structural change (or not a routine workout, or no planSnapshot): no card.
 * - "changed": `items` lists the changes; the card offers to update the routine.
 * - "routineChanged": the routine day was edited (or deleted) while training: the card only says
 *   "La rutina cambió mientras entrenabas. Editala en Rutinas".
 * - "decided": already answered (`decision`).
 */
export interface PlanChanges {
  status: 'none' | 'changed' | 'routineChanged' | 'decided';
  dayName?: string;
  items: PlanChangeItem[];
  decision?: PlanChangeDecision;
}

/** A record of the workout being deleted and the best it goes back to (design/S6 §4). */
export interface DeletionImpactRecord {
  exerciseId: ID;
  exerciseName: string;
  /** The best set excluding that workout; undefined if there was no earlier history. */
  previous?: BestSet;
}

export interface ImportResult {
  exercises: number;
  routines: number;
  workouts: number;
}

export interface DomainServices {
  /**
   * Creates a workout from a routine day: one WorkoutExercise per planned exercise (snapshotting
   * plannedSets count, a summary in plannedReps and plannedSetReps) and one WorkoutSet per planned set. Each set's weightKg is prefilled from the previous performance
   * of that exercise (same setIndex, else the last previous set); reps are left empty.
   * Rejects with ValidationError if another workout is in progress.
   */
  startWorkoutFromDay(dayId: ID): Promise<WorkoutDetail>;
  /**
   * Starts an empty free workout (kind "free", name FREE_WORKOUT_DEFAULT_NAME). Rejects with
   * ValidationError if another workout is in progress. A free workout never advances the
   * suggested day of the routine.
   */
  startFreeWorkout(): Promise<WorkoutDetail>;
  /**
   * Adds exercises to a workout in progress right after the current one (`afterOrder`, end when
   * undefined): origin "added", 3 sets prefilled from the previous performance, plan "10".
   */
  addExercisesToWorkout(
    workoutId: ID,
    exerciseIds: ID[],
    options?: { afterOrder?: number },
  ): Promise<WorkoutDetail>;
  /**
   * Day after the one of the last finished workout of the active routine (wrapping around).
   * First day if the routine was never trained or that day no longer exists.
   * null if there is no active routine or it has no days.
   */
  getSuggestedNextDay(): Promise<SuggestedDay | null>;
  /** Last finished session of the exercise (excluding `excludeWorkoutId`). */
  getPreviousPerformance(
    exerciseId: ID,
    options?: { excludeWorkoutId?: ID },
  ): Promise<PreviousPerformance | null>;
  /** Saves values and marks the set completed (completedAt = now). */
  completeSet(setId: ID, values: { weightKg?: number; reps?: number }): Promise<WorkoutSet>;
  /** Marks a set as not completed again (keeps values). */
  uncompleteSet(setId: ID): Promise<WorkoutSet>;
  /**
   * Sets finishedAt = now (and notes, if given). A free workout still named
   * FREE_WORKOUT_DEFAULT_NAME gets "Libre · <group>" or "Libre · <group> y <group>" from the muscle
   * regions with the most completed sets (Piernas, Pecho, Espalda, Hombros, Brazos, Core…).
   */
  finishWorkout(workoutId: ID, options?: { notes?: string }): Promise<Workout>;
  /** Structural changes of a finished routine workout against its planSnapshot. */
  getPlanChanges(workoutId: ID): Promise<PlanChanges>;
  /**
   * "Actualizar <día>": applies the changes to the routine day in one transaction (set counts,
   * added and removed exercises, order; kg, reps and rest untouched) and stores decision
   * "applied". ValidationError unless getPlanChanges is "changed".
   */
  applyPlanChanges(workoutId: ID): Promise<void>;
  /** "Dejar la rutina como está": stores decision "kept". */
  keepPlan(workoutId: ID): Promise<void>;
  /** Records set in a finished workout and what each goes back to if it is deleted. */
  getDeletionImpact(workoutId: ID): Promise<DeletionImpactRecord[]>;
  getWorkoutSummary(workoutId: ID): Promise<WorkoutSummary>;
  /** Last finished workouts with their stats, most recent first. */
  getRecentWorkouts(limit: number): Promise<WorkoutListItem[]>;
  /** One point per finished session including the exercise, oldest first. */
  getExerciseProgress(exerciseId: ID): Promise<ExerciseProgressPoint[]>;
  /** Last `weeks` weeks including the current one, oldest first (empty weeks included). */
  getWeeklyStats(weeks: number): Promise<WeeklyStat[]>;
  exportAllData(options?: { appVersion?: string }): Promise<ExportPayload>;
  /**
   * Validates and replaces all data with the payload. Rejects with ValidationError on an
   * unknown format or a newer version. Older versions are migrated.
   */
  importAllData(payload: unknown): Promise<ImportResult>;
}

/** Shape of the factory implemented in packages/core/src/services. */
export type CreateDomainServices = (
  repos: Repositories,
  options?: ServiceOptions,
) => DomainServices;
