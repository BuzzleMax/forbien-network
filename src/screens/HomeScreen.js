import React, { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { MeshToggle } from '../components/MeshToggle';
import { EmergencyButton } from '../components/EmergencyButton';
import { useApp } from '../context/AppContext';

const FEED = [
  {
    id: '1',
    title: 'District briefing · night cordon',
    channel: 'HQ Stream',
    views: '12K views',
    meta: 'LIVE',
  },
  {
    id: '2',
    title: 'Mesh field test · Forest/Mission checklist',
    channel: 'Ops / Buzzle Max',
    views: '3.1K views',
    meta: 'New',
  },
  {
    id: '3',
    title: 'Secure UPI rails · settlement latency',
    channel: 'FinSec Daily',
    views: '890K views',
    meta: 'Trending',
  },
  {
    id: '4',
    title: 'Mission group voice · offline relay',
    channel: 'Tactical',
    views: '56K views',
    meta: 'Teams',
  },
];

function FeedRow({ item, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={styles.thumb}>
        <View style={styles.thumbInner}>
          <Text style={styles.thumbText}>{item.meta}</Text>
        </View>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.rowMeta}>
          {item.channel} · {item.views}
        </Text>
      </View>
    </Pressable>
  );
}

export function HomeScreen({ navigation }) {
  const { isMeshMode, setIsMeshMode } = useApp();

  const openEmergency = useCallback(() => {
    const parent = navigation.getParent?.();
    if (parent) parent.navigate('EmergencyHQ');
    else navigation.navigate('EmergencyHQ');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.logo}>ForBien</Text>
        <Text style={styles.mode}>{isMeshMode ? 'TACTICAL' : 'VIBE'}</Text>
      </View>
      {isMeshMode ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Forest / Mission Mode · Offline mesh active · Messages route via peer relay
          </Text>
        </View>
      ) : null}
      <MeshToggle value={isMeshMode} onValueChange={setIsMeshMode} />
      <EmergencyButton onPress={openEmergency} />
      <FlatList
        data={FEED}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.section}>Recommended</Text>
        }
        renderItem={({ item }) => (
          <FeedRow item={item} onPress={() => {}} />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgDeep },
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
  banner: {
    marginHorizontal: 16,
    marginBottom: 4,
    backgroundColor: 'rgba(255, 0, 51, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neonRed,
    padding: 12,
  },
  bannerText: { color: colors.silver, fontSize: 12, lineHeight: 18 },
  section: {
    color: colors.silverDim,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 10,
    marginTop: 8,
  },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    marginBottom: 18,
    alignItems: 'flex-start',
  },
  thumb: {
    width: 148,
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  thumbInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbText: { color: colors.neonRed, fontWeight: '800', fontSize: 12 },
  rowBody: { flex: 1, marginLeft: 12 },
  rowTitle: { color: colors.silver, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: colors.silverDim, fontSize: 12, marginTop: 6 },
});
