import { useRef, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useAnimatedReaction, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { colors, radii, space } from '../theme';

import { Icon } from './icons';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** Width of the red action (design/S6: 88-96 pt). */
const ACTION_WIDTH = 96;
/** A drag past this share of the screen width counts as a full swipe: it executes. */
const FULL_SWIPE_SHARE = 0.5;

interface SwipeToDeleteProps {
  children: ReactNode;
  /** Runs on a full swipe or a tap on the revealed action. The row closes first. */
  onDelete: () => void;
  /** "Eliminar" in the history, "Quitar" on sets. */
  actionLabel?: string;
  /** Corner radius of the row, so the red action matches it. */
  radius?: number;
}

/** Props that give a row the same action to assistive tech (a swipe cannot be done with VoiceOver). */
export function deleteAccessibility(label: string, onDelete: () => void) {
  return {
    accessibilityActions: [{ name: 'delete', label }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'delete') onDelete();
    },
  };
}

function DeleteAction({
  label,
  translation,
  fullAt,
  armed,
  onPress,
}: {
  label: string;
  translation: SharedValue<number>;
  fullAt: number;
  armed: SharedValue<boolean>;
  onPress: () => void;
}) {
  // Latched while the finger is past the full-swipe line; read when the row is released.
  useAnimatedReaction(
    () => translation.get() < -fullAt,
    (past) => armed.set(past),
  );
  return (
    <View
      style={styles.action}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={styles.actionButton}
      >
        <Icon name="trash" size={18} color="onAccent" strokeWidth={2.2} />
        <Text variant="segment" color="onAccent">
          {label}
        </Text>
      </PressableScale>
    </View>
  );
}

/**
 * Swipe the row left to reveal a red action; dragging all the way executes it (design/S6
 * SwipeToDelete). Reusable for the history and, later, for sets. Give the row itself
 * `deleteAccessibility(...)` as the alternative to the gesture.
 */
export function SwipeToDelete({
  children,
  onDelete,
  actionLabel = 'Eliminar',
  radius = radii.lg - 2,
}: SwipeToDeleteProps) {
  const ref = useRef<SwipeableMethods>(null);
  const armed = useSharedValue(false);
  const { width } = useWindowDimensions();
  const fullAt = width * FULL_SWIPE_SHARE;

  function run() {
    ref.current?.close();
    onDelete();
  }

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1}
      overshootRight
      dragOffsetFromRight={-space.md}
      containerStyle={[styles.container, { borderRadius: radius }]}
      onSwipeableWillOpen={() => {
        if (armed.get()) run();
      }}
      renderRightActions={(_progress, translation) => (
        <DeleteAction
          label={actionLabel}
          translation={translation}
          fullAt={fullAt}
          armed={armed}
          onPress={run}
        />
      )}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.danger },
  action: { width: ACTION_WIDTH },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs / 2,
  },
});
