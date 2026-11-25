import { useLocalSearchParams } from 'expo-router';

import { ExerciseForm } from '../../components';

export default function NewExerciseScreen() {
  const { dayId, workoutId, afterOrder, name } = useLocalSearchParams<{
    dayId?: string;
    workoutId?: string;
    afterOrder?: string;
    name?: string;
  }>();
  return (
    <ExerciseForm dayId={dayId} workoutId={workoutId} afterOrder={afterOrder} initialName={name} />
  );
}
