import {
  plannedRepsForSet,
  plannedRepsToNumber,
  type PreviousPerformance,
  type RestNotificationState,
  type WeightUnit,
  type WorkoutDetail,
  type WorkoutExerciseDetail,
  type WorkoutSet,
} from '@gym/core';
import { useScreenAwake } from '../../lib/useScreenAwake';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Keyboard,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useRepositories, useServices } from '../../data/DataProvider';
import { attempt } from '../../lib/errors';
import { inputToKg, inputToReps, weightToInput } from '../../lib/format';
import { haptics } from '../../lib/haptics';
import { isFinishedExercise, moveId } from '../../lib/reorder';
import { restSecondsFor } from '../../lib/rest';
import { useNow } from '../../lib/useNow';
import { firstPendingId, prSetIds, workoutTotals } from '../../lib/workoutStats';
import { colors, radii, space, stroke } from '../../theme';
import { Button } from '../Button';
import { confirm } from '../ConfirmDialog';
import { ScreenContainer } from '../ScreenContainer';
import { ScreenHeader } from '../ScreenHeader';
import { Text } from '../Text';
import { UNDO_TOAST_MS } from '../Toast';
import { hideUndoToast, showUndoToast } from '../UndoToast';
import { AddExerciseButton, EmptyWorkout } from './EmptyWorkout';
import { ExerciseBlock, type ExerciseMode, type SetInput } from './ExerciseBlock';
import { ExerciseMenu } from './ExerciseMenu';
import { RestNotificationPrompt } from './RestNotificationPrompt';
import { RestTimerBar } from './RestTimerBar';
import { nextUpAfter, useRestNotification, type ActiveRest } from './useRestNotification';
import { WorkoutMenu } from './WorkoutMenu';
import { ProgressSegments, WorkoutStats } from './WorkoutProgress';

interface ActiveWorkoutProps {
  initial: WorkoutDetail;
  names: Record<string, string>;
  /** Exercise cues (Exercise.notes) by exercise id; only exercises that have them. */
  cues?: Record<string, string>;
  previous: Record<string, PreviousPerformance | null>;
  /** Historical best e1RM (kg) per exercise id, from finished workouts (for the live PR badge). */
  bests: Record<string, number>;
  routineName?: string;
  unit: WeightUnit;
  restTimerEnabled: boolean;
  /**
   * Exercises whose sets need the kg typed in before ✓ (lib/weightRule). Missing ids complete
   * without kg.
   */
  needsWeight?: Record<string, boolean>;
  /** Settings.restNotifications: the end-of-rest notification (design/S6 §6). */
  restNotifications: RestNotificationState;
  /** How long a removal waits for "Deshacer" before it is written (the toast's 5 s). */
  removalDelayMs?: number;
}

/**
 * A set or an exercise the person removed: it is already gone from the screen, but nothing is
 * written until the undo toast expires (the core cannot restore a row without losing its plan link).
 */
type PendingRemoval = { timer: ReturnType<typeof setTimeout> | null } & (
  | { kind: 'set'; set: WorkoutSet; exerciseId: string; index: number }
  | { kind: 'exercise'; exercise: WorkoutExerciseDetail; index: number; wasOpen: boolean }
);

/** Pause so the last row is seen turning green before the exercise folds (design/S3). */
const COLLAPSE_PAUSE_MS = 350;
/** Waits for the fold/unfold layout animation before scrolling to the next exercise. */
const SCROLL_DELAY_MS = 380;
const ADD_REST_SECONDS = 15;
/** Bottom padding of the list so the floating rest bar never covers the last rows. */
const REST_BAR_CLEARANCE = 140;

function buildInputs(workout: WorkoutDetail, unit: WeightUnit): Record<string, SetInput> {
  const out: Record<string, SetInput> = {};
  for (const e of workout.exercises)
    for (const s of e.sets)
      out[s.id] = {
        kg: weightToInput(s.weightKg, unit),
        reps: s.reps === undefined ? '' : String(s.reps),
      };
  return out;
}

let restCount = 0;
function restFrom(seconds: number, next: ActiveRest['next']): ActiveRest {
  restCount += 1;
  return { id: restCount, endsAt: Date.now() + seconds * 1000, total: seconds, next };
}

