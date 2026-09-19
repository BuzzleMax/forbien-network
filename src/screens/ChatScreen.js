import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import * as mesh from '../api/meshLogic';

export function ChatScreen() {
  const { isMeshMode, userRole } = useApp();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [hasDiscoveredPeers, setHasDiscoveredPeers] = useState(false);

  useEffect(() => {
    const status = mesh.getMeshStatus();
    setHasDiscoveredPeers(status.peers && status.peers.length > 0);

    const unsub = mesh.onPeerEvent((event, payload) => {
      if (event === 'peer_discovered' || event === 'mesh_state') {
        const st = mesh.getMeshStatus();
        setHasDiscoveredPeers(st.peers && st.peers.length > 0);
      } else if (event === 'message') {
        const isHQ = userRole === 'HQ' || userRole === 'Headquarters';
        let displayText = payload.text;
        let displayMeta = payload.meta || {};

        if (isHQ && payload.compressed && !payload.decompressed) {
          try {
            const { decompressSOSData } = require('../lib/compression');
            const decompressedData = decompressSOSData(payload.compressed);
            displayText = decompressedData.message || payload.text;
            displayMeta = {
              ...displayMeta,
              ...decompressedData,
              decompressed: true,
            };
          } catch (error) {
            console.error('Decompression error:', error);
          }
        }

        setMessages((prev) => [
          ...prev,
          {
            id: `rx_${payload.ts}_${Math.random().toString(36).substr(2, 4)}`,
            role: 'peer',
            text: displayText,
            ts: payload.ts,
            hopCount: payload.hopCount || 0,
            encrypted: payload.encrypted || false,
            type: payload.type || 'regular',
            compressed: payload.compressed || false,
            decompressed: displayMeta.decompressed || false,
            meta: displayMeta,
          },
        ]);
      }
    });
    return unsub;
  }, [userRole]);

  const onSend = async () => {
    const text = input.trim();
    if (!text) return;
    const msgId = `m_${Date.now()}`;
    const newMsg = {
      id: msgId,
      role: 'me',
      text,
      ts: Date.now(),
      hopCount: 0,
      encrypted: isMeshMode,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');
    await mesh.sendToGroup('mesh_offline_broadcast', { text, type: 'regular' });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Offline Messages</Text>
        <Text style={styles.pill}>BLE MESH ONLY</Text>
      </View>

      <View style={styles.meshNotice}>
        <Text style={styles.noticeText}>
          Messages are transmitted only through nearby BLE mesh peers.
        </Text>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.msgList}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'me' ? styles.bubbleMe : styles.bubbleOther,
            ]}
          >
            <Text style={styles.bubbleText}>{item.text}</Text>
            <View style={styles.messageMeta}>
              {item.encrypted && (
                <View style={styles.encryptionBadge}>
                  <Text style={styles.encryptionText}>🔒 AES-256-GCM</Text>
                </View>
              )}
              {item.role === 'peer' && item.hopCount > 0 && (
                <View style={styles.hopBadge}>
                  <Text style={styles.hopText}>Hops: {item.hopCount}</Text>
                </View>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyHead}>
              {hasDiscoveredPeers ? 'NO MESSAGES IN MESH QUEUE' : 'NO NEARBY MESH PEERS'}
            </Text>
            <Text style={styles.emptySub}>
              {hasDiscoveredPeers
                ? 'Nearby BLE nodes connected. Type a message below to broadcast via mesh.'
                : 'Scanning for compatible ForBien BLE nodes...\nInternet not required.'}
            </Text>
          </View>
        }
      />

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Offline mesh message…"
          placeholderTextColor={colors.silverDim}
          style={styles.input}
        />
        <Pressable onPress={onSend} style={[styles.send, { marginLeft: 10 }]}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: colors.silver, fontSize: 22, fontWeight: '900' },
  pill: {
    color: colors.neonRed,
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  meshNotice: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 0, 51, 0.1)',
    borderWidth: 1,
    borderColor: colors.neonRed,
  },
  noticeText: { color: colors.silver, fontSize: 12, fontWeight: '700' },
  msgList: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 12 },
  bubble: {
    maxWidth: '88%',
    marginBottom: 10,
    padding: 12,
    borderRadius: 16,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: colors.cobalt,
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleText: { color: colors.silver, fontSize: 15, lineHeight: 20 },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  encryptionBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 6,
  },
  encryptionText: { color: colors.silver, fontSize: 10, fontWeight: '700' },
  hopBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(37,99,235,0.2)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  hopText: { color: colors.silverBlue, fontSize: 10, fontWeight: '700' },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyHead: {
    color: colors.neonRed,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 1.5,
  },
  emptySub: {
    color: colors.silverDim,
    textAlign: 'center',
    marginTop: 8,
    fontSize: 13,
    lineHeight: 20,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bgPanel,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.silver,
  },
  send: {
    backgroundColor: colors.neonRed,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
  },
  sendText: { color: colors.silver, fontWeight: '800' },
});

