import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { colors, hit, radii, space, stroke } from '../../theme';
import { Button } from '../Button';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';
import { Icon } from '../icons';

/** A small empty barbell (design/F1 2C): the drawing of P02 at 220 × 60, without plates. */
function SmallBarbell() {
  return (
    <Svg width={220} height={60} viewBox="0 0 320 110" accessibilityElementsHidden>
      <Rect x={8} y={49} width={80} height={12} rx={3} fill={colors.border} />
      <Rect x={232} y={49} width={80} height={12} rx={3} fill={colors.border} />
      <Rect x={86} y={43} width={8} height={24} rx={2} fill={colors.borderStrong} />
      <Rect x={226} y={43} width={8} height={24} rx={2} fill={colors.borderStrong} />
      <Rect x={94} y={52} width={132} height={6} rx={3} fill={colors.textDisabled} />
    </Svg>
  );
}

/** Entrenando of a free workout without exercises yet (design/F1 2C, S6 §2 "EmptyWorkout"). */
export function EmptyWorkout({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.card}>
      <SmallBarbell />
      <Text variant="displayM" style={styles.title}>
        Sumá el primer ejercicio
      </Text>
      <Text variant="bodyS" color="textBody" style={styles.message}>
        Lo elegís de la lista y vas agregando series a medida que entrenás. El tiempo ya corre.
      </Text>
      <Button title="Agregar ejercicio" size="lg" icon="add" onPress={onAdd} style={styles.cta} />
    </View>
  );
}

/** Dashed "Agregar ejercicio" at the end of the list (design/F1 2D, 3B; S6 §2). */
export function AddExerciseButton({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Agregar ejercicio"
      onPress={onPress}
      style={styles.dashed}
    >
      <Icon name="add" size={18} color="textBody" strokeWidth={2.6} />
      <Text variant="buttonM" color="textBody">
        Agregar ejercicio
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: space.xs,
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xxl + 4,
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    borderRadius: radii.xxl,
    borderWidth: stroke.regular,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  title: { marginTop: 6, textAlign: 'center' },
  message: { maxWidth: 290, textAlign: 'center' },
  cta: { alignSelf: 'stretch', marginTop: space.md },
  dashed: {
    minHeight: hit.row,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radii.lg,
    borderWidth: stroke.regular,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
