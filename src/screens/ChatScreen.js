import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import * as mesh from '../api/meshLogic';

export function ChatScreen({ navigation }) {
  const route = useRoute();
  const {
    isMeshMode,
    missionGroupId,
    setMissionGroupId,
    friends,
    groups,
    createGroup,
    userRole,
  } = useApp();

  const [tab, setTab] = useState('friends');
  const [thread, setThread] = useState({ kind: 'dm', id: friends[0]?.id || 'f1' });
  const [input, setInput] = useState('');
  const [messagesByThread, setMessagesByThread] = useState({});
  const [sound, setSound] = useState(null);

  // Function to play SOS alert sound
  const playSOSAlert = useCallback(async () => {
    try {
      const { sound: audioSound } = await Audio.Sound.createAsync(
        { uri: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' },
        { shouldPlay: true, volume: 1.0 }
      );
      setSound(audioSound);
      await audioSound.playAsync();
    } catch (error) {
      console.error('Failed to play SOS alert:', error);
    }
  }, []);

  // Cleanup sound on unmount
  useEffect(() => {
    return sound
      ? () => {
          sound.unloadAsync();
        }
      : undefined;
  }, [sound]);

  useFocusEffect(
    useCallback(() => {
      const og = route.params?.openGroupId;
      if (og) {
        setThread({ kind: 'group', id: og });
        setTab('groups');
        setMissionGroupId(og);
        navigation.setParams({ openGroupId: undefined });
      }
    }, [route.params?.openGroupId, navigation, setMissionGroupId]),
  );

  useEffect(() => {
    const unsub = mesh.onPeerEvent((event, payload) => {
      if (event !== 'message') return;
      
      // Check if message is SOS type and user is HQ/Headquarters
      const isSOS = payload.type === 'SOS' || payload.text?.toLowerCase().includes('sos');
      const isHQ = userRole === 'HQ' || userRole === 'Headquarters';
      
      // Trigger audio alert only for SOS messages when user is HQ
      if (isSOS && isHQ) {
        playSOSAlert();
      }
      // Regular users get silent notification (message is added to list without sound)
      
      // Handle decompression for HQ nodes
      let displayText = payload.text;
      let displayMeta = payload.meta || {};
      
      if (isHQ && payload.compressed && !payload.decompressed) {
        // HQ nodes decompress compressed SOS messages
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
          displayText = payload.text; // Fallback to original
        }
      }
      
      const key = `group:${payload.groupId}`;
      setMessagesByThread((prev) => {
        const list = prev[key] || [];
        return {
          ...prev,
          [key]: [
            ...list,
            {
              id: `rx_${payload.ts}`,
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
          ],
        };
      });
    });
    return unsub;
  }, [userRole, playSOSAlert]);

  const threadKey = useMemo(() => {
    if (thread.kind === 'dm') return `dm:${thread.id}`;
    return `group:${thread.id}`;
  }, [thread]);

  const messages = messagesByThread[threadKey] || [];

  const pushMessage = useCallback(
    (role, text, hopCount = 0, encrypted = false) => {
      const id = `m_${Date.now()}`;
      const ts = Date.now();
      setMessagesByThread((prev) => {
        const list = prev[threadKey] || [];
        return { ...prev, [threadKey]: [...list, { id, role, text, ts, hopCount, encrypted }] };
      });
    },
    [threadKey],
  );

  const onSend = async () => {
    const text = input.trim();
    if (!text) return;
    pushMessage('me', text, 0, isMeshMode);
    setInput('');
    const gid = thread.kind === 'group' ? thread.id : `dm_${thread.id}`;
    await mesh.sendToGroup(gid, { text, channel: thread.kind });
  };

  const onCreateGroup = () => {
    const id = createGroup(`Field Group ${groups.length + 1}`);
    setThread({ kind: 'group', id });
    setTab('groups');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <Text style={styles.pill}>{isMeshMode ? 'Mesh' : 'Internet'}</Text>
      </View>
      {isMeshMode ? (
        <View style={styles.meshBar}>
          <Text style={styles.meshText}>
            {missionGroupId
              ? `Mission group · ${missionGroupId}`
              : 'High-speed private mesh · Friends & groups'}
          </Text>
        </View>
      ) : null}

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('friends')} style={styles.tabBtn}>
          <Text style={[styles.tab, tab === 'friends' && styles.tabOn]}>Friends</Text>
        </Pressable>
        <Pressable onPress={() => setTab('groups')} style={styles.tabBtn}>
          <Text style={[styles.tab, tab === 'groups' && styles.tabOn]}>Groups</Text>
        </Pressable>
      </View>

      {tab === 'friends' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.friendsRail}
        >
          {friends.map((f) => (
            <Pressable
              key={f.id}
              onPress={() => setThread({ kind: 'dm', id: f.id })}
              style={[
                styles.friendChip,
                thread.kind === 'dm' && thread.id === f.id && styles.friendChipOn,
              ]}
            >
              <Text style={styles.friendName}>{f.name}</Text>
              <Text style={styles.friendHandle}>{f.handle}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={styles.groupBar}>
          <Pressable onPress={onCreateGroup} style={styles.newGroup}>
            <Text style={styles.newGroupText}>+ Group</Text>
          </Pressable>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groupsRail}
          >
            {groups.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setThread({ kind: 'group', id: g.id })}
                style={[
                  styles.groupChip,
                  thread.kind === 'group' && thread.id === g.id && styles.groupChipOn,
                ]}
              >
                <Text style={styles.groupName}>{g.name}</Text>
                <Text style={styles.groupMeta}>{g.members} members</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

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
                  <Text style={styles.encryptionText}>🔒 Encrypted</Text>
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
          <Text style={styles.empty}>Start the thread · end-to-end discipline</Text>
        }
      />

      <View style={styles.composer}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Message…"
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
    color: colors.silverBlue,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.5,
  },
  meshBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(37,99,235,0.12)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  meshText: { color: colors.silver, fontSize: 12 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  tabBtn: { marginRight: 8 },
  tab: {
    color: colors.silverDim,
    fontWeight: '700',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  tabOn: {
    color: colors.silver,
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  friendsRail: { paddingHorizontal: 12, paddingBottom: 8 },
  friendChip: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 10,
    width: 132,
  },
  friendChipOn: { borderColor: colors.accent },
  friendName: { color: colors.silver, fontWeight: '800' },
  friendHandle: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
  groupBar: { paddingBottom: 8 },
  newGroup: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    marginBottom: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  newGroupText: { color: colors.silver, fontWeight: '800' },
  groupsRail: { paddingHorizontal: 12 },
  groupChip: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 10,
    minWidth: 120,
  },
  groupChipOn: { borderColor: colors.accent },
  groupName: { color: colors.silver, fontWeight: '800' },
  groupMeta: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
  msgList: { paddingHorizontal: 16, paddingBottom: 12 },
  bubble: {
    maxWidth: '88%',
    marginBottom: 10,
    padding: 12,
    borderRadius: 16,
  },
  bubbleMe: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
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
  empty: { color: colors.silverDim, textAlign: 'center', marginTop: 24 },
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
    backgroundColor: colors.cobalt,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendText: { color: colors.silver, fontWeight: '800' },
});
