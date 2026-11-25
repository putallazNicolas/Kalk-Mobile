import { StyleSheet, View } from 'react-native';
import { colors, radii, space, stroke } from '../../theme';
import { Button } from '../Button';
import { EmptyBarbell } from '../EmptyBarbell';
import { Text } from '../Text';

interface HomeEmptyProps {
  onCreateRoutine: () => void;
  /** "Entreno libre, sin rutina" (design/F1 2B): trains without having built anything. */
  onFreeWorkout: () => void;
  onImport: () => void;
}

const STEPS = [
  'Creá una rutina y ponele nombre',
  'Sumá días y ejercicios con series y reps',
  'Empezá y cargá cada serie con un toque',
];

/**
 * Hoy without routines (design/P02, F1 2B, L5 option 1): empty barbell, CTA, free workout, import and the 3-step list.
 * The title and the line are in the Hoy headline ("PRIMER PASO · Armá tu rutina").
 */
export function HomeEmpty({ onCreateRoutine, onFreeWorkout, onImport }: HomeEmptyProps) {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <EmptyBarbell />
        <View style={styles.actions}>
          <Button title="Armá tu primera rutina" size="lg" icon="add" onPress={onCreateRoutine} />
          <Button title="Entreno libre, sin rutina" variant="secondary" onPress={onFreeWorkout} />
          <Button title="Importar datos" variant="ghost" size="sm" onPress={onImport} />
        </View>
      </View>
      <View>
        {STEPS.map((step, i) => (
          <View key={step} style={[styles.step, i < STEPS.length - 1 && styles.stepBorder]}>
            <Text variant="displayM" color={i === 0 ? 'accent' : 'textTertiary'} style={styles.n}>
              {i + 1}
            </Text>
            <Text variant="bodyM" color={i === 0 ? 'textPrimary' : 'textBody'}>
              {step}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xxl },
  card: {
    alignItems: 'center',
    paddingTop: space.xl + 2,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    borderRadius: radii.xxl,
    backgroundColor: colors.surface,
    borderWidth: stroke.hairline,
    borderColor: colors.border,
  },
  /** The title and the line now live in the Hoy headline (design/L5): 18 pt to the CTA. */
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.lg + 2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md + 2, minHeight: 52 },
  stepBorder: { borderBottomWidth: stroke.hairline, borderBottomColor: colors.divider },
  n: { width: 28 },
});
