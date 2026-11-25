import { useLocalSearchParams } from 'expo-router';

import { ExerciseForm } from '../../../components';

export default function EditExerciseScreen() {
  const { exerciseId, dayId, workoutId, afterOrder, replaceId } = useLocalSearchParams<{
    exerciseId: string;
    dayId?: string;
    workoutId?: string;
    afterOrder?: string;
    replaceId?: string;
  }>();
  return (
    <ExerciseForm
      exerciseId={exerciseId}
      dayId={dayId}
      workoutId={workoutId}
      afterOrder={afterOrder}
      replaceId={replaceId}
    />
  );
}
