import { StyleSheet, View } from 'react-native';

import { colors, hit, stroke } from '../theme';

import { Icon } from './icons';
import { PressableScale } from './PressableScale';

interface MoveArrowsProps {
  /** Spoken name of the item ("Sentadilla trasera"). */
  name: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (delta: -1 | 1) => void;
}

const ARROWS_WIDTH = 48;

/** Stacked up/down buttons on the right edge of a reorderable row (Armar día, Reordenar). */
export function MoveArrows({ name, canMoveUp, canMoveDown, onMove }: MoveArrowsProps) {
  return (
    <View style={styles.arrows}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Subir ${name}`}
        accessibilityState={{ disabled: !canMoveUp }}
        disabled={!canMoveUp}
        onPress={() => onMove(-1)}
        style={[styles.arrow, !canMoveUp && styles.arrowOff]}
      >
        <Icon name="up" size={20} color="textBody" strokeWidth={2.4} />
      </PressableScale>
      <View style={styles.arrowDivider} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Bajar ${name}`}
        accessibilityState={{ disabled: !canMoveDown }}
        disabled={!canMoveDown}
        onPress={() => onMove(1)}
        style={[styles.arrow, !canMoveDown && styles.arrowOff]}
      >
        <Icon name="down" size={20} color="textBody" strokeWidth={2.4} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  arrows: {
    width: ARROWS_WIDTH,
    borderLeftWidth: stroke.hairline,
    borderLeftColor: colors.border,
  },
  arrow: { flex: 1, minHeight: hit.min, alignItems: 'center', justifyContent: 'center' },
  arrowOff: { opacity: 0.3 },
  arrowDivider: { height: stroke.hairline, backgroundColor: colors.border },
});
