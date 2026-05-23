import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function BuzzleFooter() {
  return (
    <View style={styles.wrap} accessibilityRole="text">
      <Text style={styles.line}>Product of Buzzle Max</Text>
      <Text style={styles.sub}>Silver · Secure · Field-ready</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgDeep,
    alignItems: 'center',
  },
  line: {
    color: colors.silver,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  sub: {
    marginTop: 4,
    color: colors.silverDim,
    fontSize: 11,
  },
});
