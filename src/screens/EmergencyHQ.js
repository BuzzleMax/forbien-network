import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';

const LEVELS = [
  { id: 'district', label: 'District HQ', sub: 'Local command · fastest ground net' },
  { id: 'state', label: 'State HQ', sub: 'Regional coordination · multi-district' },
  { id: 'national', label: 'National HQ', sub: 'Sovereign authority · full priority' },
];

function resolveAutoTarget() {
  return 'national';
}

export function EmergencyHQ({ navigation }) {
  const {
    setEmergencyPriority,
    createGroup,
    setMissionGroupId,
    setIsMeshMode,
  } = useApp();
  const [mode, setMode] = useState('manual');
  const [level, setLevel] = useState('national');
  const [status, setStatus] = useState('idle');
  const [lastLink, setLastLink] = useState(null);

  const effectiveLevel = useMemo(() => {
    if (mode === 'auto') return resolveAutoTarget();
    return level;
  }, [mode, level]);

  const connect = async () => {
    setStatus('connecting');
    setEmergencyPriority(effectiveLevel);
    await new Promise((r) => setTimeout(r, 1000));
    const link = {
      level: effectiveLevel,
      circuit: `HX-${effectiveLevel.toUpperCase()}-${Date.now() % 10000}`,
      latencyMs: 120 + Math.floor(Math.random() * 80),
    };
    setLastLink(link);
    setStatus('connected');
  };

  const openMissionChat = () => {
    const id = createGroup(`Mission ${new Date().toISOString().slice(11, 19)}`);
    setMissionGroupId(id);
    setIsMeshMode(true);
    navigation.navigate('Main', {
      screen: 'Chat',
      params: { openGroupId: id },
    });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} style={styles.close}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
        <Text style={styles.title}>TACTICAL LINK</Text>
        <Text style={styles.sub}>National Emergency · HQ routing</Text>
      </View>

      <View style={styles.modeRow}>
        <Pressable
          onPress={() => setMode('manual')}
          style={[styles.modeChip, mode === 'manual' && styles.modeChipOn]}
        >
          <Text style={styles.modeText}>Manual priority</Text>
        </Pressable>
        <Pressable
          onPress={() => setMode('auto')}
          style={[styles.modeChip, mode === 'auto' && styles.modeChipOn]}
        >
          <Text style={styles.modeText}>Auto escalate</Text>
        </Pressable>
      </View>

      {mode === 'manual' ? (
        <View style={styles.levels}>
          {LEVELS.map((L) => (
            <Pressable
              key={L.id}
              onPress={() => setLevel(L.id)}
              style={[styles.levelCard, level === L.id && styles.levelCardOn]}
            >
              <Text style={styles.levelTitle}>{L.label}</Text>
              <Text style={styles.levelSub}>{L.sub}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.autoBox}>
          <Text style={styles.autoHead}>Escalation ladder</Text>
          <Text style={styles.autoLine}>District → State → National</Text>
          <Text style={styles.autoHint}>
            Auto mode selects <Text style={styles.bold}>National HQ</Text> for this build (policy
            hook).
          </Text>
        </View>
      )}

      <Pressable
        onPress={connect}
        style={[styles.connect, status === 'connecting' && styles.connectBusy]}
        disabled={status === 'connecting'}
      >
        <Text style={styles.connectText}>
          {status === 'connecting' ? 'SEEKING CIRCUIT…' : 'CONNECT TO HQ'}
        </Text>
      </Pressable>

      {lastLink ? (
        <View style={styles.statusBox}>
          <Text style={styles.statusHead}>Circuit</Text>
          <Text style={styles.statusBody}>
            {lastLink.circuit} · {lastLink.level.toUpperCase()} · {lastLink.latencyMs}ms
          </Text>
        </View>
      ) : null}

      <Pressable onPress={openMissionChat} style={styles.mission}>
        <Text style={styles.missionTitle}>Mission group</Text>
        <Text style={styles.missionSub}>Open encrypted forest chat · offline mesh ON</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  top: { paddingHorizontal: 16, paddingBottom: 12 },
  close: { alignSelf: 'flex-end', marginBottom: 8 },
  closeText: { color: colors.neonRed, fontWeight: '700' },
  title: {
    color: colors.neonRed,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 4,
  },
  sub: { color: colors.silverDim, marginTop: 6, fontSize: 13 },
  modeRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  modeChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
    marginRight: 10,
  },
  modeChipOn: { borderColor: colors.neonRed, backgroundColor: 'rgba(255, 0, 51, 0.15)' },
  modeText: { color: colors.silver, fontWeight: '700', fontSize: 13 },
  levels: { paddingHorizontal: 16 },
  levelCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
    marginBottom: 10,
  },
  levelCardOn: { borderColor: colors.neonRed, backgroundColor: 'rgba(255, 0, 51, 0.12)' },
  levelTitle: { color: colors.silver, fontSize: 17, fontWeight: '800' },
  levelSub: { color: colors.silverDim, marginTop: 6, fontSize: 12, lineHeight: 18 },
  autoBox: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
  },
  autoHead: { color: colors.silver, fontWeight: '800', fontSize: 15 },
  autoLine: { color: colors.neonRed, marginTop: 8, fontWeight: '700' },
  autoHint: { color: colors.silverDim, marginTop: 10, lineHeight: 20, fontSize: 13 },
  bold: { color: colors.silver, fontWeight: '800' },
  connect: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
  },
  connectBusy: { opacity: 0.7 },
  connectText: { color: colors.silver, fontWeight: '900', letterSpacing: 2, fontSize: 14 },
  statusBox: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusHead: { color: colors.silverDim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  statusBody: { color: colors.silver, marginTop: 6, fontWeight: '700' },
  mission: {
    marginHorizontal: 16,
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.neonRed,
    backgroundColor: 'rgba(255, 0, 51, 0.12)',
  },
  missionTitle: { color: colors.silver, fontWeight: '900', fontSize: 16 },
  missionSub: { color: colors.silverDim, marginTop: 6, fontSize: 12, lineHeight: 18 },
});
