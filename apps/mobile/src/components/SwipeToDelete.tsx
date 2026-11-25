import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { deleteAccessibility } from '../lib/deleteAccessibility';
import { colors, motion, radii, space } from '../theme';

import { Icon } from './icons';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** Width of the red action (design/S6: 88-96 pt). */
const ACTION_WIDTH = 96;
/** A release past this share of the screen width counts as a full swipe: it executes. */
const FULL_SWIPE_SHARE = 0.5;
/** Horizontal travel before the swipe takes over: a tap (or a finger roll on ✓) never gets here. */
export const SWIPE_ACTIVATE_X = 20;
/** Vertical travel that cancels the swipe before it starts: scrolling the list never swipes a row. */
export const SWIPE_FAIL_Y = 12;

interface SwipeToDeleteProps {
  children: ReactNode;
  /** Runs on a full swipe or a tap on the revealed action. The row closes first. */
  onDelete: () => void;
  /** "Eliminar" in the history, "Quitar" on sets. */
  actionLabel?: string;
  /** Corner radius of the row, so the red action matches it. */
  radius?: number;
  /** Lets tests drive the pan with react-native-gesture-handler's jest utils. */
  testID?: string;
}

export { deleteAccessibility };

/**
 * Swipe the row left to reveal a red action; releasing it past half the screen executes it
 * (design/S6 SwipeToDelete). Used by the history rows and the sets of Entrenando. Give the row
 * itself `deleteAccessibility(...)` as the alternative to the gesture, and an opaque background:
 * the action is only drawn while the row is moved, but nothing may show through a resting row.
 *
 * The decision is taken once, from where the finger is released: nothing is latched while
 * dragging, so a tap, a scroll or a short drag can never delete.
 */
export function SwipeToDelete({
  children,
  onDelete,
  actionLabel = 'Eliminar',
  radius = radii.lg - 2,
  testID,
}: SwipeToDeleteProps) {
  const { width } = useWindowDimensions();
  const fullAt = width * FULL_SWIPE_SHARE;
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  /** The action is revealed and tappable (React state: it drives pointer events and the overlay). */
  const [open, setOpen] = useState(false);

  function close() {
    offset.set(withSpring(0, motion.springSoft));
    setOpen(false);
  }

  function run() {
    close();
    onDelete();
  }

  const pan = usePanGesture({
    activeOffsetX: [-SWIPE_ACTIVATE_X, SWIPE_ACTIVATE_X],
    failOffsetY: [-SWIPE_FAIL_Y, SWIPE_FAIL_Y],
    testID,
    onActivate: () => {
      'worklet';
      start.set(offset.get());
    },
    onUpdate: (e) => {
      'worklet';
      // Only to the left: a drag to the right just closes it.
      offset.set(Math.min(0, start.get() + e.translationX));
    },
    onDeactivate: (e) => {
      'worklet';
      const x = Math.min(0, start.get() + e.translationX);
      if (!e.canceled && x < -fullAt) {
        scheduleOnRN(run);
      } else if (!e.canceled && x < -ACTION_WIDTH / 2) {
        offset.set(withSpring(-ACTION_WIDTH, motion.springSoft));
        scheduleOnRN(setOpen, true);
      } else {
        scheduleOnRN(close);
      }
    },
  });

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  // Red only where the row moved away, and nothing at all while it rests.
  const actionStyle = useAnimatedStyle(() => ({
    width: Math.max(ACTION_WIDTH, -offset.get()),
    opacity: offset.get() < 0 ? 1 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={[styles.container, { borderRadius: radius }]}>
        <Animated.View
          style={[styles.action, { borderRadius: radius }, actionStyle]}
          pointerEvents={open ? 'auto' : 'none'}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            onPress={run}
            style={styles.actionButton}
          >
            <Icon name="trash" size={18} color="onAccent" strokeWidth={2.2} />
            <Text variant="segment" color="onAccent">
              {actionLabel}
            </Text>
          </PressableScale>
        </Animated.View>
        <Animated.View style={rowStyle}>
          {children}
          {open ? (
            // While open, a tap on the row only closes it: it never reaches ✓ or the inputs.
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={close}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  action: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: colors.danger,
  },
  actionButton: {
    flex: 1,
    width: ACTION_WIDTH,
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs / 2,
  },
});
