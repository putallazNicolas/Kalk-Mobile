import { StyleSheet, View } from 'react-native';

import { colors, radii, space, stroke } from '../../theme';
import { Icon } from '../icons';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

const ROW_HEIGHT = 60;
const ICON_BOX = 36;

/** "Entreno libre" below the day card in Hoy (design/F1 2A, S6 §2 "FreeWorkoutRow"). */
export function FreeWorkoutRow({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Entreno libre"
      accessibilityHint="Empieza un entrenamiento sin rutina"
      onPress={onPress}
      scaleTo={0.99}
      style={styles.row}
    >
      <View style={styles.icon}>
        <Icon name="add" size={18} color="textPrimary" strokeWidth={2.6} />
      </View>
      <View style={styles.texts}>
        <Text variant="bodyStrong">Entreno libre</Text>
        <Text variant="caption" color="textSecondary">
          Sin rutina: sumás los ejercicios sobre la marcha
        </Text>
      </View>
      <Icon name="chevron" size={18} color="textDisabled" strokeWidth={2.4} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md + 2,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: stroke.hairline,
    borderColor: colors.border,
  },
  icon: {
    width: ICON_BOX,
    height: ICON_BOX,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: stroke.hairline,
    borderColor: colors.borderStrong,
  },
  texts: { flex: 1, gap: 1 },
});
