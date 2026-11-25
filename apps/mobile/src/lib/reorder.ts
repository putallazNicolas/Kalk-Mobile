/** Returns ids with the element at `index` moved by `delta` (-1 up, +1 down); same array if out of range. */
export function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const target = index + delta;
  if (target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return ids;
  next[index] = b;
  next[target] = a;
  return next;
}

/** An exercise with every set done: it stays on top and cannot move (reorder sheet, exercise menu). */
export function isFinishedExercise(e: { sets: { completed: boolean }[] }): boolean {
  return e.sets.length > 0 && e.sets.every((s) => s.completed);
}
