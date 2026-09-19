import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import * as mesh from '../api/meshLogic';

export function EmergencyHistoryScreen({ navigation }) {
  const { nodeId } = useApp();
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    loadSentMessages();
  }, []);

  const loadSentMessages = () => {
    const persistentMessages = mesh.getPersistentMessages();
    const emergencyMessages = persistentMessages.filter(
      (msg) => msg.type === 'SOS' && msg.sourceNodeId === nodeId
    );
    setMessages(emergencyMessages);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatLocation = (meta) => {
    if (!meta) return 'Location: Unavailable';
    if (meta.locationAvailable === false) return 'Location: Unavailable';
    if (meta.latitude && meta.longitude) {
      return `Location:\nLat ${meta.latitude.toFixed(4)}\nLng ${meta.longitude.toFixed(4)}`;
    }
    return 'Location: Unavailable';
  };

  const getDeliveryStatusText = (deliveryState) => {
    switch (deliveryState) {
      case 'DELIVERED_TO_HQ':
        return 'DELIVERED TO HQ';
      case 'DELIVERED':
        return 'DELIVERED';
      case 'RELAYING':
        return 'RELAYING';
      case 'QUEUED':
        return 'QUEUED — WAITING FOR RELAY';
      case 'TRANSMITTING':
        return 'TRANSMITTING';
      case 'TRANSMITTED':
        return 'TRANSMITTED';
      case 'FAILED':
        return 'FAILED';
      default:
        return deliveryState || 'UNKNOWN';
    }
  };

  const renderEmergencyCard = ({ item }) => (
    <View style={styles.card}>
      <Text style={styles.cardHeader}>EMERGENCY MESSAGE</Text>
      
      <Text style={styles.messageText}>"{item.meta?.message || item.plainData?.message || 'No message text'}"</Text>
      
      <Text style={styles.timeText}>{formatTime(item.ts)}</Text>
      
      <Text style={styles.locationText}>{formatLocation(item.meta || item.plainData)}</Text>
      
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Status:</Text>
        <Text style={[
          styles.statusValue,
          item.deliveryState === 'DELIVERED_TO_HQ' && styles.statusDelivered,
          item.deliveryState === 'FAILED' && styles.statusFailed,
        ]}>
          {getDeliveryStatusText(item.deliveryState)}
        </Text>
      </View>

      {item.routeHistory && item.routeHistory.length > 0 && (
        <View style={styles.routeRow}>
          <Text style={styles.routeLabel}>Route:</Text>
          <Text style={styles.routeValue}>{item.routeHistory.join(' → ')}</Text>
        </View>
      )}

      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>ID: {item.id}</Text>
        <Text style={styles.metaLabel}>Hops: {item.hopCount}/{item.maxHops}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <Text style={styles.closeText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>MY EMERGENCIES</Text>
        <Pressable onPress={loadSentMessages} style={styles.refreshBtn}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderEmergencyCard}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>NO EMERGENCY MESSAGES SENT</Text>
            <Text style={styles.emptySub}>
              Your sent emergency messages will appear here
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: { padding: 8 },
  closeText: { color: colors.silverDim, fontWeight: '700' },
  title: { color: colors.silver, fontSize: 18, fontWeight: '900' },
  refreshBtn: { padding: 8 },
  refreshText: { color: colors.accent, fontWeight: '700' },
  list: { padding: 16, paddingBottom: 30 },
  card: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  cardHeader: {
    color: colors.neonRed,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 12,
  },
  messageText: {
    color: colors.silver,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 12,
  },
  timeText: {
    color: colors.silverDim,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  locationText: {
    color: colors.silverDim,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: { color: colors.silverDim, fontSize: 13, fontWeight: '600' },
  statusValue: { color: colors.silver, fontSize: 13, fontWeight: '700' },
  statusDelivered: { color: colors.accent },
  statusFailed: { color: colors.neonRed },
  routeRow: {
    marginBottom: 8,
  },
  routeLabel: { color: colors.silverDim, fontSize: 12, fontWeight: '600' },
  routeValue: { color: colors.neonRed, fontSize: 12, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  metaLabel: { color: colors.silverDim, fontSize: 11, fontWeight: '600' },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: colors.silverDim,
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 1,
  },
  emptySub: {
    color: colors.silverDim,
    textAlign: 'center',
    marginTop: 8,
    fontSize: 13,
    lineHeight: 18,
  },
});
