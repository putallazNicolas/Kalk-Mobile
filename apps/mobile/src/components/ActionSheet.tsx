import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, hit, motion, radii, space, stroke } from '../theme';

import { Icon, type IconName } from './icons';
import { Text } from './Text';

export interface ActionSheetItem {
  label: string;
  icon: IconName;
  onPress: () => void;
  /** Quiet text on the right ("6 series"). */
  detail?: string;
  /** Danger color, and a rule above it. Keep it last. */
  destructive?: boolean;
}

interface ActionSheetProps {
  visible: boolean;
  /** Small uppercase line on top ("Entrenamiento · Piernas A"). */
  label: string;
  items: ActionSheetItem[];
  /** Quiet line under the rows. */
  note?: string;
  onClose: () => void;
}

/** How far the sheet travels while it enters. */
const SLIDE_FROM = 360;
const HANDLE_WIDTH = 36;
const HANDLE_HEIGHT = 5;

/**
 * Bottom sheet of actions (design/S6 §2, F1 1A): a label on top and 52 pt rows with an icon.
 * The destructive action goes last, in danger, under a rule.
 */
export function ActionSheet({ visible, label, items, note, onClose }: ActionSheetProps) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: reduced ? motion.reduced : motion.base,
      easing: motion.easeOut,
    });
  }, [visible, progress, reduced]);

  const scrim = useAnimatedStyle(() => ({ opacity: progress.value }));
  const sheet = useAnimatedStyle(() => ({
    opacity: reduced ? progress.value : 1,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * SLIDE_FROM }],
  }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="Cerrar"
            onPress={onClose}
          />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }, sheet]}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <Text variant="label" style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          {items.map((item) => {
            const tint = item.destructive ? 'danger' : 'textPrimary';
            return (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                accessibilityLabel={item.detail ? `${item.label}, ${item.detail}` : item.label}
                style={({ pressed }) => [
                  styles.row,
                  item.destructive && styles.rowDestructive,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              >
                <Icon name={item.icon} size={20} color={tint} strokeWidth={2.2} />
                <Text variant="bodyStrong" color={tint} style={styles.rowLabel}>
                  {item.label}
                </Text>
                {item.detail ? (
                  <Text variant="caption" color="textTertiary">
                    {item.detail}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
          {note ? (
            <Text variant="caption" color="textTertiary" style={styles.note}>
              {note}
            </Text>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    paddingTop: space.sm,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: stroke.hairline,
    borderTopColor: colors.borderRaised,
  },
  handle: {
    alignSelf: 'center',
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    marginBottom: space.sm + 2,
    borderRadius: radii.xs + 1,
    backgroundColor: colors.borderStrong,
  },
  label: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  row: {
    minHeight: hit.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md + 2,
    paddingHorizontal: space.lg,
  },
  rowDestructive: { borderTopWidth: stroke.hairline, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.border },
  rowLabel: { flex: 1 },
  note: { paddingHorizontal: space.lg, paddingTop: space.sm },
});
