import type { PlanChangeDecision, PlanChangeItem, PlanChanges } from '@gym/core';
import { StyleSheet, View } from 'react-native';

import { colors, hit, radii, space, stroke } from '../../theme';
import { Button } from '../Button';
import { Text } from '../Text';

interface PlanChangesCardProps {
  changes: PlanChanges;
  /** What the owner answered (now or on an earlier visit); replaces the buttons. */
  decision?: PlanChangeDecision;
  busy?: boolean;
  onApply: () => void;
  onKeep: () => void;
}

/** One line of the list: a sign box and the text (design/F1 3E, F1b). */
function lineOf(item: PlanChangeItem): { sign: string; text: string } {
  switch (item.kind) {
    case 'setsChanged':
      return {
        sign: item.to > item.from ? '+' : '−',
        text: `${item.exerciseName}: ${item.from} → ${item.to} series`,
      };
    case 'added':
      return { sign: '+', text: `${item.exerciseName}, ${item.sets} × ${item.reps}` };
    case 'removed':
      return { sign: '−', text: item.exerciseName };
    case 'reordered':
      return { sign: '↕', text: 'Cambió el orden de los ejercicios' };
  }
}

function decisionText(decision: PlanChangeDecision, dayName: string): string {
  return decision === 'applied'
    ? `Listo: ${dayName} queda con estos cambios desde el próximo entreno.`
    : 'La rutina queda igual. Los cambios quedan solo en este entreno.';
}

/**
 * "Cambiaste el plan de <día>" (design/S6 PlanChangesCard, F1 3E variant B): the structural changes
 * of a routine workout and the choice to update the routine. Nothing changes unless "Actualizar".
 * Renders nothing when there is nothing to say.
 */
export function PlanChangesCard({
  changes,
  decision,
  busy = false,
  onApply,
  onKeep,
}: PlanChangesCardProps) {
  const dayName = changes.dayName ?? 'la rutina';
  const answered = decision ?? changes.decision;

  if (changes.status === 'none') return null;

  if (changes.status === 'routineChanged')
    return (
      <View style={styles.card}>
        <Text variant="bodyS" color="textBody">
          La rutina cambió mientras entrenabas. Editala en Rutinas
        </Text>
      </View>
    );

  if (changes.status === 'decided' || answered) {
    if (!answered) return null;
    return (
      <View style={styles.card}>
        <Text variant="bodyS" color="textBody">
          {decisionText(answered, dayName)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text variant="label" color="accent">
        Cambiaste el plan de {dayName}
      </Text>
      {changes.items.map((item, i) => {
        const { sign, text } = lineOf(item);
        return (
          <View key={`${item.kind}-${i}`} style={styles.line}>
            <View style={styles.sign}>
              <Text variant="numMd">{sign}</Text>
            </View>
            <Text variant="bodyM" style={styles.lineText}>
              {text}
            </Text>
          </View>
        );
      })}
      <View style={styles.actions}>
        <Button
          title={`Actualizar ${dayName}`}
          variant="secondary"
          loading={busy}
          onPress={onApply}
          style={styles.apply}
        />
        <Button title="Dejar la rutina como está" variant="ghost" size="sm" onPress={onKeep} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm + 2,
    padding: space.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderWidth: stroke.regular,
    borderColor: colors.borderStrong,
  },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 },
  sign: {
    width: 22,
    height: 22,
    borderRadius: radii.badge,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.border,
  },
  lineText: { flex: 1 },
  actions: { gap: space.xs + 2, marginTop: space.xs },
  apply: { minHeight: hit.row - space.xs },
});
