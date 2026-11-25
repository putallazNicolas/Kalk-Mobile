import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { colors, elevation, motion, radii, space, stroke } from '../../theme';
import { Button } from '../Button';
import { Icon } from '../icons';
import { Text } from '../Text';

/** Rest bar height + its bottom margin + a gap: the card floats right above the timer. */
const ABOVE_REST_BAR = 68 + space.lg + space.md;

interface RestNotificationPromptProps {
  onEnable: () => void;
  onDismiss: () => void;
}

/**
 * Asked once, on the first rest (design/F1 4A, S6 §2 "RestNotificationPrompt", §6): a floating
 * card above the timer. What is behind is dimmed to 35 % but stays usable; the timer keeps running.
 */
export function RestNotificationPrompt({ onEnable, onDismiss }: RestNotificationPromptProps) {
  const reduced = useReducedMotion();
  const duration = reduced ? motion.reduced : motion.base;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        entering={FadeIn.duration(duration)}
        exiting={FadeOut.duration(duration)}
        style={[StyleSheet.absoluteFill, styles.scrim]}
        pointerEvents="none"
      />
      <Animated.View
        entering={FadeIn.duration(duration)}
        exiting={FadeOut.duration(duration)}
        style={styles.card}
        accessibilityViewIsModal={false}
        accessibilityLiveRegion="polite"
      >
        <View style={styles.head}>
          <View style={styles.icon}>
            <Icon name="clock" size={20} color="accent" />
          </View>
          <Text variant="bodyStrong" style={styles.title} accessibilityRole="header">
            ¿Te avisamos al terminar?
          </Text>
        </View>
        <Text variant="bodyS" color="textBody">
          Si bloqueás el teléfono o cambiás de app, te llega un aviso cuando termina el descanso. Lo
          podés apagar en Perfil.
        </Text>
        <View style={styles.actions}>
          <Button
            title="Ahora no"
            variant="ghost"
            onPress={onDismiss}
            fullWidth={false}
            style={styles.action}
          />
          <Button
            title="Activar aviso"
            onPress={onEnable}
            fullWidth={false}
            style={styles.action}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrimLight },
  card: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: ABOVE_REST_BAR,
    gap: space.sm + 2,
    padding: space.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceRaised,
    borderWidth: stroke.hairline,
    borderColor: colors.borderRaised,
    ...elevation.floating,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 },
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.accentMuted,
  },
  title: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
  action: { flexGrow: 1 },
});
