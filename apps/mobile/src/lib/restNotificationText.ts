/**
 * Texts of the end-of-rest notification (design/S6 §7). Pure: shared by the native module and
 * its web stand-in.
 */

/** What comes after the rest, for the notification body (S6 §7). */
export interface NextUp {
  exerciseName: string;
  /** 1-based number of the next set and the sets of that exercise; undefined when unknown. */
  setNumber?: number;
  totalSets?: number;
  /** The next set belongs to another exercise than the one just done. */
  newExercise: boolean;
}

export interface NotificationText {
  title: string;
  body: string;
}

/** The device language decides: English devices get the English text, everything else Spanish. */
export function deviceLanguage(): 'es' | 'en' {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.toLowerCase().startsWith('en') ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

/** Title and body of S6 §7: no exclamation marks, no emoji, the exercise name as in the app. */
export function restNotificationText(
  next: NextUp,
  lang: 'es' | 'en' = deviceLanguage(),
): NotificationText {
  const title = lang === 'en' ? 'Rest is over' : 'Descanso terminado';
  const prefix = lang === 'en' ? 'Back to the bar' : 'A la barra';
  const set = lang === 'en' ? 'set' : 'serie';
  const of = lang === 'en' ? 'of' : 'de';
  const { exerciseName, setNumber, totalSets, newExercise } = next;
  if (setNumber === undefined || totalSets === undefined) {
    return { title, body: `${prefix}: ${exerciseName}` };
  }
  if (newExercise) {
    return { title, body: `${prefix}: ${exerciseName}, ${set} ${setNumber} ${of} ${totalSets}` };
  }
  return { title, body: `${prefix}: ${set} ${setNumber} ${of} ${totalSets} · ${exerciseName}` };
}
