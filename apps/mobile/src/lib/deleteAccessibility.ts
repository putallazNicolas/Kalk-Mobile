/** Props that give a row the same action to assistive tech (a swipe cannot be done with VoiceOver). */
export function deleteAccessibility(label: string, onDelete: () => void) {
  return {
    accessibilityActions: [{ name: 'delete', label }],
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'delete') onDelete();
    },
  };
}
