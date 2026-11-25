import { ActionSheet, type ActionSheetItem } from '../ActionSheet';

interface ExerciseMenuProps {
  visible: boolean;
  exerciseName: string;
  skipped: boolean;
  /** Finished exercises stay on top, so they cannot move. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAddSet: () => void;
  onReplace: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleSkip: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Menu of one exercise of Entrenando (design/S6 ExerciseMenu, F1 3A): opened by the ⋯ of the open
 * card and by a long press on the other rows. The destructive action goes last.
 */
export function ExerciseMenu({
  visible,
  exerciseName,
  skipped,
  canMoveUp,
  canMoveDown,
  onAddSet,
  onReplace,
  onMoveUp,
  onMoveDown,
  onToggleSkip,
  onRemove,
  onClose,
}: ExerciseMenuProps) {
  const items: ActionSheetItem[] = [
    { label: 'Agregar serie', icon: 'add', onPress: onAddSet },
    { label: 'Reemplazar ejercicio', icon: 'replace', onPress: onReplace },
    ...(canMoveUp ? [{ label: 'Mover arriba', icon: 'up', onPress: onMoveUp } as const] : []),
    ...(canMoveDown ? [{ label: 'Mover abajo', icon: 'down', onPress: onMoveDown } as const] : []),
    {
      label: skipped ? 'Reactivar ejercicio' : 'Saltar ejercicio',
      icon: skipped ? 'play' : 'chevron',
      onPress: onToggleSkip,
    },
    { label: 'Quitar ejercicio', icon: 'trash', destructive: true, onPress: onRemove },
  ];
  return (
    <ActionSheet
      visible={visible}
      label={`Ejercicio · ${exerciseName}`}
      items={items}
      onClose={onClose}
    />
  );
}
