/**
 * Real Physical BLE Transport & Offline Mesh Engine for ForBien
 * Implements BLE Central & Peripheral GATT Server communication,
 * MTU fragmentation/reassembly, duplicate protection, finite TTL routing,
 * and delivery state tracking over physical Bluetooth Low Energy.
 */

let BleManager = null;
try {
  BleManager = require('react-native-ble-plx').BleManager;
} catch {
  // Running in Node / unit test environment without native BLE drivers
}

let AsyncStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};
try {
  AsyncStorage = require('@react-native-async-storage/async-storage').default || AsyncStorage;
} catch {}

let Location = null;
try {
  Location = require('expo-location');
} catch {}
import { compressSOSData, decompressSOSData } from '../lib/compression.js';
import {
  encryptPayloadAESGCM,
  decryptPayloadAESGCM,
  DEFAULT_MESH_SECRET,
  isLegacyXORPacket,
  handleLegacyXORPacket,
  verifyBLEPayloadBudget,
  uint8ToBase64,
  base64ToUint8,
  AUTHORIZED_HQ_PUBLIC_KEY,
  getAuthorizedHQPublicKey,
  deriveHQKeyFromProvisionCode,
  generateHQKeyPair,
  signHQAuthenticationToken,
  verifyHQAuthenticationToken,
  createHQAuthHandshake,
  verifyHQAuthHandshake,
  hexToUint8,
  uint8ToHex,
  sha256JS,
} from '../lib/crypto.js';
import {
  saveHQPrivateKey as keystoreSaveHQPrivateKey,
  getHQPrivateKey as keystoreGetHQPrivateKey,
  hasHQPrivateKey as keystoreHasHQPrivateKey,
  removeHQPrivateKey as keystoreRemoveHQPrivateKey,
} from '../lib/hqKeyManager.js';
import * as blePeripheral from './blePeripheralNative.js';

const listeners = new Set();
let meshEnabled = false;
let bleManager = null;

/** @type {Map<string, {id: string, name?: string, rssi?: number, device?: any}>} */
const peers = new Map();
const outboundQueue = [];
/** @type {Map<string, any>} - Persistent message queue keyed by message ID */
const persistentMessageQueue = new Map();

/** Duplicate protection cache: messageId -> processedTimestamp */
const processedMessageIds = new Map();
const DUP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour expiration for duplicate cache

/** Reassembly buffers for fragmented BLE packets: messageId -> { total, received: Map<seq, data> } */
const incomingFragmentBuffers = new Map();

// BLE Service UUID and Characteristic UUID for ForBien mesh
export const MESH_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
export const MESH_CHARACTERISTIC_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

// Max BLE Characteristic payload fragment size (safe budget inside 244B MTU)
const MAX_FRAGMENT_PAYLOAD_BYTES = 140;

// Throttling intervals for battery preservation
const ADVERTISING_THROTTLE_MS = 30000; // 30-second throttling for BLE advertising
let lastAdvertisingTime = 0;

// Delivery state enum
export const DELIVERY_STATES = {
  CREATED: 'CREATED',
  QUEUED: 'QUEUED',
  CONNECTING: 'CONNECTING',
  TRANSMITTING: 'TRANSMITTING',
  TRANSMITTED: 'TRANSMITTED',
  RECEIVED: 'RECEIVED',
  RELAYING: 'RELAYING',
  DELIVERED: 'DELIVERED',
  DELIVERED_TO_HQ: 'DELIVERED_TO_HQ',
  FAILED: 'FAILED',
};

// Authorized Headquarters UUIDs for clearance packet validation
const AUTHORIZED_HQ_UUIDS = new Set([
  'FORBIEN-HQ-01',
  'hq-command-primary-001',
  'hq-command-secondary-002',
  'hq-emergency-center-003',
  'hq-ops-central-004',
]);

// Master Mesh Secret Key (derived via HKDF/SHA-256 into 256-bit AES-GCM key)
let currentMeshSecret = DEFAULT_MESH_SECRET;

export const HQ_NODE_ID = 'FORBIEN-HQ-01';
export const NODE_ROLES = {
  FIELD: 'FIELD',
  RELAY: 'RELAY',
  HQ: 'HQ',
};

const NODE_ROLE_KEY = 'forbien_node_role';
const LOCAL_NODE_ID_KEY = 'forbien_local_node_id';
const HQ_PROVISIONED_KEY = 'forbien_hq_provisioned';

let localFieldNodeId = `NODE-${Math.floor(0x1000 + Math.random() * 0xf000).toString(16).toUpperCase()}`;
let currentRole = NODE_ROLES.FIELD;

// Tracks which remote NodeIDs have been cryptographically verified as real HQ
const authenticatedHQPeers = new Map(); // peerId -> { timestamp, handshake }

// This device's HQ auth status
let hqProvisionedAndVerified = false;

/**
 * Initialize Node Identity from AsyncStorage
 */
export async function loadNodeIdentity() {
  try {
    const savedRole = await AsyncStorage.getItem(NODE_ROLE_KEY);
    if (savedRole && NODE_ROLES[savedRole]) {
      currentRole = savedRole;
    }
    const savedId = await AsyncStorage.getItem(LOCAL_NODE_ID_KEY);
    if (savedId) {
      localFieldNodeId = savedId;
    } else {
      await AsyncStorage.setItem(LOCAL_NODE_ID_KEY, localFieldNodeId);
    }
    // Restore HQ provisioned state
    const savedHQProvisioned = await AsyncStorage.getItem(HQ_PROVISIONED_KEY);
    if (currentRole === NODE_ROLES.HQ || savedHQProvisioned === 'true') {
      const hasPrivKey = await keystoreHasHQPrivateKey();
      hqProvisionedAndVerified = hasPrivKey;
      if (!hasPrivKey) {
        // Private key not in Keystore — demote to FIELD and wipe unverified state for safety
        currentRole = NODE_ROLES.FIELD;
        hqProvisionedAndVerified = false;
        await AsyncStorage.setItem(NODE_ROLE_KEY, NODE_ROLES.FIELD);
        await AsyncStorage.removeItem(HQ_PROVISIONED_KEY);
        console.warn('[HQ Security] Private key not found in Keystore after restart — demoted to FIELD');
      }
    }
  } catch (err) {
    console.warn('Failed to load node identity:', err.message);
  }
  return getLocalNodeId();
}

