import { useLocalSearchParams } from 'expo-router';

import { ExerciseForm } from '../../components';

export default function NewExerciseScreen() {
  const { dayId, workoutId, afterOrder, replaceId, name } = useLocalSearchParams<{
    dayId?: string;
    workoutId?: string;
    afterOrder?: string;
    replaceId?: string;
    name?: string;
  }>();
  return (
    <ExerciseForm
      dayId={dayId}
      workoutId={workoutId}
      afterOrder={afterOrder}
      replaceId={replaceId}
      initialName={name}
    />
  );
}
