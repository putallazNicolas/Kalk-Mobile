import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { colors, hit, radii, stroke } from '../../theme';
import { ActionSheet } from '../ActionSheet';
import { Icon } from '../icons';
import { PressableScale } from '../PressableScale';

interface WorkoutMenuProps {
  workoutName: string;
  /** Completed sets: shown next to "Descartar entrenamiento" so it is clear what is lost. */
  completedSets: number;
  onAddExercise: () => void;
  onReorder: () => void;
  onDiscard: () => void;
}

/**
 * The ⋯ of Entrenando (design/S6 WorkoutMenu, F1 1A): a 44 pt button with a strong border that
 * opens Agregar ejercicio · Reordenar ejercicios · Descartar entrenamiento.
 */
export function WorkoutMenu({
  workoutName,
  completedSets,
  onAddExercise,
  onReorder,
  onDiscard,
}: WorkoutMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Opciones del entrenamiento"
        onPress={() => setOpen(true)}
        style={styles.button}
      >
        <Icon name="more" size={20} color="textPrimary" />
      </PressableScale>
      <ActionSheet
        visible={open}
        label={`Entrenamiento · ${workoutName}`}
        onClose={() => setOpen(false)}
        items={[
          { label: 'Agregar ejercicio', icon: 'add', onPress: onAddExercise },
          { label: 'Reordenar ejercicios', icon: 'reorder', onPress: onReorder },
          {
            label: 'Descartar entrenamiento',
            icon: 'trash',
            destructive: true,
            detail:
              completedSets > 0
                ? `${completedSets} ${completedSets === 1 ? 'serie' : 'series'}`
                : undefined,
            onPress: onDiscard,
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: hit.min,
    height: hit.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: stroke.regular,
    borderColor: colors.borderStrong,
  },
});
