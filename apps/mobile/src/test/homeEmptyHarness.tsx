import { HomeEmpty } from '../components/home/HomeEmpty';

/** HomeEmpty with no-op actions, for tests. */
export default function HomeEmptyHarness() {
  return (
    <HomeEmpty
      onCreateRoutine={() => undefined}
      onFreeWorkout={() => undefined}
      onImport={() => undefined}
    />
  );
}
