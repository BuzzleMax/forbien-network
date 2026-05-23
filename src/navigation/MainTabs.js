import React, { useEffect, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import * as Network from 'expo-network';
import { HomeScreen } from '../screens/HomeScreen';
import { SocialHub } from '../screens/SocialHub';
import { OfflineMeshChat } from '../screens/OfflineMeshChat';
import { BuzzleFooter } from '../components/BuzzleFooter';
import { colors } from '../theme/colors';

const Tab = createBottomTabNavigator();

export function MainTabs() {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const checkConnection = async () => {
      const networkState = await Network.getNetworkStateAsync();
      setIsConnected(networkState.isConnected);
    };

    checkConnection();
    const interval = setInterval(checkConnection, 5000);

    return () => clearInterval(interval);
  }, []);

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
          name="SocialHub"
          component={SocialHub}
          options={{ tabBarLabel: 'Social Hub' }}
        />
        <Tab.Screen
          name="OfflineMeshChat"
          component={OfflineMeshChat}
          options={{
            tabBarLabel: 'Offline Mesh',
            tabBarItemStyle: isConnected ? { display: 'none' } : undefined,
          }}
        />
      </Tab.Navigator>
      <BuzzleFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bgDeep },
});
