import type { WorkoutDetail } from '@gym/core';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';

import {
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  MoveArrows,
  SheetHeader,
  Text,
} from '../../components';
import { useRepositories } from '../../data/DataProvider';
import { useFocusAsync } from '../../data/useFocusAsync';
import { attempt } from '../../lib/errors';
import { isFinishedExercise, moveId } from '../../lib/reorder';
import { colors, motion, radii, space, stroke } from '../../theme';

interface Loaded {
  workout: WorkoutDetail;
  names: Map<string, string>;
}

/**
 * Reorder sheet of Entrenando (design/S6 ReorderSheet, F1 3C): the exercises with ↑/↓ like Armar
 * día. Finished ones stay on top, locked. Every move is saved at once.
 */
export default function ReorderSheet() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const repos = useRepositories();
  const reduced = useReducedMotion();
  const { data, loading, error, reload } = useFocusAsync<Loaded | null>(async () => {
    const workout = await repos.workouts.getById(workoutId);
    if (!workout) return null;
    const exercises = await repos.exercises.getByIds(workout.exercises.map((e) => e.exerciseId));
    return { workout, names: new Map(exercises.map((e) => [e.id, e.name])) };
  }, [workoutId]);

  let body: React.ReactNode;
  if (loading && data === undefined) body = <LoadingState />;
  else if (error && data === undefined)
    body = <ErrorState message="No pudimos cargar los ejercicios." onRetry={reload} />;
  else if (!data) body = <EmptyState title="Entrenamiento no encontrado" />;
  else {
    const { workout, names } = data;
    const finished = workout.exercises.filter(isFinishedExercise);
    const pending = workout.exercises.filter((e) => !isFinishedExercise(e));
    const pendingIds = pending.map((e) => e.id);

    const move = async (index: number, delta: -1 | 1) => {
      const next = moveId(pendingIds, index, delta);
      await attempt(() =>
        repos.workouts.reorderWorkoutExercises(workout.id, [...finished.map((e) => e.id), ...next]),
      );
      reload();
    };

    body = (
      <>
        <SheetHeader
          eyebrow={`Entrenamiento · ${workout.name}`}
          title="Reordenar ejercicios"
          subtitle="Los que ya terminaste quedan arriba"
        />
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {finished.map((e) => (
            <View key={e.id} style={[styles.row, styles.rowLocked]}>
              <View style={styles.position}>
                <Icon name="check" size={16} color="success" />
              </View>
              <View style={styles.text}>
                <Text variant="rowName" color="textSecondary" numberOfLines={1}>
                  {names.get(e.exerciseId) ?? 'Ejercicio'}
                </Text>
                <Text variant="caption">Terminado</Text>
              </View>
            </View>
          ))}
          {pending.map((e, i) => {
            const name = names.get(e.exerciseId) ?? 'Ejercicio';
            const done = e.sets.filter((s) => s.completed).length;
            return (
              <Animated.View
                key={e.id}
                layout={reduced ? undefined : LinearTransition.duration(motion.base + 20)}
                style={styles.row}
              >
                <Text variant="numRow" color="accent" style={styles.position}>
                  {finished.length + i + 1}
                </Text>
                <View style={styles.text}>
                  <Text variant="rowName" numberOfLines={1}>
                    {name}
                  </Text>
                  <Text variant="caption">
                    {`${done}/${e.sets.length} ${e.sets.length === 1 ? 'serie' : 'series'}`}
                  </Text>
                </View>
                <MoveArrows
                  name={name}
                  canMoveUp={i > 0}
                  canMoveDown={i < pending.length - 1}
                  onMove={(delta) => move(i, delta)}
                />
              </Animated.View>
            );
          })}
        </ScrollView>
      </>
    );
  }
  return <View style={styles.sheet}>{body}</View>;
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.surfaceRaised },
  list: { gap: space.sm + 2, paddingHorizontal: space.lg, paddingBottom: space.xxxl },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: stroke.hairline,
    borderColor: colors.border,
  },
  rowLocked: { opacity: 0.7 },
  position: { width: 40, alignSelf: 'center', textAlign: 'center', alignItems: 'center' },
  text: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 2, paddingVertical: space.sm + 2 },
});
