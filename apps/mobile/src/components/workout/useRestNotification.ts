import type { RestNotificationState, WorkoutDetail } from '@gym/core';
import { useEffect, useRef, useState } from 'react';

import {
  cancelRestEnd,
  getNotificationPermission,
  requestNotificationPermission,
  restNotificationsSupported,
  scheduleRestEnd,
  type NextUp,
} from '../../lib/restNotifications';

/** A running rest. `id` changes with each new rest, not with "+15 s". */
export interface ActiveRest {
  id: number;
  endsAt: number;
  total: number;
  /** What the notification announces; null when nothing is left to do. */
  next: NextUp | null;
}

/**
 * The set that follows the one just completed in `exerciseId`: the next pending set of the same
 * exercise, else the first pending set of the exercise that opens next (same order as the
 * automatic fold: the ones below, then the ones above).
 */
export function nextUpAfter(
  workout: WorkoutDetail,
  exerciseId: string,
  names: Record<string, string>,
): NextUp | null {
  const list = workout.exercises;
  const idx = list.findIndex((e) => e.id === exerciseId);
  const ordered = [...list.slice(idx), ...list.slice(0, Math.max(idx, 0))];
  for (const e of ordered) {
    if (e.skipped) continue;
    const pending = e.sets.findIndex((s) => !s.completed);
    if (pending < 0) continue;
    return {
      exerciseName: names[e.exerciseId] ?? 'Ejercicio',
      setNumber: pending + 1,
      totalSets: e.sets.length,
      newExercise: e.id !== exerciseId,
    };
  }
  return null;
}

/**
 * End-of-rest notification for Entrenando (design/S6 §6). Every new rest (and every "+15 s")
 * cancels the previous notification and schedules a new one; closing the timer, starting the next
 * rest, finishing or discarding (the screen unmounts) cancels it. With `'unasked'`, the first rest
 * of the workout shows the prompt card; its answer is saved and not asked again in Entrenando.
 */
export function useRestNotification(
  rest: ActiveRest | null,
  saved: RestNotificationState,
  save: (next: RestNotificationState) => void,
) {
  // The answer given here wins over the value loaded with the screen.
  const [answered, setAnswered] = useState<RestNotificationState | null>(null);
  const mode = answered ?? saved;
  const [promptRestId, setPromptRestId] = useState<number | null>(null);
  const prompted = useRef(false);

  useEffect(() => {
    if (!rest?.next || mode !== 'on') return;
    const next = rest.next;
    let cancelled = false;
    let id: string | null = null;
    void (async () => {
      // The permission is read every time: it can be turned off in iOS settings at any moment.
      if ((await getNotificationPermission()) !== 'granted' || cancelled) return;
      const scheduled = await scheduleRestEnd(Math.ceil((rest.endsAt - Date.now()) / 1000), next);
      if (cancelled) void cancelRestEnd(scheduled);
      else id = scheduled;
    })();
    return () => {
      cancelled = true;
      void cancelRestEnd(id);
    };
  }, [rest, mode]);

  /** Called when a rest starts: the first one of the workout may ask (S6 §1). */
  function restStarted(restId: number) {
    if (!restNotificationsSupported || mode !== 'unasked' || prompted.current) return;
    prompted.current = true;
    setPromptRestId(restId);
  }

  function answer(next: RestNotificationState) {
    setPromptRestId(null);
    setAnswered(next);
    save(next);
  }

  async function enable() {
    setPromptRestId(null);
    answer((await requestNotificationPermission()) ? 'on' : 'off');
  }

  return {
    /** The card belongs to the first rest only: it goes away with it. */
    promptVisible: rest !== null && rest.id === promptRestId,
    restStarted,
    enable: () => void enable(),
    dismissPrompt: () => answer('off'),
  };
}
