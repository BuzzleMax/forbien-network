import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import * as mesh from '../api/meshLogic';

export function EmergencyMessageScreen({ navigation }) {
  const { nodeId, nodeRole } = useApp();
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('Loading...');
  const [isSending, setIsSending] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState(null);

  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        getLocation();
      } else if (status === 'denied') {
        setLocationStatus('Permission denied');
        Alert.alert(
          'Location Permission Required',
          'Location permission is needed to include GPS coordinates with your emergency. You can still send the emergency without location.',
          [{ text: 'OK' }]
        );
      } else {
        setLocationStatus('Unavailable');
      }
    } catch (error) {
      setLocationStatus('Error');
      console.error('Location permission error:', error);
    }
  };

  const getLocation = async () => {
    try {
      setLocationStatus('Acquiring...');
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const locData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };
      setLocation(locData);
      setLocationStatus('Available');
    } catch (error) {
      setLocationStatus('Unavailable');
      console.error('Location error:', error);
    }
  };

  const formatLocation = () => {
    if (!location) return 'Location: Unavailable';
    return `Location:\nLat ${location.latitude.toFixed(4)}\nLng ${location.longitude.toFixed(4)}`;
  };

  const formatTime = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSendEmergency = async () => {
    const messageText = message.trim();
    if (!messageText) {
      Alert.alert('Message Required', 'Please enter an emergency message.');
      return;
    }

    // Check if mesh is enabled
    const meshStatus = mesh.getMeshStatus();
    if (!meshStatus.enabled) {
      Alert.alert(
        'Mesh Not Enabled',
        'BLE mesh is not enabled. Please enable mesh mode to send emergency messages.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Enable Mesh', onPress: () => navigation.goBack() }
        ]
      );
      return;
    }

    // Check if there are any peers
    if (meshStatus.peers.length === 0) {
      Alert.alert(
        'No Nearby Peers',
        'No nearby ForBien devices detected. Your emergency will be queued locally and will automatically attempt to relay when a peer becomes available.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Send Anyway', onPress: () => proceedWithEmergency(messageText) }
        ]
      );
      return;
    }

    proceedWithEmergency(messageText);
  };

  const proceedWithEmergency = async (messageText) => {
    setIsSending(true);
    setDeliveryStatus('Creating emergency packet...');

    try {
      const result = await mesh.createOfflineEmergencyMessage({
        level: 'national',
        message: messageText,
        location: location,
      });

      if (result.ok && result.packet) {
        setDeliveryStatus('QUEUED — Waiting for relay');
        
        // Listen for delivery state changes
        const unsub = mesh.onPeerEvent((event, payload) => {
          if (event === 'delivery_state_change' && payload.packetId === result.packet.id) {
            setDeliveryStatus(payload.state);
          } else if (event === 'emergency_created' && payload.id === result.packet.id) {
            setDeliveryStatus('QUEUED — Ready for BLE transmission');
          } else if (event === 'mesh_not_enabled' && payload.packetId === result.packet.id) {
            setDeliveryStatus('QUEUED — Mesh not enabled');
          }
        });

        // Navigate to history after delay
        setTimeout(() => {
          unsub();
          navigation.navigate('EmergencyHistory');
        }, 2000);
      } else {
        setDeliveryStatus('Failed to create emergency');
        Alert.alert('Error', 'Failed to create emergency message.');
      }
    } catch (error) {
      setDeliveryStatus('Error');
      console.error('Emergency send error:', error);
      Alert.alert('Error', 'Failed to send emergency message.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <Pressable onPress={() => navigation.goBack()} style={styles.closeBtn}>
              <Text style={styles.closeText}>Cancel</Text>
            </Pressable>
            <Text style={styles.title}>SEND EMERGENCY</Text>
            <View style={styles.placeholder} />
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Destination</Text>
            <Text style={styles.infoValue}>FORBIEN-HQ-01</Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Your Node ID</Text>
            <Text style={styles.infoValue}>{nodeId}</Text>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Role</Text>
            <Text style={styles.infoValue}>{nodeRole}</Text>
          </View>

          <View style={styles.messageContainer}>
            <Text style={styles.messageLabel}>EMERGENCY MESSAGE</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Describe your emergency..."
              placeholderTextColor={colors.silverDim}
              style={styles.messageInput}
              multiline
              autoFocus
              maxLength={500}
            />
            <Text style={styles.charCount}>{message.length}/500</Text>
          </View>

          <View style={styles.locationCard}>
            <Text style={styles.locationLabel}>LOCATION STATUS</Text>
            <Text style={styles.locationStatus}>{locationStatus}</Text>
            {location && (
              <Text style={styles.locationCoords}>
                {formatLocation()}
              </Text>
            )}
            {!location && locationStatus !== 'Loading...' && (
              <Pressable onPress={getLocation} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry Location</Text>
              </Pressable>
            )}
          </View>

          {deliveryStatus && (
            <View style={styles.statusCard}>
              <Text style={styles.statusLabel}>DELIVERY STATUS</Text>
              <Text style={styles.statusValue}>{deliveryStatus}</Text>
            </View>
          )}

          <Pressable
            onPress={handleSendEmergency}
            style={[styles.sendBtn, isSending && styles.sendBtnDisabled]}
            disabled={isSending}
          >
            {isSending ? (
              <ActivityIndicator color={colors.silver} />
            ) : (
              <Text style={styles.sendBtnText}>SEND EMERGENCY</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Message will be encrypted and sent through offline BLE mesh to HQ
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  keyboardView: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 30 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  closeBtn: { padding: 8 },
  closeText: { color: colors.silverDim, fontWeight: '700' },
  title: { color: colors.neonRed, fontSize: 20, fontWeight: '900', letterSpacing: 1 },
  placeholder: { width: 60 },
  infoCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  infoLabel: { color: colors.silverDim, fontSize: 13, fontWeight: '600' },
  infoValue: { color: colors.silver, fontSize: 14, fontWeight: '700' },
  messageContainer: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.neonRed,
    marginBottom: 16,
  },
  messageLabel: { color: colors.neonRed, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  messageInput: {
    color: colors.silver,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  charCount: { color: colors.silverDim, fontSize: 11, textAlign: 'right', marginTop: 8 },
  locationCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  locationLabel: { color: colors.silverDim, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  locationStatus: { color: colors.silver, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  locationCoords: { color: colors.silverDim, fontSize: 13, lineHeight: 18 },
  retryBtn: { marginTop: 8, alignSelf: 'flex-start' },
  retryText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  statusCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: colors.accent,
    marginBottom: 16,
  },
  statusLabel: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  statusValue: { color: colors.silver, fontSize: 14, fontWeight: '700' },
  sendBtn: {
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
    marginBottom: 16,
  },
  sendBtnDisabled: { opacity: 0.6 },
  sendBtnText: { color: colors.silver, fontWeight: '900', letterSpacing: 2, fontSize: 16 },
  footer: { alignItems: 'center' },
  footerText: { color: colors.silverDim, fontSize: 12, textAlign: 'center', lineHeight: 16 },
});
