import type { RestNotificationState } from '@gym/core';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  readNotificationDiagnostics,
  requestNotificationPermission,
  scheduleTestNotification,
  type NotificationDiagnostics,
} from '../lib/restNotifications';
import { colors, radii, space, stroke } from '../theme';

import { Button } from './Button';
import { Text } from './Text';

/** UNNotificationSettings.authorizationStatus, by number (expo-notifications IosAuthorizationStatus). */
const IOS_STATUS = ['no preguntado', 'negado', 'autorizado', 'provisorio', 'efímero'];

interface RestNotificationDiagnosticsProps {
  saved: RestNotificationState;
  restTimerEnabled: boolean;
}

function line(label: string, value: unknown) {
  return `${label}: ${value === undefined ? '—' : String(value)}`;
}

/**
 * Hidden diagnostics of the end-of-rest notification (Perfil, below its switch): a long press on
 * the version in "Acerca de Kalk" shows it; always shown while developing. Says whether a
 * missing notification is the permission, the scheduling or iOS (docs/PROGRESS.md explains it).
 */
export function RestNotificationDiagnostics({
  saved,
  restTimerEnabled,
}: RestNotificationDiagnosticsProps) {
  const [info, setInfo] = useState<NotificationDiagnostics | null>(null);
  const [test, setTest] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void readNotificationDiagnostics().then(setInfo);
  }, []);
  useFocusEffect(refresh);

  async function tryIt() {
    let status = info?.permission?.status;
    if (status === 'undetermined') {
      status = (await requestNotificationPermission()) ? 'granted' : 'denied';
    }
    const id = await scheduleTestNotification();
    setTest(
      id === null
        ? 'No se pudo programar (mirá «Último error»).'
        : status === 'granted'
          ? 'Programado. Bloqueá el teléfono ya: llega en 5 s.'
          : 'Programado, pero sin permiso de iOS no va a llegar.',
    );
    refresh();
  }

  const permission = info?.permission;
  const ios = permission?.ios as Record<string, unknown> | undefined;
  const iosStatus = typeof ios?.status === 'number' ? IOS_STATUS[ios.status] : undefined;

  return (
    <View style={styles.card} accessibilityLabel="Diagnóstico del aviso de descanso">
      <Text variant="label">Diagnóstico del aviso</Text>
      <Text variant="caption" color="textBody" selectable>
        {[
          line('Guardado en la app', saved),
          line('Temporizador de descanso', restTimerEnabled ? 'prendido' : 'apagado'),
          line('Permiso', permission?.status),
          line('Permiso concedido', permission?.granted),
          line('Se puede volver a pedir', permission?.canAskAgain),
          line('iOS status', iosStatus ? `${String(ios?.status)} (${iosStatus})` : ios?.status),
          line('iOS allowsAlert', ios?.allowsAlert),
          line('iOS allowsSound', ios?.allowsSound),
          line('iOS pantalla bloqueada', ios?.allowsDisplayOnLockScreen),
          line('iOS centro de notificaciones', ios?.allowsDisplayInNotificationCenter),
          line('Programadas ahora', info?.scheduled),
          line('Último error', info?.lastError ?? 'ninguno'),
        ].join('\n')}
      </Text>
      {test ? (
        <Text variant="caption" color="accent">
          {test}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button title="Actualizar" variant="ghost" size="sm" fullWidth={false} onPress={refresh} />
        <Button
          title="Probar aviso en 5 s"
          variant="secondary"
          size="sm"
          fullWidth={false}
          onPress={() => void tryIt()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: stroke.hairline,
    borderColor: colors.border,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
