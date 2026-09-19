import React, { useMemo, useState, useEffect } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';
import { useApp } from '../context/AppContext';
import * as mesh from '../api/meshLogic';
import {
  initializeGatewayManager,
  getGatewayManager,
  GATEWAY_TYPES,
  GATEWAY_STATES,
} from '../lib/emergencyGatewayManager';

const LEVELS = [
  { id: 'district', label: 'District HQ', sub: 'Local tactical command · local mesh priority' },
  { id: 'state', label: 'State HQ', sub: 'Regional coordination · multi-hop relay' },
  { id: 'national', label: 'National HQ', sub: 'Maximum emergency priority · network-wide broadcast' },
];

function resolveAutoTarget() {
  return 'national';
}

export function EmergencyHQ({ navigation }) {
  const {
    nodeRole,
    setNodeRole,
    nodeId,
    hqAlerts,
    setHqAlerts,
    setEmergencyPriority,
    createGroup,
    setMissionGroupId,
    setIsMeshMode,
    logTacticalPacket,
    peripheralSupported,
  } = useApp();

  const [mode, setMode] = useState('manual');
  const [level, setLevel] = useState('national');
  const [status, setStatus] = useState('idle');
  const [createdPacket, setCreatedPacket] = useState(null);
  const [hqReceivedMessages, setHqReceivedMessages] = useState([]);
  const [bleStatus, setBleStatus] = useState('disconnected');
  
  // Gateway state
  const [gatewayStatus, setGatewayStatus] = useState(null);
  const [showGatewayStatus, setShowGatewayStatus] = useState(false);

  // HQ Provisioning state
  const [provisionCode, setProvisionCode] = useState('');
  const [provisionError, setProvisionError] = useState('');
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [hqAuthStatus, setHqAuthStatus] = useState({ isHQ: false, provisioned: false });

  const isHQ = nodeRole === 'HQ';

  const checkHQAuth = async () => {
    const authStatus = await mesh.getHQAuthStatus();
    setHqAuthStatus(authStatus);
  };

  useEffect(() => {
    checkHQAuth();
    
    // Initialize gateway manager
    initializeGatewayManager().catch(() => {});
    
    if (isHQ) {
      loadHQMessages();
      mesh.createHQBroadcastHandshake().catch(() => {});
      const interval = setInterval(() => {
        mesh.createHQBroadcastHandshake().catch(() => {});
      }, 30000);
      return () => clearInterval(interval);
    }
    
    // Listen to gateway events
    const gatewayManager = getGatewayManager();
    const unsub = gatewayManager.onGatewayEvent((event, payload) => {
      if (event === 'sos_created') {
        setGatewayStatus(payload.gatewayStates);
        setShowGatewayStatus(true);
      } else if (event === 'gateway_state_changed') {
        setGatewayStatus(prev => ({
          ...prev,
          [payload.gatewayType]: payload.newState,
        }));
      } else if (event === 'sos_cleared') {
        setGatewayStatus(null);
        setShowGatewayStatus(false);
      }
    });
    
    return unsub;
  }, [isHQ]);

  const loadHQMessages = async () => {
    const messages = await mesh.loadHQReceivedMessages();
    setHqReceivedMessages(messages);
  };

  useEffect(() => {
    const unsub = mesh.onPeerEvent((event, payload) => {
      if (event === 'hq_delivery' && isHQ) {
        loadHQMessages();
      } else if (event === 'broadcast_started') {
        // Only set online if peripheral is actually supported
        if (peripheralSupported !== false) {
          setBleStatus('online');
        }
      } else if (event === 'broadcast_stopped') {
        setBleStatus('offline');
      } else if (event === 'hq_mode_activated') {
        // Only set online if peripheral is actually supported
        if (peripheralSupported !== false) {
          setBleStatus('online');
        }
      } else if (event === 'hq_peer_authenticated') {
        console.log('[HQ Auth Event] Verified HQ peer:', payload?.peerName);
      } else if (event === 'fake_hq_rejected') {
        console.warn('[HQ Auth Event] Fake HQ rejected:', payload?.peerName, payload?.reason);
      }
    });
    return unsub;
  }, [isHQ, peripheralSupported]);

  const handleSelectRole = async (targetRole) => {
    setProvisionError('');
    if (targetRole === 'HQ') {
      const res = await mesh.setNodeRole('HQ');
      if (!res.ok && res.unprovisioned) {
        setShowProvisionModal(true);
        return;
      }
    }
    setNodeRole(targetRole);
    checkHQAuth();
  };

  const handleProvisionHQ = async () => {
    setProvisionError('');
    const res = await mesh.provisionHQRole(provisionCode.trim());
    if (res.ok) {
      setProvisionCode('');
      setShowProvisionModal(false);
      await setNodeRole('HQ');
      checkHQAuth();
      loadHQMessages();
    } else {
      setProvisionError(res.error || 'Invalid provision code');
    }
  };

  const effectiveLevel = useMemo(() => {
    if (mode === 'auto') return resolveAutoTarget();
    return level;
  }, [mode, level]);

  const dispatchEmergencySOS = async () => {
    setStatus('dispatching');
    setEmergencyPriority(effectiveLevel);

    // Initialize gateway manager and create multi-gateway SOS
    const gatewayManager = getGatewayManager();
    
    const emergencyData = {
      message: `CRITICAL TACTICAL SOS — ${effectiveLevel.toUpperCase()} LEVEL`,
      level: effectiveLevel,
      note: `CRITICAL TACTICAL SOS — ${effectiveLevel.toUpperCase()} LEVEL`,
      location: null, // Will be filled by location service if available
      priority: effectiveLevel,
      type: 'SOS',
    };

    // Create canonical SOS event
    const sosResult = await gatewayManager.createSOS(emergencyData);
    
    if (!sosResult.ok) {
      setStatus('error');
      Alert.alert('SOS Error', sosResult.error);
      return;
    }

    // Process through all available gateways independently
    const canonicalId = sosResult.canonicalId;
    
    // BLE Gateway
    try {
      const bleResult = await gatewayManager.processBLEGateway();
      if (bleResult.ok) {
        // Send through actual BLE mesh
        const meshResult = await mesh.createOfflineEmergencyMessage({
          ...emergencyData,
          canonicalId,
        });
        
        if (meshResult.ok) {
          await gatewayManager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_DELIVERED_TO_HQ, {
            packetId: meshResult.packet.id,
          });
        } else {
          await gatewayManager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_FAILED, {
            error: meshResult.error,
          });
        }
      }
    } catch (error) {
      console.error('BLE gateway error:', error);
      await gatewayManager.updateGatewayState(GATEWAY_TYPES.BLE, GATEWAY_STATES.BLE_FAILED, {
        error: error.message,
      });
    }

    // SMS Gateway (if available)
    try {
      await gatewayManager.processSMSGateway('911', emergencyData.message);
    } catch (error) {
      console.error('SMS gateway error:', error);
    }

    // Call Gateway (user-triggered separately)
    // The call gateway is only initiated when user explicitly clicks the call button

    setCreatedPacket({
      id: canonicalId,
      canonicalId,
      gatewayStates: sosResult.gatewayStates,
      emergencyData,
    });
    setStatus('dispatched');
  };

  const handleClearAlert = async (alertId) => {
    const res = await mesh.processClearancePacket({
      messageId: alertId,
      hqUuid: 'FORBIEN-HQ-01',
    });
    if (res.ok) {
      setHqAlerts((prev) => prev.filter((a) => a.id !== alertId));
      // Also remove from HQ storage
      const updatedMessages = hqReceivedMessages.filter((m) => m.id !== alertId);
      setHqReceivedMessages(updatedMessages);
      await mesh.saveHQReceivedMessages(updatedMessages);
    }
  };

  const handleEmergencyCall = async () => {
    const gatewayManager = getGatewayManager();
    try {
      await gatewayManager.processCallGateway('911');
    } catch (error) {
      Alert.alert('Call Error', 'Failed to initiate emergency call');
    }
  };

  const getGatewayStateText = (gatewayType, state) => {
    const stateTexts = {
      [GATEWAY_TYPES.BLE]: {
        [GATEWAY_STATES.BLE_QUEUED]: 'BLE: Queued',
        [GATEWAY_STATES.BLE_RELAYING]: 'BLE: Relaying...',
        [GATEWAY_STATES.BLE_DELIVERED_TO_HQ]: 'BLE: Delivered to HQ',
        [GATEWAY_STATES.BLE_FAILED]: 'BLE: Failed',
      },
      [GATEWAY_TYPES.SMS]: {
        [GATEWAY_STATES.SMS_NOT_AVAILABLE]: 'SMS: Not Available',
        [GATEWAY_STATES.SMS_READY]: 'SMS: Ready',
        [GATEWAY_STATES.SMS_HANDED_TO_SMS_APP]: 'SMS: Handed to App',
        [GATEWAY_STATES.SMS_SENT]: 'SMS: Sent',
        [GATEWAY_STATES.SMS_FAILED]: 'SMS: Failed',
      },
      [GATEWAY_TYPES.CALL]: {
        [GATEWAY_STATES.CALL_AVAILABLE]: 'CALL: Available',
        [GATEWAY_STATES.CALL_DIALER_OPENED]: 'CALL: Dialer Opened',
        [GATEWAY_STATES.CALL_INITIATED]: 'CALL: Initiated',
        [GATEWAY_STATES.CALL_FAILED]: 'CALL: Failed',
      },
    };
    
    return stateTexts[gatewayType]?.[state] || `${gatewayType}: ${state}`;
  };

  const getGatewayStateColor = (state) => {
    const successStates = [
      GATEWAY_STATES.BLE_DELIVERED_TO_HQ,
      GATEWAY_STATES.SMS_HANDED_TO_SMS_APP,
      GATEWAY_STATES.SMS_SENT,
      GATEWAY_STATES.CALL_DIALER_OPENED,
      GATEWAY_STATES.CALL_INITIATED,
    ];
    
    const failureStates = [
      GATEWAY_STATES.BLE_FAILED,
      GATEWAY_STATES.SMS_FAILED,
      GATEWAY_STATES.CALL_FAILED,
      GATEWAY_STATES.SMS_NOT_AVAILABLE,
    ];
    
    if (successStates.includes(state)) return colors.neonGreen;
    if (failureStates.includes(state)) return colors.neonRed;
    return colors.silver;
  };

  const openMissionChat = () => {
    const id = createGroup(`Mission ${new Date().toISOString().slice(11, 19)}`);
    setMissionGroupId(id);
    setIsMeshMode(true);
    navigation.navigate('Main', {
      screen: 'Chat',
      params: { openGroupId: id },
    });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.top}>
          <Pressable onPress={() => navigation.goBack()} style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
          
          <Text style={styles.title}>{isHQ ? 'FORBIEN HQ' : 'OFFLINE TACTICAL SOS'}</Text>
          <Text style={styles.sub}>
            {isHQ
              ? 'Emergency Command Node · 100% Pure Offline BLE'
              : 'Peer-to-Peer BLE Broadcast · No Internet Required'}
          </Text>
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

        {/* MULTI-GATEWAY STATUS DISPLAY */}
        {showGatewayStatus && gatewayStatus && (
          <View style={styles.gatewayCard}>
            <Text style={styles.gatewayTitle}>EMERGENCY GATEWAY STATUS</Text>
            <Text style={styles.gatewaySub}>Canonical ID: {createdPacket?.canonicalId || 'Unknown'}</Text>
            
            <View style={styles.gatewayRow}>
              <Text style={[styles.gatewayText, { color: getGatewayStateColor(gatewayStatus[GATEWAY_TYPES.BLE]) }]}>
                {getGatewayStateText(GATEWAY_TYPES.BLE, gatewayStatus[GATEWAY_TYPES.BLE])}
              </Text>
            </View>
            
            <View style={styles.gatewayRow}>
              <Text style={[styles.gatewayText, { color: getGatewayStateColor(gatewayStatus[GATEWAY_TYPES.SMS]) }]}>
                {getGatewayStateText(GATEWAY_TYPES.SMS, gatewayStatus[GATEWAY_TYPES.SMS])}
              </Text>
            </View>
            
            <View style={styles.gatewayRow}>
              <Text style={[styles.gatewayText, { color: getGatewayStateColor(gatewayStatus[GATEWAY_TYPES.CALL]) }]}>
                {getGatewayStateText(GATEWAY_TYPES.CALL, gatewayStatus[GATEWAY_TYPES.CALL])}
              </Text>
            </View>
            
            <Pressable onPress={handleEmergencyCall} style={styles.callBtn}>
              <Text style={styles.callBtnText}>📞 EMERGENCY CALL (911)</Text>
            </Pressable>
          </View>
        )}

        {/* NODE IDENTITY & ROLE SELECTION */}
        <View style={styles.roleCard}>
          <Text style={styles.roleCardHead}>DEVICE ROLE CONFIGURATION</Text>
          <View style={styles.roleSelector}>
            <Pressable
              onPress={() => handleSelectRole('FIELD')}
              style={[styles.roleTab, nodeRole === 'FIELD' && styles.roleTabActive]}
            >
              <Text style={[styles.roleTabText, nodeRole === 'FIELD' && styles.roleTabTextActive]}>
                FIELD NODE
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleSelectRole('RELAY')}
              style={[styles.roleTab, nodeRole === 'RELAY' && styles.roleTabActive]}
            >
              <Text style={[styles.roleTabText, nodeRole === 'RELAY' && styles.roleTabTextActive]}>
                RELAY NODE
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleSelectRole('HQ')}
              style={[styles.roleTab, nodeRole === 'HQ' && styles.roleTabActiveHQ]}
            >
              <Text style={[styles.roleTabText, nodeRole === 'HQ' && styles.roleTabTextActiveHQ]}>
                EMERGENCY HQ
              </Text>
            </Pressable>
          </View>

          <View style={styles.identityDetails}>
            <Text style={styles.identityLabel}>Node ID: <Text style={styles.identityVal}>{nodeId}</Text></Text>
            <Text style={styles.identityLabel}>
              Role: <Text style={styles.identityVal}>{isHQ ? 'EMERGENCY HQ' : `${nodeRole} NODE`}</Text>
            </Text>
            {!isHQ && (
              <Text style={styles.identityLabel}>
                Destination: <Text style={styles.identityVal}>FORBIEN-HQ-01</Text>
              </Text>
            )}
            {isHQ && (
              <Text style={styles.identityLabel}>
                Auth: <Text style={[styles.identityVal, { color: hqAuthStatus.provisioned ? '#00ff80' : '#ff0033' }]}>
                  {hqAuthStatus.provisioned ? '🛡️ AUTHORIZED (Ed25519)' : '⚠️ UNPROVISIONED'}
                </Text>
              </Text>
            )}
          </View>
        </View>

        {/* HQ PROVISIONING PROMPT CARD */}
        {(showProvisionModal || (isHQ && !hqAuthStatus.provisioned)) && (
          <View style={styles.provisionCard}>
            <Text style={styles.provisionTitle}>🔐 HQ CRYPTOGRAPHIC PROVISIONING</Text>
            <Text style={styles.provisionSub}>
              Only authorized HQ devices (Mom's Phone) can assume identity FORBIEN-HQ-01. Enter deployment Secret Provision Code to unlock Ed25519 private key:
            </Text>
            <TextInput
              style={styles.provisionInput}
              value={provisionCode}
              onChangeText={setProvisionCode}
              placeholder="Enter HQ Provision Code..."
              placeholderTextColor={colors.silverDim}
              secureTextEntry
              autoCapitalize="none"
            />
            {provisionError ? <Text style={styles.provisionErrorText}>{provisionError}</Text> : null}
            <Pressable onPress={handleProvisionHQ} style={styles.provisionBtn}>
              <Text style={styles.provisionBtnText}>PROVISION & AUTHENTICATE HQ</Text>
            </Pressable>
            <Pressable onPress={() => { setShowProvisionModal(false); handleSelectRole('FIELD'); }} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>CANCEL (RETURN TO FIELD NODE)</Text>
            </Pressable>
          </View>
        )}

        {/* HQ COMMAND ALERTS DASHBOARD */}
        {isHQ ? (
          <View style={styles.hqDashboard}>
            <View style={styles.hqStatusRow}>
              <Text style={styles.hqStatusTitle}>FORBIEN HQ</Text>
              <View style={[styles.hqStatusBadge, { backgroundColor: bleStatus === 'online' ? 'rgba(0, 255, 128, 0.2)' : 'rgba(255, 0, 51, 0.2)' }]}>
                <Text style={[styles.hqStatusText, { color: bleStatus === 'online' ? '#00ff80' : '#ff0033' }]}>
                  {bleStatus === 'online' ? 'ONLINE' : 'OFFLINE'}
                </Text>
              </View>
            </View>
            
            <View style={styles.hqIdentityCard}>
              <Text style={styles.hqIdentityLabel}>HQ ID:</Text>
              <Text style={styles.hqIdentityValue}>FORBIEN-HQ-01</Text>

              <Text style={styles.hqIdentityLabel}>AUTHENTICATION STATUS:</Text>
              <Text style={[styles.hqIdentityValue, { color: hqAuthStatus.provisioned ? '#00ff80' : '#ff0033' }]}>
                {hqAuthStatus.provisioned ? '🛡️ AUTHORIZED HQ (Ed25519 Verified)' : '⚠️ UNPROVISIONED'}
              </Text>

              <Text style={styles.hqIdentityLabel}>PUBLIC KEY:</Text>
              <Text style={styles.hqPubKeyText} numberOfLines={1} ellipsisMode="middle">
                {mesh.AUTHORIZED_HQ_PUBLIC_KEY}
              </Text>
              
              <Text style={styles.hqIdentityLabel}>BLE STATUS:</Text>
              <Text style={[styles.hqIdentityValue, { color: bleStatus === 'online' ? '#00ff80' : '#ff0033' }]}>
                {bleStatus === 'online' ? 'ADVERTISING' : 'DISCONNECTED'}
              </Text>
            </View>

            <Text style={styles.dashboardTitle}>🚨 HQ EMERGENCY INBOX ({hqReceivedMessages.length})</Text>
            {hqReceivedMessages.length === 0 ? (
              <View style={styles.emptyAlerts}>
                <Text style={styles.emptyAlertsText}>NO EMERGENCY MESSAGES RECEIVED</Text>
                <Text style={styles.emptyAlertsSub}>
                  Listening on physical BLE mesh for incoming packets targeted to FORBIEN-HQ-01...
                </Text>
              </View>
            ) : (
              hqReceivedMessages.map((alert) => (
                <View key={alert.id} style={styles.alertCard}>
                  <Text style={styles.alertHeader}>EMERGENCY</Text>
                  
                  <Text style={styles.alertMessage}>"{alert.text || alert.meta?.message || 'No message text'}"</Text>
                  
                  <Text style={styles.alertTime}>{new Date(alert.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  
                  <Text style={styles.alertLocation}>
                    Location:
                    {alert.meta?.locationAvailable === false 
                      ? ' Unavailable'
                      : alert.meta?.latitude && alert.meta?.longitude
                      ? `\nLat ${alert.meta.latitude.toFixed(4)}\nLng ${alert.meta.longitude.toFixed(4)}`
                      : ' Unavailable'}
                  </Text>
                  
                  <View style={styles.alertDetails}>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Status:</Text>
                      <Text style={styles.detailValue}>DELIVERED TO HQ</Text>
                    </View>
                    
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Source:</Text>
                      <Text style={styles.detailValue}>{alert.sourceNodeId || alert.meta?.unitId || 'NODE-UNKNOWN'}</Text>
                    </View>
                    
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Destination:</Text>
                      <Text style={styles.detailValue}>{alert.destinationNodeId || 'FORBIEN-HQ-01'}</Text>
                    </View>
                    
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Priority:</Text>
                      <Text style={styles.detailValue}>{(alert.meta?.priority || alert.priority || 'national').toUpperCase()}</Text>
                    </View>
                    
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Hops:</Text>
                      <Text style={styles.detailValue}>{alert.hopCount} / {alert.maxHops || 5}</Text>
                    </View>
                    
                    {alert.routeHistory && alert.routeHistory.length > 0 && (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Route:</Text>
                        <Text style={styles.detailRoute}>{alert.routeHistory.join(' → ')}</Text>
                      </View>
                    )}
                  </View>

                  <Pressable
                    onPress={() => handleClearAlert(alert.id)}
                    style={styles.clearBtn}
                  >
                    <Text style={styles.clearBtnText}>CLEAR FROM HQ INBOX</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
        ) : (
          /* FIELD / RELAY SOS BROADCAST CONTROLS */
          <View>
            <View style={styles.modeRow}>
              <Pressable
                onPress={() => setMode('manual')}
                style={[styles.modeChip, mode === 'manual' && styles.modeChipOn]}
              >
                <Text style={styles.modeText}>Manual priority</Text>
              </Pressable>
              <Pressable
                onPress={() => setMode('auto')}
                style={[styles.modeChip, mode === 'auto' && styles.modeChipOn]}
              >
                <Text style={styles.modeText}>Auto escalate</Text>
              </Pressable>
            </View>

            {mode === 'manual' ? (
              <View style={styles.levels}>
                {LEVELS.map((L) => (
                  <Pressable
                    key={L.id}
                    onPress={() => setLevel(L.id)}
                    style={[styles.levelCard, level === L.id && styles.levelCardOn]}
                  >
                    <Text style={styles.levelTitle}>{L.label}</Text>
                    <Text style={styles.levelSub}>{L.sub}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.autoBox}>
                <Text style={styles.autoHead}>Escalation Ladder</Text>
                <Text style={styles.autoLine}>District → State → National</Text>
                <Text style={styles.autoHint}>
                  Auto mode defaults to <Text style={styles.bold}>National HQ</Text> for maximum priority broadcast.
                </Text>
              </View>
            )}

            <Pressable
              onPress={dispatchEmergencySOS}
              style={[styles.connect, status === 'dispatching' && styles.connectBusy]}
              disabled={status === 'dispatching'}
            >
              <Text style={styles.connectText}>
                {status === 'dispatching' ? 'GENERATING OFFLINE SOS…' : 'BROADCAST OFFLINE SOS'}
              </Text>
            </Pressable>

            {createdPacket ? (
              <View style={styles.statusBox}>
                <Text style={styles.statusHead}>EMERGENCY SOS ACTIVATED</Text>
                <Text style={styles.statusBody}>Canonical ID: {createdPacket.canonicalId || createdPacket.id}</Text>
                <Text style={styles.statusSub}>Source: {nodeId} → Target: FORBIEN-HQ-01</Text>
                <Text style={styles.statusSub}>
                  Level: {createdPacket.emergencyData?.priority?.toUpperCase() || effectiveLevel.toUpperCase()} · AES-256-GCM
                </Text>
                <Text style={styles.statusSub}>
                  Location: {createdPacket.emergencyData?.location ? 'GPS Available' : 'GPS Unavailable'}
                </Text>
                
                {/* Gateway Status */}
                {gatewayStatus && (
                  <View style={styles.gatewayStatusMini}>
                    <Text style={styles.gatewayStatusText}>
                      BLE: {getGatewayStateText(GATEWAY_TYPES.BLE, gatewayStatus[GATEWAY_TYPES.BLE])}
                    </Text>
                    <Text style={styles.gatewayStatusText}>
                      SMS: {getGatewayStateText(GATEWAY_TYPES.SMS, gatewayStatus[GATEWAY_TYPES.SMS])}
                    </Text>
                    <Text style={styles.gatewayStatusText}>
                      CALL: {getGatewayStateText(GATEWAY_TYPES.CALL, gatewayStatus[GATEWAY_TYPES.CALL])}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        )}

        <Pressable onPress={openMissionChat} style={styles.mission}>
          <Text style={styles.missionTitle}>Offline Mesh Messages</Text>
          <Text style={styles.missionSub}>Open encrypted offline mesh messaging · BLE Active</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgDeep },
  scroll: { paddingBottom: 30 },
  top: { paddingHorizontal: 16, paddingBottom: 12 },
  close: { alignSelf: 'flex-end', marginBottom: 8 },
  closeText: { color: colors.neonRed, fontWeight: '700' },
  title: {
    color: colors.neonRed,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
  },
  sub: { color: colors.silverDim, marginTop: 6, fontSize: 13 },
  roleCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  roleCardHead: { color: colors.silverDim, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  roleSelector: { flexDirection: 'row', marginTop: 10, justifyContent: 'space-between' },
  roleTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgCard,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  roleTabActive: { borderColor: colors.silver, backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  roleTabActiveHQ: { borderColor: colors.neonRed, backgroundColor: 'rgba(255, 0, 51, 0.2)' },
  roleTabText: { color: colors.silverDim, fontWeight: '700', fontSize: 11 },
  roleTabTextActive: { color: colors.silver, fontWeight: '900' },
  roleTabTextActiveHQ: { color: colors.neonRed, fontWeight: '900' },
  identityDetails: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  identityLabel: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
  identityVal: { color: colors.silver, fontWeight: '800' },
  hqDashboard: { paddingHorizontal: 16, marginTop: 4 },
  hqStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  hqStatusTitle: { color: colors.neonRed, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  hqStatusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  hqStatusText: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  hqIdentityCard: { padding: 14, borderRadius: 12, backgroundColor: colors.bgPanel, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  hqIdentityLabel: { color: colors.silverDim, fontSize: 11, fontWeight: '700', marginTop: 6 },
  hqIdentityValue: { color: colors.silver, fontSize: 13, fontWeight: '800', marginTop: 2 },
  hqPubKeyText: { color: colors.silverDim, fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  warningCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    borderWidth: 1,
    borderColor: '#FFA500',
  },
  warningTitle: { color: '#FFA500', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  warningText: { color: colors.silver, fontSize: 13, lineHeight: 18, marginTop: 6 },
  warningSub: { color: colors.silverDim, fontSize: 12, marginTop: 4 },
  provisionCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 0, 51, 0.1)',
    borderWidth: 1,
    borderColor: colors.neonRed,
  },
  provisionTitle: { color: colors.neonRed, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  provisionSub: { color: colors.silverDim, fontSize: 12, lineHeight: 18, marginTop: 6 },
  provisionInput: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bgDeep,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.silver,
    fontSize: 13,
  },
  provisionErrorText: { color: colors.neonRed, fontSize: 12, fontWeight: '700', marginTop: 6 },
  provisionBtn: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
  },
  provisionBtnText: { color: colors.silver, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  cancelBtn: { marginTop: 8, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { color: colors.silverDim, fontSize: 12, fontWeight: '700' },
  dashboardTitle: { color: colors.neonRed, fontSize: 16, fontWeight: '900', letterSpacing: 1, marginBottom: 12 },
  emptyAlerts: {
    padding: 24,
    borderRadius: 14,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyAlertsText: { color: colors.silver, fontWeight: '800', fontSize: 14 },
  emptyAlertsSub: { color: colors.silverDim, fontSize: 12, textAlign: 'center', marginTop: 6 },
  alertCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.neonRed,
    marginBottom: 12,
  },
  alertHeader: { color: colors.neonRed, fontSize: 12, fontWeight: '900', letterSpacing: 1, marginBottom: 12 },
  alertMessage: { color: colors.silver, fontSize: 16, fontWeight: '600', lineHeight: 22, marginBottom: 12 },
  alertTime: { color: colors.silverDim, fontSize: 14, fontWeight: '700', marginBottom: 8 },
  alertLocation: { color: colors.silverDim, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  alertDetails: { marginBottom: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  detailLabel: { color: colors.silverDim, fontSize: 12, fontWeight: '600' },
  detailValue: { color: colors.silver, fontSize: 12, fontWeight: '700' },
  detailRoute: { color: colors.neonRed, fontSize: 12, fontWeight: '700' },
  clearBtn: { marginTop: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255, 0, 51, 0.2)', borderWidth: 1, borderColor: colors.neonRed, alignItems: 'center' },
  clearBtnText: { color: colors.neonRed, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  modeRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  modeChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
    marginRight: 10,
  },
  modeChipOn: { borderColor: colors.neonRed, backgroundColor: 'rgba(255, 0, 51, 0.15)' },
  modeText: { color: colors.silver, fontWeight: '700', fontSize: 13 },
  levels: { paddingHorizontal: 16 },
  levelCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
    marginBottom: 10,
  },
  levelCardOn: { borderColor: colors.neonRed, backgroundColor: 'rgba(255, 0, 51, 0.12)' },
  levelTitle: { color: colors.silver, fontSize: 17, fontWeight: '800' },
  levelSub: { color: colors.silverDim, marginTop: 6, fontSize: 12, lineHeight: 18 },
  autoBox: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
  },
  autoHead: { color: colors.silver, fontWeight: '800', fontSize: 15 },
  autoLine: { color: colors.neonRed, marginTop: 8, fontWeight: '700' },
  autoHint: { color: colors.silverDim, marginTop: 10, lineHeight: 20, fontSize: 13 },
  bold: { color: colors.silver, fontWeight: '800' },
  connect: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingVertical: 18,
    borderRadius: 14,
    backgroundColor: colors.neonRed,
    alignItems: 'center',
  },
  connectBusy: { opacity: 0.7 },
  connectText: { color: colors.silver, fontWeight: '900', letterSpacing: 2, fontSize: 14 },
  statusBox: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.neonRed,
  },
  statusHead: { color: colors.neonRed, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  statusBody: { color: colors.silver, marginTop: 6, fontWeight: '700', fontSize: 13 },
  statusSub: { color: colors.silverDim, marginTop: 4, fontSize: 12 },
  mission: {
    marginHorizontal: 16,
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(255, 0, 51, 0.12)',
  },
  missionTitle: { color: colors.silver, fontWeight: '900', fontSize: 16 },
  missionSub: { color: colors.silverDim, marginTop: 6, fontSize: 12, lineHeight: 18 },
  gatewayCard: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.neonRed,
  },
  gatewayTitle: { color: colors.neonRed, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  gatewaySub: { color: colors.silverDim, marginTop: 4, fontSize: 11 },
  gatewayRow: { marginTop: 8 },
  gatewayText: { fontSize: 12, fontWeight: '700' },
  callBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.neonGreen,
    alignItems: 'center',
  },
  callBtnText: { color: colors.bgDeep, fontWeight: '900', letterSpacing: 1, fontSize: 13 },
  gatewayStatusMini: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  gatewayStatusText: { color: colors.silverDim, fontSize: 11, marginTop: 2 },
});