/**
 * Get current logical Node ID
 * @returns {string}
 */
export function getLocalNodeId() {
  if (currentRole === NODE_ROLES.HQ) {
    return HQ_NODE_ID;
  }
  return localFieldNodeId;
}

/**
 * Get current Node Role
 * @returns {string}
 */
export function getNodeRole() {
  return currentRole;
}

/**
 * Set current Node Role — FOR TEST ENVIRONMENT ONLY.
 * In production, use provisionHQRole() which requires cryptographic proof.
 * Direct setNodeRole('HQ') is permitted only when not running on Android (tests/dev).
 * @param {string} newRole - 'FIELD' | 'RELAY' | 'HQ'
 */
export async function setNodeRole(newRole) {
  if (!NODE_ROLES[newRole]) return { ok: false, error: 'Invalid node role' };

  // Require valid HQ private key in Keystore to assume HQ role
  if (newRole === NODE_ROLES.HQ) {
    const hasPrivKey = await keystoreHasHQPrivateKey();
    if (!hasPrivKey) {
      return { ok: false, unprovisioned: true, error: 'HQ role requires cryptographic provisioning via provisionHQRole() with valid HQ private key' };
    }
    hqProvisionedAndVerified = true;
  }
  
  const previousRole = currentRole;
  currentRole = newRole;
  
  try {
    await AsyncStorage.setItem(NODE_ROLE_KEY, newRole);
  } catch (err) {
    console.warn('Failed to persist node role:', err.message);
  }

  // Reinitialize BLE when switching to/from HQ to ensure proper advertising
  if (meshEnabled && (previousRole !== newRole)) {
    try {
      // Restart BLE advertising with new node identity
      await stopBroadcast();
      const broadcastResult = await startBroadcast();
      
      if (newRole === NODE_ROLES.HQ) {
        console.log('[HQ Mode] Reinitialized BLE advertising as FORBIEN-HQ-01');
        emit('hq_mode_activated', { nodeId: getLocalNodeId() });
      } else {
        console.log(`[Node Mode] Reinitialized BLE advertising as ${getLocalNodeId()}`);
      }
    } catch (err) {
      console.warn('Failed to reinitialize BLE after role change:', err.message);
    }
  }

  emit('role_changed', { role: currentRole, nodeId: getLocalNodeId() });
  return { ok: true, role: currentRole, nodeId: getLocalNodeId() };
}

/**
 * Provision this device as the authorized ForBien HQ.
 * The caller supplies the 64-hex Ed25519 private key for the authorized HQ.
 * The key is validated against AUTHORIZED_HQ_PUBLIC_KEY, then stored in
 * Android Keystore. The raw private key must never appear in source or logs.
 * Only ONE authorized HQ is recognized — FORBIEN-HQ-01.
 * @param {string} privateKeyHex - 64-character hex Ed25519 private key seed
 * @returns {Promise<{ok: boolean, nodeId?: string, publicKey?: string, error?: string}>}
 */
export async function provisionHQRole(provisionCode) {
  const derivedKeys = deriveHQKeyFromProvisionCode(provisionCode);
  if (!derivedKeys.ok) {
    return { ok: false, error: derivedKeys.error || 'Invalid provisioning code' };
  }

  if (derivedKeys.publicKeyHex.toLowerCase() !== getAuthorizedHQPublicKey().toLowerCase()) {
    return { ok: false, error: 'Derived public key does not match authorized deployment key' };
  }

  // Store private key securely in Android Keystore
  await keystoreSaveHQPrivateKey(derivedKeys.privateKeyHex);

  hqProvisionedAndVerified = true;
  currentRole = NODE_ROLES.HQ;

  try {
    await AsyncStorage.setItem(NODE_ROLE_KEY, NODE_ROLES.HQ);
    await AsyncStorage.setItem(HQ_PROVISIONED_KEY, 'true');
  } catch (err) {
    console.warn('Failed to persist HQ provision state:', err.message);
  }

  // Start BLE advertising as ForBien-HQ
  if (meshEnabled) {
    try {
      await stopBroadcast();
      await startBroadcast();
    } catch (err) {
      console.warn('Failed to start HQ broadcast after provisioning:', err.message);
    }
  }

  emit('hq_provisioned', { nodeId: HQ_NODE_ID, publicKey: getAuthorizedHQPublicKey() });
  emit('role_changed', { role: NODE_ROLES.HQ, nodeId: HQ_NODE_ID, authorized: true });

  return {
    ok: true,
    nodeId: HQ_NODE_ID,
    publicKey: getAuthorizedHQPublicKey(),
    message: 'This device is now provisioned as FORBIEN-HQ-01',
  };
}

/**
 * Get current HQ authentication status
 * @returns {{ isHQ: boolean, provisioned: boolean, nodeId: string, publicKey: string | null }}
 */
export function getHQAuthStatus() {
  return {
    isHQ: currentRole === NODE_ROLES.HQ,
    provisioned: hqProvisionedAndVerified,
    nodeId: getLocalNodeId(),
    publicKey: currentRole === NODE_ROLES.HQ && hqProvisionedAndVerified ? getAuthorizedHQPublicKey() : null,
    authorizedHQPublicKey: getAuthorizedHQPublicKey(),
  };
}

/**
 * Verify that a remote peer claiming to be FORBIEN-HQ-01 is cryptographically authentic.
 * @param {object} handshake - Received HQ_AUTH_HANDSHAKE packet
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyRemoteHQAuthentication(handshake) {
  return verifyHQAuthHandshake(handshake);
}

/**
 * Create an HQ authentication handshake for BLE broadcast.
 * Only works if this device has a stored authorized HQ private key.
 * @returns {Promise<object | null>}
 */
export async function createHQBroadcastHandshake() {
  if (currentRole !== NODE_ROLES.HQ) return null;
  const privKey = await keystoreGetHQPrivateKey();
  if (!privKey) return null;
  try {
    return createHQAuthHandshake(privKey);
  } catch {
    return null;
  }
}

let nativeWriteUnsub = null;
let nativeCentralConnUnsub = null;
let isProcessingQueue = false;

/**
 * Update active mesh secret key
 * @param {string} newSecret 
 */
export function setMeshSecretKey(newSecret) {
  if (newSecret && typeof newSecret === 'string') {
    currentMeshSecret = newSecret;
  }
}

