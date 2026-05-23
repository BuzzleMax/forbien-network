import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';

const FRIENDS = [
  { id: '1', name: 'Sarah Chen', status: 'online', role: 'Field Medic' },
  { id: '2', name: 'Marcus Webb', status: 'online', role: 'Comms Officer' },
  { id: '3', name: 'Elena Rodriguez', status: 'offline', role: 'Tactical Lead' },
  { id: '4', name: 'James Park', status: 'online', role: 'Logistics' },
];

const GROUPS = [
  { id: '1', name: 'Alpha Team', members: 4, lastActive: '2m ago' },
  { id: '2', name: 'Medical Response', members: 8, lastActive: '15m ago' },
  { id: '3', name: 'Forest Ops', members: 12, lastActive: '1h ago' },
];

export function SocialHub({ navigation }) {
  const { user } = useApp();
  const [activeTab, setActiveTab] = useState('profile');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Social Hub</Text>
        <Text style={styles.subtitle}>Connected to ForBien Network</Text>
      </View>

      <View style={styles.tabs}>
        <Pressable
          onPress={() => setActiveTab('profile')}
          style={[styles.tab, activeTab === 'profile' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'profile' && styles.tabTextActive]}>
            Profile
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('friends')}
          style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
            Friends
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('groups')}
          style={[styles.tab, activeTab === 'groups' && styles.tabActive]}
        >
          <Text style={[styles.tabText, activeTab === 'groups' && styles.tabTextActive]}>
            Groups
          </Text>
        </Pressable>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {activeTab === 'profile' && (
          <View style={styles.section}>
            <View style={styles.profileCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </Text>
              </View>
              <View style={styles.profileInfo}>
                <Text style={styles.profileName}>Field Operative</Text>
                <Text style={styles.profileEmail}>{user?.email || 'No email'}</Text>
                <Text style={styles.profileStatus}>Status: Active</Text>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{FRIENDS.length}</Text>
                <Text style={styles.statLabel}>Friends</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>{GROUPS.length}</Text>
                <Text style={styles.statLabel}>Groups</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNumber}>24</Text>
                <Text style={styles.statLabel}>Missions</Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'friends' && (
          <View style={styles.section}>
            {FRIENDS.map((friend) => (
              <Pressable
                key={friend.id}
                style={styles.friendCard}
                onPress={() => {}}
              >
                <View style={styles.friendAvatar}>
                  <Text style={styles.friendAvatarText}>
                    {friend.name.charAt(0)}
                  </Text>
                </View>
                <View style={styles.friendInfo}>
                  <Text style={styles.friendName}>{friend.name}</Text>
                  <Text style={styles.friendRole}>{friend.role}</Text>
                </View>
                <View style={[styles.statusDot, friend.status === 'online' && styles.statusOnline]} />
              </Pressable>
            ))}
          </View>
        )}

        {activeTab === 'groups' && (
          <View style={styles.section}>
            {GROUPS.map((group) => (
              <Pressable
                key={group.id}
                style={styles.groupCard}
                onPress={() => {}}
              >
                <View style={styles.groupIcon}>
                  <Text style={styles.groupIconText}>#</Text>
                </View>
                <View style={styles.groupInfo}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <Text style={styles.groupMeta}>
                    {group.members} members · {group.lastActive}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bgDeep },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  title: { color: colors.silver, fontSize: 24, fontWeight: '900' },
  subtitle: { color: colors.silverDim, marginTop: 4, fontSize: 13 },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
    marginRight: 8,
  },
  tabActive: {
    backgroundColor: colors.neonRed,
  },
  tabText: { color: colors.silverDim, fontWeight: '700', fontSize: 13 },
  tabTextActive: { color: colors.silver },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: 16, paddingBottom: 24 },
  section: {},
  profileCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgPanel,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.silver, fontSize: 28, fontWeight: '900' },
  profileInfo: { flex: 1, marginLeft: 16, justifyContent: 'center' },
  profileName: { color: colors.silver, fontSize: 20, fontWeight: '800' },
  profileEmail: { color: colors.silverDim, marginTop: 4, fontSize: 14 },
  profileStatus: { color: colors.neonRed, marginTop: 6, fontSize: 13, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  statNumber: { color: colors.neonRed, fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.silverDim, marginTop: 4, fontSize: 12 },
  friendCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  friendAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: { color: colors.silver, fontSize: 18, fontWeight: '800' },
  friendInfo: { flex: 1, marginLeft: 12 },
  friendName: { color: colors.silver, fontSize: 16, fontWeight: '700' },
  friendRole: { color: colors.silverDim, marginTop: 2, fontSize: 13 },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.silverDim,
  },
  statusOnline: { backgroundColor: colors.neonRed },
  groupCard: {
    flexDirection: 'row',
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    alignItems: 'center',
  },
  groupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupIconText: { color: colors.silver, fontSize: 20, fontWeight: '900' },
  groupInfo: { flex: 1, marginLeft: 12 },
  groupName: { color: colors.silver, fontSize: 16, fontWeight: '700' },
  groupMeta: { color: colors.silverDim, marginTop: 2, fontSize: 13 },
});
