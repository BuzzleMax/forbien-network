import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useApp } from '../context/AppContext';
import { colors } from '../theme/colors';
import { SystemGateScreen } from '../screens/SystemGateScreen';
import { MainTabs } from './MainTabs';
import { EmergencyHQ } from '../screens/EmergencyHQ';
import { EmergencyMessageScreen } from '../screens/EmergencyMessageScreen';
import { EmergencyHistoryScreen } from '../screens/EmergencyHistoryScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bgDeep,
    card: colors.bgDeep,
    text: colors.silver,
    border: colors.border,
    primary: colors.accent,
  },
};

export function RootNavigator() {
  const { bootstrapDone, systemCheckPassed } = useApp();

  if (!bootstrapDone) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!systemCheckPassed ? (
          <Stack.Screen name="SystemGate" component={SystemGateScreen} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="EmergencyMessage"
              component={EmergencyMessageScreen}
              options={{ presentation: 'fullScreenModal' }}
            />
            <Stack.Screen
              name="EmergencyHistory"
              component={EmergencyHistoryScreen}
              options={{ presentation: 'card' }}
            />
            <Stack.Screen
              name="EmergencyHQ"
              component={EmergencyHQ}
              options={{ presentation: 'fullScreenModal' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
