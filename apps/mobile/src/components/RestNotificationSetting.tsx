import type { RestNotificationState } from '@gym/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { haptics } from '../lib/haptics';
import {
  getNotificationPermission,
  openNotificationSettings,
  requestNotificationPermission,
  restNotificationsSupported,
  type NotificationPermission,
} from '../lib/restNotifications';
import { colors, hit, radii, space, stroke } from '../theme';

import { Button } from './Button';
import { Switch } from './Switch';
import { Text } from './Text';

interface RestNotificationSettingProps {
  value: RestNotificationState;
  onChange: (next: RestNotificationState) => void;
  /** Without the rest timer there is no rest to announce: the caption says so. */
  restTimerEnabled?: boolean;
}

/**
 * "Aviso de fin de descanso" in Perfil (design/F1 4C, S6 §2 "SettingRow", §6). The iOS permission
 * is read every time Perfil gains focus; if it was denied, the switch becomes "Abrir Ajustes".
 * Hidden on the web preview, which has no local notifications.
 */
export function RestNotificationSetting({
  value,
  onChange,
  restTimerEnabled = true,
}: RestNotificationSettingProps) {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void getNotificationPermission().then((p) => {
        if (alive) setPermission(p);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!restNotificationsSupported) return null;

  const denied = permission === 'denied';

  async function toggle(on: boolean) {
    haptics.light();
    if (!on) {
      onChange('off');
      return;
    }
    const granted = permission === 'granted' || (await requestNotificationPermission());
    setPermission(granted ? 'granted' : 'denied');
    onChange(granted ? 'on' : 'off');
  }

  return (
    <View style={styles.card}>
      <View style={styles.texts}>
        <Text variant="bodyStrong">Aviso de fin de descanso</Text>
        <Text variant="caption" color="textSecondary">
          {denied
            ? 'Las notificaciones de Kalk están apagadas en Ajustes de iOS.'
            : !restTimerEnabled
              ? 'Necesita el temporizador de descanso prendido: sin temporizador no hay descanso que avisar.'
              : 'Una notificación cuando termina el descanso, si el teléfono está bloqueado o en otra app.'}
        </Text>
      </View>
      {denied ? (
        <Button
          title="Abrir Ajustes"
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={openNotificationSettings}
        />
      ) : (
        <Switch
          accessibilityLabel="Aviso de fin de descanso"
          value={value === 'on' && permission === 'granted'}
          onValueChange={(on) => void toggle(on)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: hit.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: stroke.hairline,
    borderColor: colors.border,
  },
  texts: { flex: 1, gap: 2 },
});
