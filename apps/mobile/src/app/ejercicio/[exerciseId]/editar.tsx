import { useLocalSearchParams } from 'expo-router';

import { ExerciseForm } from '../../../components';

export default function EditExerciseScreen() {
  const { exerciseId, dayId, workoutId, afterOrder } = useLocalSearchParams<{
    exerciseId: string;
    dayId?: string;
    workoutId?: string;
    afterOrder?: string;
  }>();
  return (
    <ExerciseForm
      exerciseId={exerciseId}
      dayId={dayId}
      workoutId={workoutId}
      afterOrder={afterOrder}
    />
  );
}
