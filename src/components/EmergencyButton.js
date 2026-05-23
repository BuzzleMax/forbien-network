import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function EmergencyButton({ onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="National Emergency Button"
      onPress={onPress}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
    >
      <View style={styles.inner}>
        <Text style={styles.label}>NATIONAL EMERGENCY</Text>
        <Text style={styles.sub}>District · State · National HQ</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.neonRed,
    backgroundColor: 'rgba(255, 0, 51, 0.15)',
  },
  pressed: { opacity: 0.85 },
  inner: { paddingVertical: 16, paddingHorizontal: 18 },
  label: {
    color: colors.neonRed,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1.4,
  },
  sub: { color: colors.silverDim, marginTop: 6, fontSize: 12 },
});
