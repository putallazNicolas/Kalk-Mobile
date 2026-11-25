import { describe, expect, it, jest } from '@jest/globals';

import { restNotificationText } from './restNotifications';

jest.mock('expo-notifications', () => ({}));

describe('rest notification texts (design/S6 §7)', () => {
  it('same exercise: the set first', () => {
    expect(
      restNotificationText(
        { exerciseName: 'Sentadilla trasera', setNumber: 3, totalSets: 4, newExercise: false },
        'es',
      ),
    ).toEqual({
      title: 'Descanso terminado',
      body: 'A la barra: serie 3 de 4 · Sentadilla trasera',
    });
  });

  it('a new exercise: its name first', () => {
    expect(
      restNotificationText(
        { exerciseName: 'Peso muerto rumano', setNumber: 1, totalSets: 4, newExercise: true },
        'es',
      ).body,
    ).toBe('A la barra: Peso muerto rumano, serie 1 de 4');
  });

  it('free workout without a next set: only the exercise', () => {
    expect(restNotificationText({ exerciseName: 'Dominadas', newExercise: false }, 'es').body).toBe(
      'A la barra: Dominadas',
    );
  });

  it('English', () => {
    expect(
      restNotificationText(
        { exerciseName: 'Back squat', setNumber: 3, totalSets: 4, newExercise: false },
        'en',
      ),
    ).toEqual({ title: 'Rest is over', body: 'Back to the bar: set 3 of 4 · Back squat' });
    expect(
      restNotificationText(
        { exerciseName: 'Romanian deadlift', setNumber: 1, totalSets: 4, newExercise: true },
        'en',
      ).body,
    ).toBe('Back to the bar: Romanian deadlift, set 1 of 4');
  });
});
