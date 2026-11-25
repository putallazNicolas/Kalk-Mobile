import { StyleSheet } from 'react-native';

import { colors, hit, radii, space, stroke } from '../../theme';
import { Icon } from '../icons';
import { PressableScale } from '../PressableScale';
import { Text } from '../Text';

/** Dashed "+ Serie" at the foot of the open exercise card (design/S6 AddSetButton, F1 3B). */
export function AddSetButton({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="Agregar serie"
      onPress={onPress}
      style={styles.button}
    >
      <Icon name="add" size={18} color="textBody" strokeWidth={2.6} />
      <Text variant="buttonS" color="textBody">
        Serie
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: hit.min,
    marginTop: space.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    borderRadius: radii.md,
    borderWidth: stroke.regular,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
});
