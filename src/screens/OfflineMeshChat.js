import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import * as mesh from '../api/meshLogic';

const STATE_MESSAGES = {
  CREATED: 'Message created locally',
  QUEUED: 'Message queued locally',
  CONNECTING: 'Connecting to BLE peer...',
  TRANSMITTING: 'Sending via BLE...',
  TRANSMITTED: 'Sent to nearby peer',
  RECEIVED: 'Incoming BLE packet received',
  RELAYING: 'Relaying through mesh...',
  DELIVERED: 'Delivered to destination peer',
  FAILED: 'Transmission failed — retained locally',
};

export function OfflineMeshChat({ navigation }) {
  const { isMeshMode, nodeRole, nodeId, peripheralSupported } = useApp();
  const [meshNodes, setMeshNodes] = useState([]);
  const [statusText, setStatusText] = useState('Scanning for mesh peers...');
  const [meshMetrics, setMeshMetrics] = useState({
    queued: 0,
    persistentMessages: 0,
    processedDuplicatesCount: 0,
  });

  useEffect(() => {
    const refreshPeers = () => {
      const status = mesh.getMeshStatus();
      setMeshMetrics({
        queued: status.queued || 0,
        persistentMessages: status.persistentMessages || 0,
        processedDuplicatesCount: status.processedDuplicatesCount || 0,
      });

      if (status.peers && status.peers.length > 0) {
        setMeshNodes(
          status.peers.map((p) => ({
            id: p.id,
            name: p.name || `Node ${p.id.slice(0, 6)}`,
            rssi: p.rssi ? `${p.rssi} dBm` : 'Connected',
            timestamp: 'Live',
          }))
        );
        setStatusText('BLE peer connected');
      } else {
        setMeshNodes([]);
        setStatusText(isMeshMode ? 'Scanning for mesh peers...' : 'No nearby mesh peers');
      }
    };

    refreshPeers();

    const unsub = mesh.onPeerEvent((event, payload) => {
      if (event === 'peer_discovered') {
        setStatusText(`Discovered BLE peer: ${payload.name || payload.id}`);
        refreshPeers();
      } else if (event === 'mesh_state') {
        setStatusText(payload.enabled ? 'Scanning for mesh peers...' : 'No nearby mesh peers');
        refreshPeers();
      } else if (event === 'delivery_state_change') {
        const mappedState = STATE_MESSAGES[payload.state] || `BLE Status: ${payload.state}`;
        setStatusText(mappedState);
        refreshPeers();
      } else if (event === 'packet_received') {
        setStatusText(`Incoming BLE packet received from ${payload.from || 'Peer'}`);
        refreshPeers();
      } else if (event === 'duplicate_dropped') {
        refreshPeers();
      }
    });

    return unsub;
  }, [isMeshMode]);

  const openChat = (node) => {
    navigation.navigate('Chat', { chatId: node.id, isMesh: true });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Offline Mesh Network</Text>
        <Text style={styles.subtitle}>Peer-to-Peer BLE · Pure Store-and-Forward</Text>
      </View>

      <View style={styles.diagPanel}>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Local Node ID:</Text>
          <Text style={styles.diagVal}>{nodeId}</Text>
        </View>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Node Role:</Text>
          <Text style={styles.diagVal}>{nodeRole}</Text>
        </View>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Physical Outbound Queue:</Text>
          <Text style={styles.diagVal}>{meshMetrics.queued} packet(s)</Text>
        </View>
        <View style={styles.diagRow}>
          <Text style={styles.diagLabel}>Duplicates Protection Cache:</Text>
          <Text style={styles.diagVal}>{meshMetrics.processedDuplicatesCount} ID(s)</Text>
        </View>
      </View>

      {/* BLE PERIPHERAL SUPPORT WARNING */}
      {peripheralSupported === false && (
        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>BLE Mesh Peripheral Mode Unsupported</Text>
          <Text style={styles.warningText}>
            This phone cannot act as a BLE mesh relay/receiver.
          </Text>
          <Text style={styles.warningSub}>
            Scanning may still operate if supported.
          </Text>
        </View>
      )}

      <View style={styles.statusBar}>
        <View style={[styles.statusIndicator, (!isMeshMode || meshNodes.length === 0) && styles.statusInactive]} />
        <Text style={styles.statusText}>{statusText}</Text>
        <Text style={styles.peerCount}>{meshNodes.length} Nodes</Text>
      </View>

      <FlatList
        data={meshNodes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => openChat(item)} style={styles.chatCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
            </View>
            <View style={styles.chatInfo}>
              <Text style={styles.chatName}>{item.name}</Text>
              <Text style={styles.chatMessage} numberOfLines={1}>
                RSSI: {item.rssi}
              </Text>
              <View style={styles.chatMeta}>
                <Text style={styles.chatTime}>{item.timestamp}</Text>
                <Text style={styles.chatDistance}>· BLE Direct</Text>
              </View>
            </View>
            <View style={styles.signalIndicator}>
              <Text style={styles.signalText}>📡</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>NO NEARBY MESH PEERS</Text>
            <Text style={styles.emptySub}>
              Scanning physical BLE channels for compatible ForBien peers...
            </Text>
            <Text style={styles.emptyBadge}>Internet not required.</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  title: { color: colors.silver, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colors.silverDim, marginTop: 4, fontSize: 13 },
  diagPanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  diagLabel: { color: colors.silverDim, fontSize: 12, fontWeight: '600' },
  diagVal: { color: colors.silver, fontSize: 12, fontWeight: '800' },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 0, 51, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: colors.neonRed,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.neonRed,
    marginRight: 8,
  },
  statusInactive: {
    backgroundColor: colors.silverDim,
  },
  statusText: { color: colors.silver, fontWeight: '700', fontSize: 13, flex: 1 },
  peerCount: { color: colors.neonRed, fontWeight: '700', fontSize: 12 },
  list: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  chatCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.silver, fontSize: 20, fontWeight: '900' },
  chatInfo: { flex: 1, marginLeft: 12 },
  chatName: { color: colors.silver, fontSize: 16, fontWeight: '700' },
  chatMessage: { color: colors.silverDim, marginTop: 4, fontSize: 14 },
  chatMeta: {
    flexDirection: 'row',
    marginTop: 6,
    alignItems: 'center',
  },
  chatTime: { color: colors.silverDim, fontSize: 12 },
  chatDistance: { color: colors.neonRed, fontSize: 12, marginLeft: 4 },
  signalIndicator: {
    marginLeft: 8,
  },
  signalText: { fontSize: 16 },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justify: 'center',
    paddingVertical: 40,
  },
  emptyTitle: {
    color: colors.neonRed,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  emptySub: {
    color: colors.silverDim,
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyBadge: {
    color: colors.silver,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  warningCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    borderWidth: 1,
    borderColor: '#FFA500',
  },
  warningTitle: { color: '#FFA500', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  warningText: { color: colors.silver, fontSize: 13, lineHeight: 18, marginTop: 6 },
  warningSub: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
});