/**
 * Get active mesh secret key
 * @returns {string}
 */
export function getMeshSecretKey() {
  return currentMeshSecret;
}

function emit(event, payload) {
  listeners.forEach((fn) => {
    try {
      fn(event, payload);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Check if a message ID has already been processed by this node
 * @param {string} messageId 
 * @returns {boolean}
 */
export function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  
  // Clean up expired entries in duplicate cache
  for (const [id, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > DUP_CACHE_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }

  if (processedMessageIds.has(messageId)) {
    return true;
  }
  
  // Mark as processed
  processedMessageIds.set(messageId, now);
  return false;
}

/**
 * Fragment a mesh packet into MTU-compliant safe BLE chunks
 * Chunk format: FRAG|messageId|seq|total|dataBase64
 * @param {object} packet 
 * @returns {string[]} Array of formatted fragment strings
 */
export function fragmentPacket(packet) {
  const jsonStr = JSON.stringify(packet);
  let fullBase64 = '';
  try {
    if (typeof btoa === 'function') {
      fullBase64 = btoa(unescape(encodeURIComponent(jsonStr)));
    } else {
      fullBase64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
    }
  } catch {
    fullBase64 = jsonStr;
  }

  const totalLength = fullBase64.length;
  const totalFragments = Math.ceil(totalLength / MAX_FRAGMENT_PAYLOAD_BYTES);
  const msgId = packet.id || `msg_${Date.now()}`;
  const fragments = [];

  for (let i = 0; i < totalFragments; i++) {
    const start = i * MAX_FRAGMENT_PAYLOAD_BYTES;
    const end = Math.min(start + MAX_FRAGMENT_PAYLOAD_BYTES, totalLength);
    const chunkBase64 = fullBase64.substring(start, end);
    const seq = i + 1;
    const fragmentStr = `FRAG|${msgId}|${seq}|${totalFragments}|${chunkBase64}`;
    fragments.push(fragmentStr);
  }

  return fragments;
}

/**
 * Reassemble an incoming BLE fragment string
 * @param {string} fragStr 
 * @returns {object|null} Reassembled packet object if complete, or null if incomplete/corrupted
 */
export function reassembleFragment(fragStr) {
  if (typeof fragStr !== 'string' || !fragStr.startsWith('FRAG|')) {
    return null;
  }

  const parts = fragStr.split('|');
  if (parts.length < 5) return null;

  const [prefix, msgId, seqStr, totalStr, chunkBase64] = parts;
  const seq = parseInt(seqStr, 10);
  const total = parseInt(totalStr, 10);

  if (isNaN(seq) || isNaN(total) || seq < 1 || seq > total) {
    return null;
  }

  if (!incomingFragmentBuffers.has(msgId)) {
    incomingFragmentBuffers.set(msgId, {
      total,
      received: new Map(),
      createdAt: Date.now(),
    });
  }

  const buffer = incomingFragmentBuffers.get(msgId);
  buffer.received.set(seq, chunkBase64);

  // Check if all fragments have arrived
  if (buffer.received.size === total) {
    let combinedBase64 = '';
    for (let i = 1; i <= total; i++) {
      combinedBase64 += buffer.received.get(i) || '';
    }

    incomingFragmentBuffers.delete(msgId);

    // Decode Base64 to string
    let decodedJsonStr = '';
    try {
      if (typeof atob === 'function') {
        decodedJsonStr = decodeURIComponent(escape(atob(combinedBase64)));
      } else {
        decodedJsonStr = Buffer.from(combinedBase64, 'base64').toString('utf-8');
      }
    } catch {
      decodedJsonStr = combinedBase64;
    }

    try {
      return JSON.parse(decodedJsonStr);
    } catch (e) {
      console.error('[BLE Reassembly Error] Failed to parse reassembled JSON:', e);
      return null;
    }
  }

  return null;
}

/**
 * Initialize BLE manager
 */
function initBleManager() {
  if (!bleManager) {
    try {
      bleManager = new BleManager();
    } catch (e) {
      bleManager = {
        state: async () => 'PoweredOn',
        startDeviceScan: () => {},
        stopDeviceScan: () => {},
        startAdvertising: async () => {},
        stopAdvertising: async () => {},
      };
    }
  }
  return bleManager;
}

/**
 * Start BLE scanning to discover nearby ForBien devices
 */
export async function startScan() {
  const manager = initBleManager();
  
  try {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      return { ok: false, error: 'Bluetooth not powered on' };
    }

    const scanOptions = { allowDuplicates: true, scanMode: 2 }; // ScanMode.LowLatency
    
    // First scan with service filter, or fallback to scanning null to catch devices whose adv payload doesn't fit UUID
    manager.startDeviceScan(null, scanOptions, (error, device) => {
      if (error) {
        console.error('Scan error:', error);
        emit('scan_error', { error: error.message });
        return;
      }

      if (device) {
        const deviceName = device.name || device.localName || '';
        const serviceUuids = device.serviceUUIDs || [];
        const isForBienService = serviceUuids.some(u => u && u.toLowerCase() === MESH_SERVICE_UUID.toLowerCase());
        const isForBienName = deviceName.includes('ForBien') || deviceName.includes('FORBIEN');

        if (isForBienService || isForBienName) {
          const peerId = device.id;
          const isHQDevice = deviceName.includes('ForBien-HQ') || deviceName.includes('FORBIEN-HQ');
          
          const peerData = {
            id: peerId,
            name: deviceName || `Unit ${peerId.substring(0, 6)}`,
            rssi: device.rssi,
            device: device,
            isHQ: isHQDevice,
            serviceUUIDs: serviceUuids
          };

        const existing = peers.get(peerId);
        if (!existing || existing.rssi !== device.rssi) {
          peers.set(peerId, peerData);
          emit('peer_discovered', peerData);
          emit('mesh_state', { enabled: meshEnabled, peers: peers.size });
          
          // Emit HQ discovery event
          if (isHQDevice) {
            emit('hq_discovered', peerData);
          }
          
          // Trigger queue processing when new peer discovered
          processOutboundQueue();
        }
        }
      }
    });

    return { ok: true };
  } catch (error) {
    console.error('Failed to start scan:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Stop BLE scanning
 */
export async function stopScan() {
  const manager = initBleManager();
  try {
    manager.stopDeviceScan();
    return { ok: true };
  } catch (error) {
    console.error('Failed to stop scan:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Start broadcasting/advertising GATT Server to make device discoverable
 */
export async function startBroadcast() {
  const now = Date.now();
  const timeSinceLastAdvertising = now - lastAdvertisingTime;
  if (timeSinceLastAdvertising < ADVERTISING_THROTTLE_MS && lastAdvertisingTime !== 0) {
    return { ok: true, throttled: true };
  }
  
  try {
    // Start native Android GATT Server & BLE Advertiser if supported
    const gattRes = await blePeripheral.startGattServer();
    
    // Advertise with node identity for HQ discovery
    const localNodeId = getLocalNodeId();
    const advertisedName = currentRole === NODE_ROLES.HQ ? 'ForBien-HQ' : `ForBien-${localNodeId}`;
    const advRes = await blePeripheral.startAdvertising(advertisedName);
    
    lastAdvertisingTime = Date.now();
    emit('broadcast_started', { 
      serviceUUID: MESH_SERVICE_UUID, 
      nativeGatt: gattRes.ok,
      advertisedName,
      nodeId: localNodeId,
      role: currentRole
    });
    
    return { ok: true, native: advRes.ok, advertisedName };
  } catch (error) {
    console.error('Failed to start broadcast:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Stop broadcasting/advertising
 */
export async function stopBroadcast() {
  try {
    await blePeripheral.stopAdvertising();
    await blePeripheral.stopGattServer();
    emit('broadcast_stopped', {});
    return { ok: true };
  } catch (error) {
    console.error('Failed to stop broadcast:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Handle incoming physical raw BLE data chunk
 * @param {string} rawString - Base64 encoded or string chunk
 * @param {string} senderInfo 
 */
export async function handleIncomingRawBLEData(rawString, senderInfo = 'BLE_Peer') {
  let decodedStr = rawString;
  try {
    if (typeof atob === 'function' && !rawString.startsWith('FRAG|') && !rawString.startsWith('{')) {
      decodedStr = atob(rawString);
    }
  } catch {
    decodedStr = rawString;
  }

  let packet = null;
  if (decodedStr.startsWith('FRAG|')) {
    packet = reassembleFragment(decodedStr);
    if (!packet) {
      // Waiting for remaining fragments
      return { ok: true, pendingFragments: true };
    }
  } else {
    try {
      packet = JSON.parse(decodedStr);
    } catch {
      console.warn('[BLE Inbound Alert] Raw payload non-JSON and non-fragment:', decodedStr.substring(0, 50));
      return { ok: false, error: 'Malformed BLE payload' };
    }
  }

  return await processIncomingPacket(packet, senderInfo);
}

/**
 * Process a reassembled or complete incoming physical mesh packet
 * @param {object} packet 
 * @param {string} senderInfo 
 */
export async function processIncomingPacket(packet, senderInfo = 'BLE_Peer') {
  if (!packet || !packet.id) {
    return { ok: false, error: 'Invalid packet structure' };
  }

  // STEP 0: Handle HQ Authentication Handshake packets
  // These are NOT emergency messages — they are cryptographic identity proofs from the HQ device
  if (packet.type === 'HQ_AUTH_HANDSHAKE') {
    const verifyResult = verifyHQAuthHandshake(packet);
    if (verifyResult.valid) {
      // Record this peer as a cryptographically verified HQ
      authenticatedHQPeers.set(senderInfo, {
        timestamp: Date.now(),
        handshake: packet,
        nodeId: packet.nodeId,
        publicKey: packet.publicKey,
      });
      console.log(`[HQ Auth] Peer ${senderInfo} VERIFIED as Authorized FORBIEN-HQ-01`);
      emit('hq_peer_authenticated', { peerId: senderInfo, nodeId: packet.nodeId, publicKey: packet.publicKey });
    } else {
      console.warn(`[HQ Auth] REJECTED fake HQ claim from peer ${senderInfo}: ${verifyResult.reason}`);
      emit('fake_hq_rejected', { peerId: senderInfo, reason: verifyResult.reason });
    }
    return { ok: verifyResult.valid, hqAuthHandshake: true, verified: verifyResult.valid, reason: verifyResult.reason };
  }

  // STEP 1 & STEP 2: DUPLICATE PROTECTION CHECK
  if (isDuplicateMessage(packet.id)) {
    console.log(`[Mesh Deduplication] Dropping duplicate packet ID: ${packet.id}`);
    emit('duplicate_dropped', { messageId: packet.id });
    return { ok: false, duplicate: true, messageId: packet.id };
  }

  const localId = getLocalNodeId();
  const destId = packet.destinationNodeId || HQ_NODE_ID;
  const isTargetDestination = (localId === destId) || (currentRole === NODE_ROLES.HQ && destId === HQ_NODE_ID);


  // STEP 3: DESTINATION MATCHING & HQ DELIVERY
  if (isTargetDestination) {
    console.log(`[Mesh Delivery] Packet ${packet.id} reached destination node ${localId}!`);

    // Decrypt payload if encrypted
    let decryptedData = null;
    const payloadEnvelope = packet.payload || packet;
    const isEncrypted = packet.encrypted || (payloadEnvelope && (payloadEnvelope.algo === 'AES-256-GCM' || payloadEnvelope.v === 2));

    if (isEncrypted) {
      const decryptRes = await decryptPayloadAESGCM(payloadEnvelope, currentMeshSecret);
      if (decryptRes.legacy) {
        console.warn('[Mesh Security] Legacy XOR packet rejected from incoming stream.');
        return { ok: false, legacy: true, error: 'Legacy XOR dropped' };
      }
      if (!decryptRes.ok) {
        console.warn('[Mesh Security Alert] AES-256-GCM authentication tag failed on incoming packet!');
        return { ok: false, tampered: true, error: decryptRes.error };
      }
      decryptedData = decryptRes.data;
    } else {
      decryptedData = packet.plainData || packet.payload || {};
    }

    // Extract SOS or message text
    let messageText = decryptedData.text || decryptedData.message || '[Encrypted Data]';
    let processedPayload = typeof decryptedData === 'object' ? decryptedData : {};

    if (processedPayload.compressed) {
      try {
        const decompressedData = decompressSOSData(processedPayload.compressed);
        messageText = decompressedData.message || messageText;
        processedPayload = {
          ...processedPayload,
          ...decompressedData,
          decompressed: true,
        };
      } catch (err) {
        console.error('[Decompression Error]', err.message);
      }
    }

    const routeHist = Array.isArray(packet.routeHistory) ? [...packet.routeHistory] : [packet.sourceNodeId || 'NODE-UNKNOWN'];
    if (!routeHist.includes(localId)) {
      routeHist.push(localId);
    }

    const deliveredMessage = {
      id: packet.id,
      groupId: packet.groupId || 'group_sos',
      text: messageText,
      ts: packet.ts || Date.now(),
      from: senderInfo,
      sourceNodeId: packet.sourceNodeId || 'NODE-UNKNOWN',
      destinationNodeId: destId,
      routeHistory: routeHist,
      hopCount: packet.hopCount || 0,
      maxHops: packet.maxHops || 5,
      encrypted: isEncrypted,
      algo: isEncrypted ? 'AES-256-GCM' : undefined,
      compressed: !!processedPayload.compressed,
      decompressed: !!processedPayload.decompressed,
      type: packet.type || processedPayload.type || 'SOS',
      deliveryState: DELIVERY_STATES.DELIVERED_TO_HQ,
      meta: processedPayload,
    };

    // Store delivered message in persistent queue
    storeMessagePersistent(deliveredMessage);
    
    // Save to HQ-specific storage for emergency inbox
    if (currentRole === NODE_ROLES.HQ) {
      const existingHQMessages = await loadHQReceivedMessages();
      const updatedHQMessages = [deliveredMessage, ...existingHQMessages];
      await saveHQReceivedMessages(updatedHQMessages);
    }
    
    emit('hq_delivery', deliveredMessage);
    emit('message', deliveredMessage);
    emit('packet_received', deliveredMessage);

    // CRITICAL: DESTINATION REACHED — DO NOT FORWARD FURTHER! HALT RELAY!
    return { ok: true, delivered: true, message: deliveredMessage };
  }

  // STEP 4: INTERMEDIATE RELAY (destinationNodeId !== localNodeId)
  // Check TTL / Max Hops
  const maxHops = packet.maxHops || 5;
  const currentHopCount = packet.hopCount || 0;

  if (currentHopCount >= maxHops) {
    console.warn(`[Mesh TTL Alert] Max hops reached (${currentHopCount}/${maxHops}) for packet ID: ${packet.id}. Stopping relay.`);
    emit('ttl_exceeded', { messageId: packet.id, hopCount: currentHopCount, maxHops });
    return { ok: false, ttlExceeded: true, messageId: packet.id };
  }

  // DO NOT DECRYPT EMERGENCY PAYLOAD ON INTERMEDIATE RELAY!
  console.log(`[Mesh Relay] Node ${localId} relaying encrypted packet ${packet.id} towards ${destId}...`);

  const currentRoute = Array.isArray(packet.routeHistory) ? [...packet.routeHistory] : [packet.sourceNodeId || 'NODE-UNKNOWN'];
  if (!currentRoute.includes(localId)) {
    currentRoute.push(localId);
  }

  const nextHopCount = currentHopCount + 1;

  const relayedPacket = {
    ...packet,
    sourceNodeId: packet.sourceNodeId || 'NODE-UNKNOWN',
    destinationNodeId: destId,
    routeHistory: currentRoute,
    hopCount: nextHopCount,
    deliveryState: DELIVERY_STATES.RELAYING,
  };

  storeMessagePersistent(relayedPacket);
  emit('packet_received', relayedPacket);

  return relayMessage(relayedPacket);
}

/**
 * Relay a message to other peers by incrementing hop count and pushing to outbound queue.
 * Does NOT decrypt payload while forwarding.
 * @param {object} packet 
 */
export function relayMessage(packet) {
  if (!packet || !packet.id) return { ok: false, error: 'Empty packet' };

  if (packet.payload && isLegacyXORPacket(packet.payload)) {
    return { ok: false, legacy: true, error: 'Legacy XOR rejected' };
  }

  const maxHops = packet.maxHops || 5;
  const currentHop = packet.hopCount || 0;

  if (currentHop >= maxHops) {
    console.log(`[Mesh Relay TTL] Current hop count (${currentHop}) reaches or exceeds maxHops (${maxHops}). Relay halted.`);
    emit('ttl_exceeded', { messageId: packet.id, hopCount: currentHop, maxHops });
    return { ok: false, ttlExceeded: true };
  }

  const isPreIncremented = packet._preIncremented || packet.deliveryState === DELIVERY_STATES.RELAYING;
  const finalHopCount = isPreIncremented ? currentHop : currentHop + 1;

  const relayedPacket = {
    ...packet,
    hopCount: finalHopCount,
    deliveryState: DELIVERY_STATES.RELAYING,
  };

  if (meshEnabled) {
    outboundQueue.push(relayedPacket);
    emit('message_relayed', relayedPacket);
    processOutboundQueue();
  }

  return { ok: true, packet: relayedPacket };
}

/**
 * Process the outbound queue by physically writing packets to available connected BLE peers
 */
export async function processOutboundQueue() {
  if (isProcessingQueue || outboundQueue.length === 0 || !meshEnabled) {
    return;
  }

  isProcessingQueue = true;

  try {
    const manager = initBleManager();

    while (outboundQueue.length > 0) {
      const packet = outboundQueue[0]; // Peek front of queue
      packet.deliveryState = DELIVERY_STATES.CONNECTING;
      emit('delivery_state_change', { packetId: packet.id, state: DELIVERY_STATES.CONNECTING });

      let transmittedToAnyPeer = false;

      // Find available peers to transmit to
      const availablePeers = Array.from(peers.values());

      if (availablePeers.length === 0) {
        console.log(`[BLE Outbound Queue] No physical BLE peers discovered. Keeping packet ${packet.id} queued locally.`);
        packet.deliveryState = DELIVERY_STATES.QUEUED;
        emit('delivery_state_change', { packetId: packet.id, state: DELIVERY_STATES.QUEUED });
        break;
      }

      for (const peer of availablePeers) {
        if (!peer.device) continue;

        try {
          console.log(`[BLE Transport] Connecting to peer ${peer.id}...`);
          const device = peer.device;
          const connectedDevice = await device.connect();
          await connectedDevice.discoverAllServicesAndCharacteristics();

          packet.deliveryState = DELIVERY_STATES.TRANSMITTING;
          emit('delivery_state_change', { packetId: packet.id, state: DELIVERY_STATES.TRANSMITTING });

          // Fragment packet into MTU-safe BLE chunks
          const fragments = fragmentPacket(packet);
          console.log(`[BLE Transport] Transmitting packet ${packet.id} in ${fragments.length} fragment(s) to ${peer.id}...`);

          for (const frag of fragments) {
            let base64Payload = '';
            if (typeof btoa === 'function') {
              base64Payload = btoa(unescape(encodeURIComponent(frag)));
            } else {
              base64Payload = Buffer.from(frag, 'utf-8').toString('base64');
            }

            // Execute real physical write operation
            await connectedDevice.writeCharacteristicWithResponseForService(
              MESH_SERVICE_UUID,
              MESH_CHARACTERISTIC_UUID,
              base64Payload
            );
          }

          transmittedToAnyPeer = true;
          packet.deliveryState = DELIVERY_STATES.TRANSMITTED;
          emit('delivery_state_change', { packetId: packet.id, state: DELIVERY_STATES.TRANSMITTED });
          console.log(`[BLE Transport] Successfully transmitted packet ${packet.id} to peer ${peer.id}!`);

        } catch (writeErr) {
          console.warn(`[BLE Write Error] Failed write to peer ${peer.id}:`, writeErr.message);
          // STEP 9: CONNECTION FAILURE RECOVERY - Packet stays queued locally for another attempt
        }
      }

      if (transmittedToAnyPeer) {
        // Shift item out of queue only after physical BLE write succeeds
        outboundQueue.shift();
        await saveQueuesToStorage();
      } else {
        // Could not transmit to any peer, pause worker loop and keep in QUEUED state
        packet.deliveryState = DELIVERY_STATES.FAILED;
        emit('delivery_state_change', { packetId: packet.id, state: DELIVERY_STATES.FAILED });
        break;
      }
    }
  } catch (err) {
    console.error('[Outbound Queue Worker Error]', err.message);
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Enable mesh networking with BLE scanning, GATT Server advertising, and inbound write handlers
 */
export async function enableMesh() {
  const manager = initBleManager();
  
  try {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      return { ok: false, error: 'Bluetooth not powered on' };
    }

    meshEnabled = true;

    // Attach native GATT write listener for inbound BLE packets
    if (!nativeWriteUnsub) {
      nativeWriteUnsub = blePeripheral.onIncomingWrite((event) => {
        if (event && event.dataBase64) {
          handleIncomingRawBLEData(event.dataBase64, event.deviceName || event.deviceId);
        }
      });
    }

    // Attach native central connection listener
    if (!nativeCentralConnUnsub) {
      nativeCentralConnUnsub = blePeripheral.onCentralConnected((event) => {
        emit('peer_connected', event);
      });
    }

    const [scanResult, broadcastResult] = await Promise.all([
      startScan(),
      startBroadcast(),
    ]);

    if (!scanResult.ok) {
      meshEnabled = false;
      return { ok: false, error: `Scan failed: ${scanResult.error}` };
    }

    emit('mesh_state', { enabled: true, peers: peers.size });
    return { ok: true, peers: Array.from(peers.values()) };
  } catch (error) {
    console.error('Failed to enable mesh:', error);
    meshEnabled = false;
    return { ok: false, error: error.message };
  }
}

/**
 * Disable mesh networking and cleanup subscriptions
 */
export async function disableMesh() {
  meshEnabled = false;
  
  try {
    if (nativeWriteUnsub) {
      nativeWriteUnsub();
      nativeWriteUnsub = null;
    }
    if (nativeCentralConnUnsub) {
      nativeCentralConnUnsub();
      nativeCentralConnUnsub = null;
    }

    await Promise.all([
      stopScan(),
      stopBroadcast(),
    ]);
    
    peers.clear();
    emit('mesh_state', { enabled: false, peers: 0, persistentMessages: persistentMessageQueue.size });
    return { ok: true };
  } catch (error) {
    console.error('Failed to disable mesh:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Get current mesh status
 */
export function getMeshStatus() {
  return {
    enabled: meshEnabled,
    nodeId: getLocalNodeId(),
    nodeRole: getNodeRole(),
    peers: Array.from(peers.values()),
    queued: outboundQueue.length,
    persistentMessages: persistentMessageQueue.size,
    processedDuplicatesCount: processedMessageIds.size,
    authorizedHQs: Array.from(AUTHORIZED_HQ_UUIDS),
  };
}

/**
 * Send message to a group via mesh
 * @param {string} groupId
 * @param {{ text?: string, type?: string, meta?: object }} payload
 */
export async function sendToGroup(groupId, payload) {
  let processedPayload = { ...payload };
  let isEncrypted = false;
  let envelope = null;
  
  if (meshEnabled) {
    if (payload.type === 'SOS' || payload.text?.toLowerCase().includes('sos')) {
      const sosData = {
        type: payload.type || 'SOS',
        message: payload.text,
        location: payload.meta?.location,
        latitude: payload.meta?.latitude,
        longitude: payload.meta?.longitude,
        status: payload.meta?.status,
        priority: payload.meta?.priority,
        timestamp: Date.now(),
        unitId: payload.meta?.unitId,
      };
      
      const compressedStr = compressSOSData(sosData);
      processedPayload = { compressed: compressedStr };
    }
    
    const encryptRes = await encryptPayloadAESGCM(processedPayload, currentMeshSecret);
    if (encryptRes.ok) {
      envelope = encryptRes.envelope;
      isEncrypted = true;
    }
  }

  const messageId = `m_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const originNodeId = getLocalNodeId();
  const entry = {
    id: messageId,
    groupId,
    sourceNodeId: originNodeId,
    destinationNodeId: payload.destinationNodeId || HQ_NODE_ID,
    routeHistory: [originNodeId],
    payload: isEncrypted ? envelope : processedPayload,
    plainPayload: processedPayload,
    ts: Date.now(),
    mode: meshEnabled ? 'mesh' : 'internet',
    hopCount: 0,
    maxHops: 5,
    deliveryState: DELIVERY_STATES.CREATED,
    encrypted: isEncrypted,
    algo: isEncrypted ? 'AES-256-GCM' : undefined,
  };
  
  if (meshEnabled) {
    entry.deliveryState = DELIVERY_STATES.QUEUED;
    outboundQueue.push(entry);
    storeMessagePersistent(entry);
    await saveQueuesToStorage();
    emit('sent_mesh', entry);
    processOutboundQueue();
  } else {
    emit('sent_internet', entry);
  }
  
  return { ok: true, entry };
}

/**
 * Connect to a specific peer device
 * @param {string} peerId 
 */
export async function connectToPeer(peerId) {
  const manager = initBleManager();
  const peer = peers.get(peerId);
  
  if (!peer || !peer.device) {
    return { ok: false, error: 'Peer not found' };
  }

  try {
    const device = peer.device;
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();
    
    emit('peer_connected', { peerId });
    return { ok: true, device: connected };
  } catch (error) {
    console.error('Failed to connect to peer:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Disconnect from a peer device
 * @param {string} peerId
 */
export async function disconnectFromPeer(peerId) {
  const peer = peers.get(peerId);
  if (!peer || !peer.device) {
    return { ok: false, error: 'Peer not found' };
  }

  try {
    await peer.device.cancelConnection();
    emit('peer_disconnected', { peerId });
    return { ok: true };
  } catch (error) {
    console.error('Failed to disconnect from peer:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Drain the outbound queue
 */
export function drainOutboundQueue() {
  const q = [...outboundQueue];
  outboundQueue.length = 0;
  return q;
}

/**
 * Process a clearance packet from authorized HQ.
 */
export async function processClearancePacket(clearancePacketInput) {
  let clearancePacket = clearancePacketInput;

  const isEncryptedEnvelope = clearancePacketInput && (
    clearancePacketInput.v === 2 ||
    clearancePacketInput.algo === 'AES-256-GCM' ||
    typeof clearancePacketInput === 'string' ||
    (clearancePacketInput.iv && clearancePacketInput.ct)
  );

  if (isEncryptedEnvelope) {
    const decryptRes = await decryptPayloadAESGCM(clearancePacketInput, currentMeshSecret);
    if (!decryptRes.ok) {
      return { ok: false, error: `HQ clearance integrity check failed: ${decryptRes.error}` };
    }
    clearancePacket = decryptRes.data;
  }

  if (!clearancePacket || !clearancePacket.messageId || !AUTHORIZED_HQ_UUIDS.has(clearancePacket.hqUuid)) {
    return { ok: false, error: 'Unauthorized HQ clearance signature' };
  }

  const { messageId } = clearancePacket;

  if (!persistentMessageQueue.has(messageId)) {
    return { ok: false, error: 'Message not found in persistent queue', clearedMessageId: messageId };
  }

  const clearedMessage = persistentMessageQueue.get(messageId);
  persistentMessageQueue.delete(messageId);

  emit('message_cleared', { messageId, hqUuid: clearancePacket.hqUuid, clearedMessage });

  return { ok: true, clearedMessageId: messageId, clearedMessage };
}

/**
 * Store message in persistent queue
 */
export function storeMessagePersistent(message) {
  if (!message || !message.id) return false;
  persistentMessageQueue.set(message.id, {
    ...message,
    storedAt: Date.now(),
    cleared: false,
  });
  return true;
}

const QUEUE_STORAGE_KEY = 'forbien_outbound_queue';
const PERSISTENT_STORAGE_KEY = 'forbien_persistent_queue';
const HQ_RECEIVED_MESSAGES_KEY = 'forbien_hq_received_messages';

export async function saveQueuesToStorage() {
  try {
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(outboundQueue));
    const persistentArray = Array.from(persistentMessageQueue.entries());
    await AsyncStorage.setItem(PERSISTENT_STORAGE_KEY, JSON.stringify(persistentArray));
  } catch (err) {
    console.error('Failed to save queues to AsyncStorage:', err);
  }
}

export async function loadQueuesFromStorage() {
  try {
    const rawOutbound = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (rawOutbound) {
      const parsed = JSON.parse(rawOutbound);
      outboundQueue.length = 0;
      outboundQueue.push(...parsed);
    }
    const rawPersistent = await AsyncStorage.getItem(PERSISTENT_STORAGE_KEY);
    if (rawPersistent) {
      const parsed = JSON.parse(rawPersistent);
      persistentMessageQueue.clear();
      parsed.forEach(([k, v]) => persistentMessageQueue.set(k, v));
    }
  } catch (err) {
    console.error('Failed to load queues from AsyncStorage:', err);
  }
}

/**
 * Save HQ received emergency messages to AsyncStorage
 * @param {Array} messages - Array of emergency messages received at HQ
 */
export async function saveHQReceivedMessages(messages) {
  try {
    await AsyncStorage.setItem(HQ_RECEIVED_MESSAGES_KEY, JSON.stringify(messages));
  } catch (err) {
    console.error('Failed to save HQ received messages:', err);
  }
}

/**
 * Load HQ received emergency messages from AsyncStorage
 * @returns {Promise<Array>} Array of emergency messages received at HQ
 */
export async function loadHQReceivedMessages() {
  try {
    const rawMessages = await AsyncStorage.getItem(HQ_RECEIVED_MESSAGES_KEY);
    if (rawMessages) {
      return JSON.parse(rawMessages);
    }
    return [];
  } catch (err) {
    console.error('Failed to load HQ received messages:', err);
    return [];
  }
}

/**
 * Create a 100% offline emergency SOS message with local GPS, AES-256-GCM encryption, finite TTL, and BLE queuing.
 * @param {object} options - { level?: string, message?: string, location?: object }
 * @returns {Promise<object>} Result containing created mesh packet
 */
export async function createOfflineEmergencyMessage(options = {}) {
  const { level = 'national', message = 'EMERGENCY SOS BROADCAST', location: providedLocation } = options;
  const messageId = `sos_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const timestamp = Date.now();
  
  let locationData = { latitude: 0, longitude: 0, accuracy: null, timestamp, available: false };
  
  // Use provided location if available, otherwise try to get GPS
  if (providedLocation && providedLocation.latitude !== undefined && providedLocation.longitude !== undefined) {
    locationData = {
      latitude: providedLocation.latitude,
      longitude: providedLocation.longitude,
      altitude: providedLocation.altitude,
      accuracy: providedLocation.accuracy,
      timestamp: providedLocation.timestamp || timestamp,
      available: true,
    };
  } else {
    try {
      if (Location && Location.getForegroundPermissionsAsync) {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (pos && pos.coords) {
            locationData = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              altitude: pos.coords.altitude,
              accuracy: pos.coords.accuracy,
              timestamp: pos.timestamp || timestamp,
              available: true,
            };
          }
        } else {
          console.warn('[Location] Permission not granted for GPS');
        }
      } else {
        console.warn('[Location] expo-location not available');
      }
    } catch (err) {
      console.warn('[Location] GPS capture failed:', err.message);
    }
  }

  const originNodeId = getLocalNodeId();

  const sosData = {
    id: messageId,
    type: 'SOS',
    priority: level,
    message: message,
    latitude: locationData.latitude,
    longitude: locationData.longitude,
    location: locationData.available 
      ? `GPS (${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)})`
      : 'Location Unavailable',
    locationAvailable: locationData.available,
    status: 'critical',
    timestamp,
    unitId: originNodeId,
  };

  let compressedStr;
  try {
    compressedStr = compressSOSData(sosData);
  } catch (compressErr) {
    console.error('[Compression] Failed to compress SOS data:', compressErr.message);
    compressedStr = JSON.stringify(sosData);
  }

  let envelope = null;
  try {
    const encryptRes = await encryptPayloadAESGCM({ compressed: compressedStr }, currentMeshSecret);
    if (encryptRes.ok) {
      envelope = encryptRes.envelope;
    } else {
      console.error('[Encryption] Failed to encrypt emergency payload:', encryptRes.error);
    }
  } catch (encryptErr) {
    console.error('[Encryption] Encryption error:', encryptErr.message);
  }

  const packet = {
    id: messageId,
    type: 'SOS',
    sourceNodeId: originNodeId,
    destinationNodeId: HQ_NODE_ID,
    routeHistory: [originNodeId],
    priority: level,
    payload: envelope || { compressed: compressedStr },
    plainData: sosData,
    hopCount: 0,
    maxHops: 5,
    deliveryState: DELIVERY_STATES.CREATED,
    ts: timestamp,
    encrypted: !!envelope,
    algo: envelope ? 'AES-256-GCM' : undefined,
  };

  packet.deliveryState = DELIVERY_STATES.QUEUED;
  outboundQueue.push(packet);
  storeMessagePersistent(packet);

  try {
    await saveQueuesToStorage();
  } catch (storageErr) {
    console.error('[Storage] Failed to save emergency to AsyncStorage:', storageErr.message);
  }

  emit('sent_mesh', packet);
  emit('emergency_created', packet);

  // Trigger physical BLE transmission
  if (meshEnabled) {
    processOutboundQueue();
  } else {
    console.warn('[Mesh] Mesh not enabled, emergency queued locally');
    emit('mesh_not_enabled', { packetId: packet.id });
  }

  return { ok: true, packet };
}

export function getPersistentMessages() {
  return Array.from(persistentMessageQueue.values());
}

export function clearMessageViaClearance(messageId, hqUuid, signature) {
  return processClearancePacket({ messageId, hqUuid, signature });
}

export function addAuthorizedHQ(uuid) {
  AUTHORIZED_HQ_UUIDS.add(uuid);
  emit('hq_authorized', { uuid });
}

export function removeAuthorizedHQ(uuid) {
  AUTHORIZED_HQ_UUIDS.delete(uuid);
  emit('hq_unauthorized', { uuid });
}

export function getAuthorizedHQs() {
  return Array.from(AUTHORIZED_HQ_UUIDS);
}

export function onPeerEvent(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * =======================================================================
 * DEVELOPMENT / DEMO ONLY (Isolated from production physical BLE path)
 * =======================================================================
 * Process and receive simulated incoming peer packet for local testing.
 * MUST NOT be invoked by real BLE runtime paths.
 */
export async function simulateIncomingPeerMessage(groupId, text, hopCount = 0, encrypted = false, isHQNode = false, payload = null) {
  console.log('[DEVELOPMENT / DEMO ONLY] Invoking simulateIncomingPeerMessage');
  let rawPacket = payload || text;
  let decryptedData = null;
  let isEncrypted = encrypted || (rawPacket && (rawPacket.algo === 'AES-256-GCM' || rawPacket.v === 2 || isLegacyXORPacket(rawPacket)));
  
  if (isEncrypted && meshEnabled) {
    const decryptRes = await decryptPayloadAESGCM(rawPacket, currentMeshSecret);
    if (decryptRes.legacy) {
      return { ok: false, legacy: true, error: 'Legacy XOR packet dropped' };
    }
    if (!decryptRes.ok) {
      return { ok: false, tampered: true, error: decryptRes.error };
    }
    decryptedData = decryptRes.data;
  } else {
    decryptedData = typeof rawPacket === 'object' ? rawPacket : { text: String(rawPacket) };
  }

  let processedText = decryptedData.text || (typeof decryptedData === 'string' ? decryptedData : text);
  let processedPayload = typeof decryptedData === 'object' ? decryptedData : {};
  
  if (isHQNode && processedPayload.compressed) {
    try {
      const decompressedData = decompressSOSData(processedPayload.compressed);
      processedText = decompressedData.message || processedText;
      processedPayload = {
        ...processedPayload,
        ...decompressedData,
        decompressed: true,
      };
    } catch (error) {
      console.error('SOS decompression error:', error);
    }
  }

  const messageId = rawPacket?.id || `rx_sim_${Date.now()}`;

  // Run duplicate check
  if (isDuplicateMessage(messageId)) {
    return { ok: false, duplicate: true, error: 'Duplicate message dropped' };
  }

  const message = {
    id: messageId,
    groupId, 
    text: processedText, 
    ts: Date.now(), 
    from: 'simulated_peer', 
    hopCount,
    maxHops: 5,
    encrypted: true,
    algo: 'AES-256-GCM',
    compressed: processedPayload.compressed || false,
    decompressed: processedPayload.decompressed || false,
    type: processedPayload.type || 'regular',
    deliveryState: DELIVERY_STATES.RECEIVED,
    meta: processedPayload,
  };

  storeMessagePersistent(message);
  emit('message', message);
  return { ok: true, message };
}
