import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import { HomeScreen } from '../screens/HomeScreen';
import { OfflineMeshChat } from '../screens/OfflineMeshChat';
import { ChatScreen } from '../screens/ChatScreen';
import { BuzzleFooter } from '../components/BuzzleFooter';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator();

export function MainTabs() {
  return (
    <View style={styles.wrap}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.bgPanel,
            borderTopColor: colors.border,
            height: 58,
            paddingBottom: 8,
            paddingTop: 8,
          },
          tabBarActiveTintColor: colors.silver,
          tabBarInactiveTintColor: colors.silverDim,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{ tabBarLabel: 'Tactical SOS' }}
        />
        <Tab.Screen
          name="OfflineMeshChat"
          component={OfflineMeshChat}
          options={{ tabBarLabel: 'Offline Mesh' }}
        />
        <Tab.Screen
          name="Chat"
          component={ChatScreen}
          options={{ tabBarLabel: 'Offline Messages' }}
        />
      </Tab.Navigator>
      <BuzzleFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bgDeep },
});
