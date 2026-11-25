import { StyleSheet, View } from 'react-native';

import { colors, radii, stroke } from '../theme';

import { Text } from './Text';

/**
 * Gray information tag (design/S6 §2 "Tag AGREGADO / LIBRE"): same shape as the PROPIO tag but
 * neutral, because it is information, not an action.
 */
export function InfoTag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text variant="tagSmall" color="textBody">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radii.badge,
    borderWidth: stroke.hairline,
    borderColor: colors.textDisabled,
  },
});
