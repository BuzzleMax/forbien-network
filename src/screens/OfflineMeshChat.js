import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';

const FRIEND_IDS = ['1', '2', '3', '4'];

const MESH_CHATS = [
  { id: '1', friendId: '1', friendName: 'Sarah Chen', lastMessage: 'Signal strength: 85%', timestamp: '2m ago', distance: '45m' },
  { id: '2', friendId: '2', friendName: 'Marcus Webb', lastMessage: 'Mesh node active', timestamp: '5m ago', distance: '120m' },
  { id: '3', friendId: '4', friendName: 'James Park', lastMessage: 'Location synced', timestamp: '12m ago', distance: '200m' },
];

export function OfflineMeshChat({ navigation }) {
  const { isMeshMode } = useApp();
  const [isConnected, setIsConnected] = useState(true);
  const [filteredChats, setFilteredChats] = useState([]);

  useEffect(() => {
    const checkConnection = async () => {
      const networkState = await Network.getNetworkStateAsync();
      setIsConnected(networkState.isConnected);
    };

    checkConnection();

    // Filter chats by friend IDs
    const filtered = MESH_CHATS.filter((chat) => FRIEND_IDS.includes(chat.friendId));
    setFilteredChats(filtered);
  }, []);

  if (isConnected) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.offlineContainer}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>📡</Text>
          </View>
          <Text style={styles.title}>Online Mode Active</Text>
          <Text style={styles.subtitle}>
            Offline Mesh Chat is only available when internet is disconnected.
          </Text>
          <Text style={styles.hint}>
            Disconnect from internet to enable peer-to-peer mesh communication.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const openChat = (chat) => {
    navigation.navigate('Chat', { chatId: chat.id, isMesh: true });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Offline Mesh</Text>
        <Text style={styles.subtitle}>Peer-to-Peer · No Internet Required</Text>
      </View>

      <View style={styles.statusBar}>
        <View style={styles.statusIndicator} />
        <Text style={styles.statusText}>Mesh Network Active</Text>
        <Text style={styles.peerCount}>{filteredChats.length} Peers Nearby</Text>
      </View>

      <FlatList
        data={filteredChats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable onPress={() => openChat(item)} style={styles.chatCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.friendName.charAt(0)}</Text>
            </View>
            <View style={styles.chatInfo}>
              <Text style={styles.chatName}>{item.friendName}</Text>
              <Text style={styles.chatMessage} numberOfLines={1}>
                {item.lastMessage}
              </Text>
              <View style={styles.chatMeta}>
                <Text style={styles.chatTime}>{item.timestamp}</Text>
                <Text style={styles.chatDistance}>· {item.distance}</Text>
              </View>
            </View>
            <View style={styles.signalIndicator}>
              <Text style={styles.signalText}>📶</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgDeep },
  offlineContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  icon: { fontSize: 40 },
  title: { color: colors.silver, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  subtitle: { color: colors.silverDim, fontSize: 15, textAlign: 'center', marginBottom: 8 },
  hint: { color: colors.neonRed, fontSize: 13, textAlign: 'center' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  title: { color: colors.silver, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colors.silverDim, marginTop: 4, fontSize: 13 },
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
  statusText: { color: colors.silver, fontWeight: '700', fontSize: 13, flex: 1 },
  peerCount: { color: colors.neonRed, fontWeight: '700', fontSize: 12 },
  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
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
});
