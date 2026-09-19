import React, { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MeshToggle } from '../components/MeshToggle';
import { EmergencyButton } from '../components/EmergencyButton';
import { useApp } from '../context/AppContext';

export function HomeScreen({ navigation }) {
  const { isMeshMode, setIsMeshMode, nodeRole } = useApp();

  const openEmergency = useCallback(() => {
    navigation.navigate('EmergencyMessage');
  }, [navigation]);

  const openEmergencyHistory = useCallback(() => {
    navigation.navigate('EmergencyHistory');
  }, [navigation]);

  const openEmergencyHQ = useCallback(() => {
    const parent = navigation.getParent?.();
    if (parent) parent.navigate('EmergencyHQ');
    else navigation.navigate('EmergencyHQ');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>ForBien</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.mode}>PURE OFFLINE MESH</Text>
            <Text style={styles.roleBadge}>{nodeRole === 'HQ' ? '🛡️ FORBIEN HQ' : `${nodeRole} DEVICE`}</Text>
          </View>
        </View>

        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            🛡️ Zero Internet Required · Local BLE Transport · Encrypted Peer Relay
          </Text>
        </View>

        <MeshToggle value={isMeshMode} onValueChange={setIsMeshMode} />

        <EmergencyButton onPress={openEmergency} />

        <Pressable onPress={openEmergencyHistory} style={styles.historyBtn}>
          <Text style={styles.historyBtnText}>MY EMERGENCIES</Text>
        </Pressable>

        <Pressable onPress={openEmergencyHQ} style={styles.hqBtn}>
          <Text style={styles.hqBtnText}>HQ MODE</Text>
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Offline Emergency Protocol</Text>

          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Transport:</Text>
            <Text style={styles.specValue}>Bluetooth Low Energy (BLE)</Text>
          </View>

          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Security:</Text>
            <Text style={styles.specValue}>AES-256-GCM Authenticated</Text>
          </View>

          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Compression:</Text>
            <Text style={styles.specValue}>Dictionary SOS Engine</Text>
          </View>

          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Location:</Text>
            <Text style={styles.specValue}>Device Local GPS</Text>
          </View>

          <View style={styles.specRow}>
            <Text style={styles.specLabel}>Multi-hop Relay:</Text>
            <Text style={styles.specValue}>Max 5 Hops (TTL)</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgDeep },
  scroll: { paddingBottom: 24 },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logo: { color: colors.silver, fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  mode: {
    color: colors.neonRed,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 2,
  },
  roleBadge: {
    color: colors.silverDim,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  banner: {
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: 'rgba(255, 0, 51, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neonRed,
    padding: 12,
  },
  bannerText: { color: colors.silver, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  card: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 16,
    backgroundColor: colors.bgPanel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.silver, fontSize: 16, fontWeight: '800', marginBottom: 14 },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  specLabel: { color: colors.silverDim, fontSize: 13, fontWeight: '600' },
  specValue: { color: colors.silver, fontSize: 13, fontWeight: '700' },
  historyBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  historyBtnText: { color: colors.silver, fontWeight: '800', fontSize: 15 },
  hqBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 0, 51, 0.1)',
    borderWidth: 1,
    borderColor: colors.neonRed,
    alignItems: 'center',
  },
  hqBtnText: { color: colors.neonRed, fontWeight: '900', fontSize: 15 },
});