/** setIndex follows the position, as the repositories renumber it after a removal. */
function renumbered(sets: WorkoutSet[]): WorkoutSet[] {
  return sets.map((s, i) => (s.setIndex === i ? s : { ...s, setIndex: i }));
}

function patchSetIn(w: WorkoutDetail, setId: string, patch: Partial<WorkoutSet>): WorkoutDetail {
  return {
    ...w,
    exercises: w.exercises.map((e) => ({
      ...e,
      sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)),
    })),
  };
}

export function ActiveWorkout({
  initial,
  names,
  cues,
  previous,
  bests,
  routineName,
  unit,
  restTimerEnabled,
  restNotifications,
  needsWeight = {},
  removalDelayMs = UNDO_TOAST_MS,
}: ActiveWorkoutProps) {
  useScreenAwake();
  const repos = useRepositories();
  const services = useServices();
  const router = useRouter();
  const now = useNow();

  // The latest state also lives in refs: several ✓ taps can land before React re-renders or
  // before the previous save resolves, so every handler reads the refs, never a stale render.
  const [seed] = useState(() => ({
    inputs: buildInputs(initial, unit),
    expanded: firstPendingId(initial),
  }));
  const workoutRef = useRef(initial);
  const inputsRef = useRef(seed.inputs);
  const expandedRef = useRef<string | null>(seed.expanded);
  const [workout, setWorkoutState] = useState(initial);
  const [inputs, setInputsState] = useState(seed.inputs);
  const [expandedId, setExpandedState] = useState<string | null>(seed.expanded);
  const [rest, setRest] = useState<ActiveRest | null>(null);
  const restNotice = useRestNotification(rest, restNotifications, (next) => {
    void attempt(() => repos.settings.update({ restNotifications: next }));
  });
  const [menuId, setMenuId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [shake, setShake] = useState<{
    setId: string;
    n: number;
    field: 'kg' | 'reps';
  } | null>(null);

  const inputRefs = useRef(new Map<string, TextInputInstance>());
  const pendingFocus = useRef<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const blockY = useRef(new Map<string, number>());
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Saves run one after another, in tap order. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** The removal waiting for its "Deshacer" (only one: a new one writes the previous). */
  const pendingRemoval = useRef<PendingRemoval | null>(null);

  function mutateWorkout(fn: (w: WorkoutDetail) => WorkoutDetail) {
    workoutRef.current = fn(workoutRef.current);
    setWorkoutState(workoutRef.current);
  }
  function mutateInputs(setId: string, patch: Partial<SetInput>) {
    inputsRef.current = {
      ...inputsRef.current,
      [setId]: { kg: '', reps: '', ...inputsRef.current[setId], ...patch },
    };
    setInputsState(inputsRef.current);
  }
  function setExpanded(id: string | null) {
    expandedRef.current = id;
    setExpandedState(id);
  }
  function patchSet(setId: string, patch: Partial<WorkoutSet>) {
    mutateWorkout((w) => patchSetIn(w, setId, patch));
  }
  function patchExercise(id: string, fn: (e: WorkoutExerciseDetail) => WorkoutExerciseDetail) {
    mutateWorkout((w) => ({ ...w, exercises: w.exercises.map((e) => (e.id === id ? fn(e) : e)) }));
  }
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.current.then(job, job);
    queue.current = run.catch(() => undefined);
    return run;
  }

  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    [],
  );

  // Exercises added or reordered from another screen (picker, reorder sheet) arrive in `initial`
  // when the screen reloads on focus. Merge only the structure: the local sets, inputs and the
  // rest timer stay as they are.
  const incomingStructure = initial.exercises.map((e) => `${e.id}:${e.order}`).join(',');
  useEffect(() => {
    const local = workoutRef.current;
    if (local.exercises.map((e) => `${e.id}:${e.order}`).join(',') === incomingStructure) return;
    const mine = new Map(local.exercises.map((e) => [e.id, e]));
    // An exercise waiting for its "Deshacer" is still in the database but gone from the screen.
    const hidden = pendingRemoval.current?.kind === 'exercise' ? pendingRemoval.current : null;
    const incoming = initial.exercises.filter((e) => e.id !== hidden?.exercise.id);
    const added = incoming.filter((e) => !mine.has(e.id));
    mutateWorkout((w) => ({
      ...w,
      exercises: incoming.map((e) => {
        const current = mine.get(e.id);
        return current ? { ...current, order: e.order } : e;
      }),
    }));
    if (added.length > 0) {
      inputsRef.current = {
        ...buildInputs({ ...initial, exercises: added }, unit),
        ...inputsRef.current,
      };
      setInputsState(inputsRef.current);
      // Nothing open (e.g. the first exercise of a free workout, or everything done): open the
      // first one just added, which is what the person is about to do (design/S6 §1, decision 4).
      if (expandedRef.current === null) setExpanded(added[0]!.id);
    }
    // The open exercise was replaced (picker in replace mode): open what took its place.
    const open = expandedRef.current;
    if (open !== null && !incoming.some((e) => e.id === open))
      setExpanded(added[0]?.id ?? firstPendingId({ ...initial, exercises: incoming }));
    // Only a different structure should merge; the other values are read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingStructure]);

  function registerRef(key: string, el: TextInputInstance | null) {
    if (!el) {
      inputRefs.current.delete(key);
      return;
    }
    inputRefs.current.set(key, el);
    if (pendingFocus.current === key) {
      pendingFocus.current = null;
      el.focus();
    }
  }
  function focusKey(key: string) {
    const el = inputRefs.current.get(key);
    if (el) el.focus();
    else pendingFocus.current = key;
  }

  /** Persist the typed kg/reps of a set (called on blur). */
  function persist(setId: string) {
    const input = inputsRef.current[setId];
    // A removed set (waiting for its "Deshacer") is not saved again.
    const exists = workoutRef.current.exercises.some((e) => e.sets.some((s) => s.id === setId));
    if (!input || !exists) return Promise.resolve();
    const weightKg = inputToKg(input.kg, unit);
    const reps = inputToReps(input.reps);
    return enqueue(async () => {
      const updated = await attempt(() =>
        repos.workouts.updateSet(setId, { weightKg: weightKg ?? null, reps: reps ?? null }),
      );
      // A completed set keeps its optimistic values until completeSet resolves.
      const stillPending = workoutRef.current.exercises.some((e) =>
        e.sets.some((s) => s.id === setId && !s.completed),
      );
      if (updated && stillPending)
        patchSet(setId, { weightKg: updated.weightKg, reps: updated.reps });
    });
  }

  /** Saves every set whose typed values differ from what is stored (nothing is lost on exit). */
  async function flushAll() {
    const writes: Promise<unknown>[] = [];
    for (const ex of workoutRef.current.exercises)
      for (const s of ex.sets) {
        const input = inputsRef.current[s.id];
        if (!input) continue;
        const weightKg = inputToKg(input.kg, unit);
        const reps = inputToReps(input.reps);
        const sameWeight =
          weightKg === s.weightKg ||
          (weightKg !== undefined &&
            s.weightKg !== undefined &&
            Math.abs(weightKg - s.weightKg) < 0.001);
        if (sameWeight && reps === s.reps) continue;
        writes.push(persist(s.id));
      }
    await Promise.all(writes);
  }

  /** Folds the finished exercise and opens the next one (after a short pause). */
  function scheduleCollapse(exerciseId: string) {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    haptics.medium();
    collapseTimer.current = setTimeout(() => {
      collapseTimer.current = null;
      const w = workoutRef.current;
      const idx = w.exercises.findIndex((e) => e.id === exerciseId);
      const ex = w.exercises[idx];
      // Something was undone, or the person opened another exercise meanwhile: leave it.
      if (!ex || expandedRef.current !== exerciseId || ex.sets.some((s) => !s.completed)) return;
      const nextId = firstPendingId(w, idx);
      setExpanded(nextId);
      if (!nextId) return;
      // No keyboard here: the next exercise just opens with its first pending set framed.
      setTimeout(() => {
        const y = blockY.current.get(nextId);
        if (y !== undefined)
          scrollRef.current?.scrollTo({ y: Math.max(0, y - space.md), animated: true });
      }, SCROLL_DELAY_MS);
    }, COLLAPSE_PAUSE_MS);
  }

  function toggleComplete(setId: string) {
    const w = workoutRef.current;
    const exIndex = w.exercises.findIndex((e) => e.sets.some((s) => s.id === setId));
    const ex = w.exercises[exIndex];
    const setIdx = ex?.sets.findIndex((s) => s.id === setId) ?? -1;
    const set = ex?.sets[setIdx];
    if (!ex || !set) return;

    if (set.completed) {
      patchSet(setId, { completed: false, completedAt: undefined });
      void enqueue(async () => {
        const updated = await attempt(() => services.uncompleteSet(setId));
        if (!updated) patchSet(setId, { completed: true, completedAt: set.completedAt });
      });
      return;
    }

    const input = inputsRef.current[setId] ?? { kg: '', reps: '' };
    const weightKg = inputToKg(input.kg, unit);
    // Empty kg on a loaded exercise (dumbbells, barbell, machine…): not completed, the kg field
    // shakes and gets focus, the same as reps with nothing planned. Bodyweight completes as is.
    if (weightKg === undefined && needsWeight[ex.exerciseId]) {
      haptics.warning();
      setShake((s) => ({ setId, n: (s?.n ?? 0) + 1, field: 'kg' }));
      focusKey(`${setId}:kg`);
      return;
    }
    let reps = inputToReps(input.reps);
    if (reps === undefined) {
      // Empty reps: complete with this set's planned number ("10"); a range ("8-10") or AMRAP has
      // none, so the set is NOT completed: the reps field shakes, gets focus and a warning buzzes.
      const planned = plannedRepsToNumber(
        plannedRepsForSet(ex.plannedSetReps, setIdx) || ex.plannedReps,
      );
      if (planned === null) {
        haptics.warning();
        setShake((s) => ({ setId, n: (s?.n ?? 0) + 1, field: 'reps' }));
        focusKey(`${setId}:reps`);
        return;
      }
      reps = planned;
    }

    // Optimistic: the set is completed right now, before anything is saved.
    const completedAt = new Date().toISOString();
    patchSet(setId, { weightKg, reps, completed: true, completedAt });
    mutateInputs(setId, { reps: reps === undefined ? '' : String(reps) });

    // Carry the weight over to the next empty set so it is prefilled.
    const next = ex.sets[setIdx + 1];
    if (next && !next.completed && weightKg !== undefined && !inputsRef.current[next.id]?.kg) {
      mutateInputs(next.id, { kg: weightToInput(weightKg, unit) });
      patchSet(next.id, { weightKg });
      void enqueue(() => attempt(() => repos.workouts.updateSet(next.id, { weightKg })));
    }

    // Live PR: heavier e1RM than anything in the exercise's history.
    const after = workoutRef.current.exercises[exIndex];
    if (after && prSetIds(after, bests[ex.exerciseId] ?? 0).has(setId)) haptics.heavy();

    // Close the keyboard (its blur saves the typed values) so the rest bar is visible below.
    TextInput.State?.currentlyFocusedInput?.()?.blur(); // absent on web
    Keyboard.dismiss();

    // Every ✓ (also the last set) starts, or restarts, the rest. The next pending set only gets
    // the visual focus frame (focusSetId); its input is not focused.
    const restFor = restSecondsFor(ex);
    // "Sin descanso" (0) shows no bar, and drops a bar left over from the previous exercise.
    if (restTimerEnabled) {
      const started =
        restFor > 0 ? restFrom(restFor, nextUpAfter(workoutRef.current, ex.id, names)) : null;
      setRest(started);
      if (started) restNotice.restStarted(started.id);
    }

    if (!after?.sets.some((s) => !s.completed)) scheduleCollapse(ex.id);

    void enqueue(async () => {
      const updated = await attempt(() => services.completeSet(setId, { weightKg, reps }));
      if (updated) patchSet(setId, { weightKg: updated.weightKg, reps: updated.reps });
      else patchSet(setId, { completed: false, completedAt: undefined });
    });
  }

  async function addSet(ex: WorkoutExerciseDetail) {
    const created = await enqueue(() => attempt(() => repos.workouts.addSet(ex.id)));
    if (!created) return;
    patchExercise(ex.id, (e) => ({ ...e, sets: [...e.sets, created] }));
    mutateInputs(created.id, { kg: weightToInput(created.weightKg, unit), reps: '' });
    setExpanded(ex.id);
  }

  /** Puts a removed set or exercise back on the screen (undo, or the write failed). */
  function restoreLocal(p: PendingRemoval) {
    if (p.kind === 'set') {
      patchExercise(p.exerciseId, (e) => {
        const sets = [...e.sets];
        sets.splice(Math.min(p.index, sets.length), 0, p.set);
        return { ...e, sets: renumbered(sets) };
      });
      return;
    }
    mutateWorkout((w) => {
      const list = [...w.exercises];
      list.splice(Math.min(p.index, list.length), 0, p.exercise);
      return { ...w, exercises: list.map((e, i) => (e.order === i ? e : { ...e, order: i })) };
    });
    if (p.wasOpen) setExpanded(p.exercise.id);
  }

  /** Writes the removal to the database (timer, a newer removal, finishing, leaving). */
  function commitRemoval(p: PendingRemoval): Promise<void> {
    if (p.timer) clearTimeout(p.timer);
    if (pendingRemoval.current === p) pendingRemoval.current = null;
    return enqueue(async () => {
      const ok = await attempt(async () => {
        if (p.kind === 'set') await repos.workouts.removeSet(p.set.id);
        else await repos.workouts.removeWorkoutExercise(p.exercise.id);
        return true;
      });
      if (!ok) restoreLocal(p);
      // The database renumbers the exercises that stay.
      else if (p.kind === 'exercise')
        mutateWorkout((w) => ({
          ...w,
          exercises: w.exercises.map((e, i) => ({ ...e, order: i })),
        }));
    });
  }

  /** Writes the waiting removal right now (nothing is left behind when the screen is done). */
  function flushRemoval(): Promise<void> {
    const p = pendingRemoval.current;
    if (!p) return Promise.resolve();
    // Written before the toast expired: its "Deshacer" could no longer undo anything.
    hideUndoToast();
    return commitRemoval(p);
  }

  // Persist pending edits and removals when the app goes to the background, and the removal
  // that is still waiting for its "Deshacer" if the screen goes away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      void flushAll();
      void flushRemoval();
    });
    return () => {
      sub.remove();
      void flushRemoval();
    };
    // flushAll and flushRemoval only read refs and stable props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function undoRemoval(p: PendingRemoval) {
    // Already written (another removal, finishing, a sheet opened): nothing to undo.
    if (pendingRemoval.current !== p) return;
    if (p.timer) clearTimeout(p.timer);
    pendingRemoval.current = null;
    restoreLocal(p);
  }

  /** The row is already gone from the screen; the toast offers "Deshacer" and then it is written. */
  function beginRemoval(p: PendingRemoval, message: string) {
    const previous = pendingRemoval.current;
    if (previous) void commitRemoval(previous);
    pendingRemoval.current = p;
    p.timer = setTimeout(() => void commitRemoval(p), removalDelayMs);
    showUndoToast({ message, onUndo: () => undoRemoval(p) });
  }

  /** Swipe, or the "Quitar serie" accessibility action. The last set of an exercise removes the exercise. */
  function removeSet(setId: string) {
    const ex = workoutRef.current.exercises.find((e) => e.sets.some((s) => s.id === setId));
    const set = ex?.sets.find((s) => s.id === setId);
    if (!ex || !set) return;
    if (ex.sets.length === 1) {
      void removeExercise(ex);
      return;
    }
    const index = ex.sets.indexOf(set);
    patchExercise(ex.id, (e) => ({ ...e, sets: renumbered(e.sets.filter((s) => s.id !== setId)) }));
    // Removing the only pending set leaves the exercise finished: fold it like a ✓ would.
    const left = workoutRef.current.exercises.find((e) => e.id === ex.id);
    if (left && expandedRef.current === ex.id && !left.sets.some((s) => !s.completed))
      scheduleCollapse(ex.id);
    beginRemoval({ kind: 'set', set, exerciseId: ex.id, index, timer: null }, 'Serie quitada');
  }

  async function removeExercise(ex: WorkoutExerciseDetail) {
    const name = names[ex.exerciseId] ?? 'Ejercicio';
    const done = ex.sets.filter((s) => s.completed).length;
    if (done > 0) {
      const ok = await confirm({
        title: `¿Quitar ${name}?`,
        message: `${done === 1 ? 'Se pierde la serie que ya hiciste' : `Se pierden las ${done} series que ya hiciste`} de este ejercicio.`,
        confirmLabel: 'Quitar',
        cancelLabel: 'Cancelar',
        destructive: true,
      });
      if (!ok) return;
    }
    const index = workoutRef.current.exercises.findIndex((e) => e.id === ex.id);
    const current = workoutRef.current.exercises[index];
    if (!current) return;
    const wasOpen = expandedRef.current === ex.id;
    mutateWorkout((w) => ({ ...w, exercises: w.exercises.filter((e) => e.id !== ex.id) }));
    if (wasOpen) setExpanded(firstPendingId(workoutRef.current, index - 1));
    beginRemoval(
      { kind: 'exercise', exercise: current, index, wasOpen, timer: null },
      `${name} quitado`,
    );
  }

  /** Moves a pending exercise one place; finished ones stay on top like in the reorder sheet. */
  function moveExercise(ex: WorkoutExerciseDetail, delta: -1 | 1) {
    const list = workoutRef.current.exercises;
    const pending = list.filter((e) => !isFinishedExercise(e));
    const from = pending.findIndex((e) => e.id === ex.id);
    if (from < 0) return;
    const ordered = [
      ...list.filter(isFinishedExercise),
      ...moveId(
        pending.map((e) => e.id),
        from,
        delta,
      ).map((id) => pending.find((e) => e.id === id)!),
    ];
    mutateWorkout((w) => ({ ...w, exercises: ordered.map((e, i) => ({ ...e, order: i })) }));
    const ids = ordered.map((e) => e.id);
    // An exercise waiting for its "Deshacer" is still in the database: keep it where it was.
    const waiting = pendingRemoval.current?.kind === 'exercise' ? pendingRemoval.current : null;
    if (waiting) ids.splice(Math.min(waiting.index, ids.length), 0, waiting.exercise.id);
    void enqueue(() => attempt(() => repos.workouts.reorderWorkoutExercises(workout.id, ids)));
  }

  /** Opens the picker in single-select mode; the new exercise takes the place of this one. */
  async function replaceExercise(ex: WorkoutExerciseDetail) {
    const name = names[ex.exerciseId] ?? 'Ejercicio';
    const done = ex.sets.filter((s) => s.completed).length;
    if (done > 0) {
      const ok = await confirm({
        title: `¿Reemplazar ${name}?`,
        message: `${done === 1 ? 'Se pierde la serie que ya hiciste' : `Se pierden las ${done} series que ya hiciste`} de este ejercicio.`,
        confirmLabel: 'Reemplazar',
        cancelLabel: 'Cancelar',
        destructive: true,
      });
      if (!ok) return;
    }
    await flushRemoval();
    await flushAll();
    const current = workoutRef.current.exercises.find((e) => e.id === ex.id);
    if (!current) return;
    router.push({
      pathname: '/elegir-ejercicio',
      params: {
        workoutId: workoutRef.current.id,
        afterOrder: String(current.order),
        replaceId: current.id,
      },
    });
  }

  async function toggleSkip(ex: WorkoutExerciseDetail) {
    const skipped = !ex.skipped;
    const updated = await enqueue(() =>
      attempt(() => repos.workouts.updateWorkoutExercise(ex.id, { skipped })),
    );
    if (!updated) return;
    patchExercise(ex.id, (e) => ({ ...e, skipped }));
    if (skipped && expandedRef.current === ex.id) {
      const idx = workoutRef.current.exercises.findIndex((e) => e.id === ex.id);
      setExpanded(firstPendingId(workoutRef.current, idx));
    } else if (!skipped) {
      setExpanded(ex.id);
    }
  }

  /** Deletes the workout in progress for real (it never reached the history) and goes to Hoy. */
  async function discardNow() {
    await flushRemoval();
    await queue.current;
    const done = await attempt(async () => {
      await repos.workouts.discard(workoutRef.current.id);
      return true;
    });
    if (done) router.dismissAll();
  }

  async function discard() {
    const { doneSets } = workoutTotals(workoutRef.current);
    // Nothing completed: nothing to lose, discard right away.
    if (doneSets > 0) {
      const ok = await confirm({
        title: `¿Descartar ${workoutRef.current.name}?`,
        message: `${doneSets === 1 ? 'Se borra la serie' : `Se borran las ${doneSets} series`} que cargaste hoy y no queda en el historial.${workoutRef.current.kind === 'free' ? '' : ' La rutina no cambia.'}`,
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir',
        destructive: true,
      });
      if (!ok) return;
    }
    await discardNow();
  }

  /** The exercise in progress, or the next pending one: new exercises enter right after it. */
  function currentExercise(): WorkoutExerciseDetail | undefined {
    const list = workoutRef.current.exercises;
    return (
      list.find((e) => e.id === expandedRef.current && !e.skipped) ??
      list.find((e) => !e.skipped && e.sets.some((s) => !s.completed)) ??
      list[list.length - 1]
    );
  }

  async function addExercise() {
    await flushRemoval();
    await flushAll();
    const current = currentExercise();
    router.push({
      pathname: '/elegir-ejercicio',
      params: {
        workoutId: workoutRef.current.id,
        ...(current ? { afterOrder: String(current.order) } : {}),
      },
    });
  }

  async function reorderExercises() {
    await flushRemoval();
    await flushAll();
    router.push({
      pathname: '/reordenar/[workoutId]',
      params: { workoutId: workoutRef.current.id },
    });
  }

  async function finish() {
    // Nothing to save: offer to discard instead of keeping an empty workout in the history.
    if (workoutTotals(workoutRef.current).doneSets === 0) {
      const ok = await confirm({
        title: 'No hay nada para guardar',
        message: 'Todavía no completaste ninguna serie. ¿Lo descartamos o seguís entrenando?',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir',
        destructive: true,
      });
      if (ok) await discardNow();
      return;
    }
    const pending = workoutRef.current.exercises
      .filter((e) => !e.skipped)
      .reduce((n, e) => n + e.sets.filter((s) => !s.completed).length, 0);
    if (pending > 0) {
      const ok = await confirm({
        title: 'Finalizar entrenamiento',
        message: `Te quedan ${pending} ${pending === 1 ? 'serie' : 'series'} sin completar. ¿Finalizar igual?`,
        confirmLabel: 'Finalizar',
        cancelLabel: 'Seguir',
      });
      if (!ok) return;
    }
    setFinishing(true);
    // The removals are written first, so the totals and the summary's plan diff are right.
    await flushRemoval();
    await flushAll();
    await queue.current;
    const done = await attempt(() => services.finishWorkout(workoutRef.current.id));
    setFinishing(false);
    if (done)
      router.replace({
        pathname: '/resumen/[workoutId]',
        params: { workoutId: workoutRef.current.id },
      });
  }

  function addRest() {
    if (!rest) return;
    const endsAt = Math.max(Date.now(), rest.endsAt) + ADD_REST_SECONDS * 1000;
    setRest({
      ...rest,
      endsAt,
      total: Math.max(rest.total, Math.ceil((endsAt - Date.now()) / 1000)),
    });
  }

  const elapsed = (now - Date.parse(workout.startedAt)) / 1000;
  const menuExercise = workout.exercises.find((e) => e.id === menuId);
  // Finished exercises stay on top: only the others move, among themselves.
  const movable = workout.exercises.filter((e) => !isFinishedExercise(e));
  const menuPosition = movable.findIndex((e) => e.id === menuId);
  const totals = workoutTotals(workout);

  // Mode of every exercise: the open one, finished ones, the next pending one and the rest.
  const openIndex = workout.exercises.findIndex((e) => e.id === expandedId && !e.skipped);
  const collapsedPending = workout.exercises
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => !e.skipped && i !== openIndex && e.sets.some((s) => !s.completed));
  const nextId = (collapsedPending.find(({ i }) => i > openIndex) ?? collapsedPending[0])?.e.id;
  const openExercise = openIndex >= 0 ? workout.exercises[openIndex] : undefined;
  const focusSetId = openExercise?.sets.find((s) => !s.completed)?.id ?? null;
  const allDone =
    totals.totalSets > 0 &&
    totals.doneSets === totals.totalSets &&
    expandedId === null &&
    !finishing;

  function modeOf(e: WorkoutExerciseDetail): ExerciseMode {
    if (e.skipped) return 'skipped';
    if (e.id === expandedId) return 'expanded';
    if (!e.sets.some((s) => !s.completed) && e.sets.length > 0) return 'done';
    return e.id === nextId ? 'next' : 'later';
  }

  return (
    <ScreenContainer edges={['top', 'left', 'right', 'bottom']}>
      <ScreenHeader
        accent
        label={
          workout.kind === 'free'
            ? 'Entrenando · Libre'
            : routineName
              ? `Entrenando · ${routineName}`
              : 'Entrenando'
        }
        title={workout.name}
        right={
          <View style={styles.headerActions}>
            <WorkoutMenu
              workoutName={workout.name}
              completedSets={totals.doneSets}
              onAddExercise={addExercise}
              onReorder={reorderExercises}
              onDiscard={discard}
            />
            <Button
              title="Finalizar"
              // Grey while there is nothing to save (design/F1 1C); tapping it offers to discard.
              variant={totals.doneSets === 0 ? 'secondary' : 'outline'}
              size="sm"
              fullWidth={false}
              loading={finishing}
              onPress={finish}
            />
          </View>
        }
      />
      <View style={styles.strip}>
        <WorkoutStats
          elapsedSeconds={elapsed}
          doneSets={totals.doneSets}
          totalSets={totals.totalSets}
          volumeKg={totals.volumeKg}
          unit={unit}
        />
        <ProgressSegments workout={workout} focusSetId={focusSetId} />
      </View>
      <ScrollView
        ref={scrollRef}
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {workout.exercises.map((e, i) => (
          <ExerciseBlock
            key={e.id}
            exercise={e}
            name={names[e.exerciseId] ?? 'Ejercicio'}
            // AGREGADO only makes sense against a plan: in a free workout every exercise is added.
            added={workout.kind === 'routine' && e.origin === 'added'}
            position={i}
            count={workout.exercises.length}
            mode={modeOf(e)}
            previous={previous[e.exerciseId]}
            unit={unit}
            inputs={inputs}
            cues={cues?.[e.exerciseId]}
            shake={shake}
            prSets={prSetIds(e, bests[e.exerciseId] ?? 0)}
            focusSetId={e.id === expandedId ? focusSetId : null}
            onToggleExpand={() => {
              void flushAll();
              setExpanded(expandedRef.current === e.id ? null : e.id);
            }}
            onOpenMenu={() => setMenuId(e.id)}
            onAddSet={() => void addSet(e)}
            onRemoveSet={removeSet}
            onChangeKg={(id, t) => mutateInputs(id, { kg: t })}
            onChangeReps={(id, t) => mutateInputs(id, { reps: t })}
            onBlurSet={persist}
            onToggleComplete={toggleComplete}
            registerRef={registerRef}
            focusKey={focusKey}
            onBlockLayout={(y) => blockY.current.set(e.id, y)}
          />
        ))}
        {workout.exercises.length === 0 ? (
          <EmptyWorkout onAdd={addExercise} />
        ) : (
          <AddExerciseButton onPress={addExercise} />
        )}
        {allDone ? (
          <Animated.View entering={FadeInDown.duration(320)} style={styles.allDone}>
            <Text variant="label" color="success">
              Todas las series completas
            </Text>
            <Text variant="displayM">Buen laburo</Text>
            <Button
              title="Finalizar y ver resumen"
              size="lg"
              onPress={finish}
              style={styles.allDoneButton}
            />
          </Animated.View>
        ) : null}
      </ScrollView>
      {restNotice.promptVisible ? (
        <RestNotificationPrompt onEnable={restNotice.enable} onDismiss={restNotice.dismissPrompt} />
      ) : null}
      {rest ? (
        <RestTimerBar
          endsAt={rest.endsAt}
          totalSeconds={rest.total}
          onAddTime={addRest}
          onDismiss={() => setRest(null)}
        />
      ) : null}
      {menuExercise ? (
        <ExerciseMenu
          visible
          exerciseName={names[menuExercise.exerciseId] ?? 'Ejercicio'}
          skipped={menuExercise.skipped}
          canMoveUp={menuPosition > 0}
          canMoveDown={menuPosition >= 0 && menuPosition < movable.length - 1}
          onAddSet={() => void addSet(menuExercise)}
          onReplace={() => void replaceExercise(menuExercise)}
          onMoveUp={() => moveExercise(menuExercise, -1)}
          onMoveDown={() => moveExercise(menuExercise, 1)}
          onToggleSkip={() => void toggleSkip(menuExercise)}
          onRemove={() => void removeExercise(menuExercise)}
          onClose={() => setMenuId(null)}
        />
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: space.sm },
  strip: { gap: space.sm + 2, paddingBottom: space.md },
  content: { gap: space.sm, paddingBottom: REST_BAR_CLEARANCE },
  allDone: {
    marginTop: space.sm,
    alignItems: 'center',
    gap: space.xs + 2,
    padding: space.lg,
    paddingTop: space.xl,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: stroke.hairline,
    borderColor: colors.successBorder,
  },
  allDoneButton: { marginTop: space.md },
});
