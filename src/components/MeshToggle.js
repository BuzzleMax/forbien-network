import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function MeshToggle({ value, onValueChange, disabled }) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.title}>Forest / Mission Mode</Text>
        <Text style={styles.hint}>Offline mesh · Bluetooth / Wi‑Fi Direct</Text>
      </View>
      <Switch
        accessibilityLabel="Toggle offline mesh Forest Mission mode"
        trackColor={{ false: colors.cobalt, true: colors.accent }}
        thumbColor={value ? colors.silver : colors.silverDim}
        ios_backgroundColor={colors.cobalt}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    marginTop: 8,
  },
  copy: { flex: 1, paddingRight: 12 },
  title: { color: colors.silver, fontSize: 15, fontWeight: '700' },
  hint: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
});
