import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import { BleManager } from 'react-native-ble-plx';
import { colors } from '../theme/colors';

const BT_REQUIRED_MESSAGE = 'Bluetooth Hardware Required for Mesh Network.';

async function requestAndroidBluetoothPermissions() {
  if (Platform.OS !== 'android') return true;
  try {
    const { PermissionsAndroid } = require('react-native');
    const api = Platform.Version;
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      ]);
      return (
        res['android.permission.BLUETOOTH_CONNECT'] ===
          PermissionsAndroid.RESULTS.GRANTED &&
        res['android.permission.BLUETOOTH_SCAN'] ===
          PermissionsAndroid.RESULTS.GRANTED
      );
    }
    return true;
  } catch {
    return false;
  }
}

function isWifiNetwork(net) {
  if (!net) return false;
  const wifiEnum = Network.NetworkStateType?.WIFI;
  if (wifiEnum != null && net.type === wifiEnum) return true;
  if (net.type === 'WIFI') return true;
  return false;
}

export function SystemChecker({ onComplete }) {
  const [wifiOk, setWifiOk] = useState(false);
  const [locOk, setLocOk] = useState(false);
  const [btOk, setBtOk] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [btMessage, setBtMessage] = useState('Checking Bluetooth hardware...');
  const [showLocationModal, setShowLocationModal] = useState(false);
  const managerRef = useRef(null);
  const btSubscriptionRef = useRef(null);
  const simulatedRef = useRef(false);

  const enableSimulatedBluetoothMode = useCallback(() => {
    simulatedRef.current = true;
    setIsSimulated(true);
    setBtOk(true);
    setBtMessage('Bluetooth hardware check simulated (Expo Go compatibility mode).');
  }, []);

  const syncBluetoothStatus = useCallback(async () => {
    if (simulatedRef.current) {
      setBtOk(true);
      setBtMessage('Bluetooth hardware check simulated (Expo Go compatibility mode).');
      return;
    }
    if (!managerRef.current) return;
    const hasPermission = await requestAndroidBluetoothPermissions();
    if (!hasPermission) {
      setBtOk(false);
      setBtMessage(BT_REQUIRED_MESSAGE);
      return;
    }
    try {
      const state = await managerRef.current.state();
      const poweredOn = state === 'PoweredOn';
      setBtOk(poweredOn);
      setBtMessage(poweredOn ? 'Ready' : BT_REQUIRED_MESSAGE);
    } catch {
      setBtOk(false);
      setBtMessage(BT_REQUIRED_MESSAGE);
    }
  }, []);

  const refresh = useCallback(async () => {
    const net = await Network.getNetworkStateAsync();
    setWifiOk(isWifiNetwork(net));

    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) {
      setLocOk(false);
      return;
    }
    const servicesOn = await Location.hasServicesEnabledAsync();
    if (!servicesOn) {
      setLocOk(false);
      return;
    }
    try {
      await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLocOk(true);
    } catch {
      setLocOk(false);
    }
  }, []);

  useEffect(() => {
    try {
      managerRef.current = new BleManager();
      btSubscriptionRef.current = managerRef.current.onStateChange(
        (state) => {
          const poweredOn = state === 'PoweredOn';
          setBtOk(poweredOn);
          setBtMessage(poweredOn ? 'Ready' : BT_REQUIRED_MESSAGE);
        },
        true,
      );
      syncBluetoothStatus();
    } catch {
      enableSimulatedBluetoothMode();
    }
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        refresh();
        syncBluetoothStatus();
      }
    });
    return () => {
      sub.remove();
      btSubscriptionRef.current?.remove();
      btSubscriptionRef.current = null;
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, [enableSimulatedBluetoothMode, refresh, syncBluetoothStatus]);

  const requestLocation = async () => {
    setShowLocationModal(true);
  };

  const handleLocationPermission = async () => {
    setShowLocationModal(false);
    
    // Request foreground permissions first
    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    
    if (foregroundStatus !== 'granted') {
      setLocOk(false);
      return;
    }
    
    // Request background permissions for mesh routing
    try {
      const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
      if (backgroundStatus !== 'granted') {
        console.warn('Background location permission not granted, mesh routing may be limited');
      }
    } catch (error) {
      console.error('Background location permission error:', error);
    }
    
    await refresh();
  };

  const openSettings = () => Linking.openSettings();

  const bluetoothGatePassed = isSimulated ? true : btOk;
  const allReady = wifiOk && locOk && bluetoothGatePassed;

  return (
    <View style={styles.screen}>
      <Text style={styles.head}>System check</Text>
      <Text style={styles.sub}>
        Bluetooth, Wi‑Fi, and Location are required for Offline Mesh and emergency
        routing.
      </Text>

      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Wi‑Fi</Text>
            <Text style={styles.rowHint}>Active Wi‑Fi connection (mesh readiness)</Text>
          </View>
          <Text style={[styles.badge, wifiOk ? styles.badgeOk : styles.badgeBad]}>
            {wifiOk ? 'Ready' : 'Need Wi‑Fi'}
          </Text>
          {!wifiOk ? (
            <Pressable onPress={openSettings} style={styles.fix}>
              <Text style={styles.fixText}>Settings</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Location</Text>
            <Text style={styles.rowHint}>Permission + services + fix</Text>
          </View>
          <Text style={[styles.badge, locOk ? styles.badgeOk : styles.badgeBad]}>
            {locOk ? 'Ready' : 'Action'}
          </Text>
          {!locOk ? (
            <Pressable onPress={requestLocation} style={styles.fix}>
              <Text style={styles.fixText}>Allow</Text>
            </Pressable>
          ) : null}
          {!locOk ? (
            <Pressable onPress={openSettings} style={styles.fix}>
              <Text style={styles.fixText}>Services</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={[styles.row, styles.rowLast]}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Bluetooth</Text>
            <Text style={styles.rowHint}>{btMessage}</Text>
          </View>
          <Text
            style={[
              styles.badge,
              isSimulated || btOk ? styles.badgeBlueReady : styles.badgeBad,
            ]}
          >
            {isSimulated ? 'Simulated' : btOk ? 'Ready' : 'Required'}
          </Text>
          {!btOk && !isSimulated ? (
            <Pressable onPress={syncBluetoothStatus} style={styles.fix}>
              <Text style={styles.fixText}>Refresh</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={openSettings} style={styles.linkBtn}>
          <Text style={styles.linkText}>Open system settings</Text>
        </Pressable>
      </View>

      <Pressable
        disabled={!allReady}
        onPress={() => onComplete?.()}
        style={[styles.continue, !allReady && styles.continueDisabled]}
      >
        <Text style={styles.continueText}>Enter ForBien</Text>
      </Pressable>

      <Modal
        visible={showLocationModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLocationModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView style={styles.modalScroll}>
              <Text style={styles.modalTitle}>Location Permission Required</Text>
              <Text style={styles.modalText}>
                ForBien requires live background location tracking to enable mesh routing and emergency communication features.
              </Text>
              <Text style={styles.modalSubTitle}>Why is this required?</Text>
              <Text style={styles.modalText}>
                • Mesh routing uses your location to find and connect with nearby devices
              </Text>
              <Text style={styles.modalText}>
                • Emergency SOS messages include your precise coordinates for rapid response
              </Text>
              <Text style={styles.modalText}>
                • Background tracking ensures continuous mesh connectivity even when the app is not active
              </Text>
              <Text style={styles.modalText}>
                • Location data is encrypted and only shared within your authorized mesh network
              </Text>
              <Text style={styles.modalWarning}>
                ⚠️ Without background location permission, mesh routing and emergency features will not function properly.
              </Text>
            </ScrollView>
            <View style={styles.modalButtons}>
              <Pressable
                onPress={() => setShowLocationModal(false)}
                style={styles.modalButtonCancel}
              >
                <Text style={styles.modalButtonTextCancel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleLocationPermission}
                style={styles.modalButtonConfirm}
              >
                <Text style={styles.modalButtonTextConfirm}>Allow Location Access</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgDeep,
    paddingTop: 56,
    paddingHorizontal: 20,
  },
  head: {
    color: colors.silver,
    fontSize: 26,
    fontWeight: '800',
  },
  sub: { color: colors.silverDim, marginTop: 10, lineHeight: 20, fontSize: 14 },
  card: {
    marginTop: 28,
    backgroundColor: colors.bgPanel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: { borderBottomWidth: 0 },
  rowMain: { flex: 1, paddingRight: 8 },
  rowTitle: { color: colors.silver, fontWeight: '700', fontSize: 15 },
  rowHint: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 6,
  },
  badgeOk: { color: colors.success, backgroundColor: 'rgba(34,197,94,0.15)' },
  badgeBlueReady: { color: colors.accentMuted, backgroundColor: 'rgba(37,99,235,0.18)' },
  badgeBad: { color: colors.warning, backgroundColor: 'rgba(251,191,36,0.15)' },
  fix: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: 4,
    backgroundColor: colors.bgCard,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fixText: { color: colors.silverBlue, fontWeight: '700', fontSize: 12 },
  linkBtn: { marginTop: 8, alignSelf: 'flex-start' },
  linkText: { color: colors.accentMuted, fontWeight: '600' },
  continue: {
    marginTop: 28,
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  continueDisabled: { opacity: 0.35 },
  continueText: { color: colors.silver, fontWeight: '800', fontSize: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: colors.bgPanel,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 400,
    width: '100%',
    maxHeight: '80%',
  },
  modalScroll: {
    padding: 24,
  },
  modalTitle: {
    color: colors.silver,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 16,
  },
  modalSubTitle: {
    color: colors.silverBlue,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 20,
    marginBottom: 12,
  },
  modalText: {
    color: colors.silverDim,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  modalWarning: {
    color: colors.warning,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  modalButtons: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    alignItems: 'center',
  },
  modalButtonConfirm: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.accent,
    marginLeft: 8,
    alignItems: 'center',
  },
  modalButtonTextCancel: {
    color: colors.silverBlue,
    fontWeight: '700',
    fontSize: 15,
  },
  modalButtonTextConfirm: {
    color: colors.silver,
    fontWeight: '800',
    fontSize: 15,
  },
});
