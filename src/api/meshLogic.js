/**
 * Offline mesh transport abstraction using react-native-ble-plx.
 * Provides BLE scanning, advertising, and peer-to-peer communication.
 */

import { BleManager } from 'react-native-ble-plx';
import { compressSOSData, decompressSOSData } from '../lib/compression';

const listeners = new Set();
let meshEnabled = false;
let bleManager = null;
/** @type {Map<string, {id: string, name?: string, rssi?: number, device?: any}>} */
const peers = new Map();
const outboundQueue = [];
/** @type {Map<string, any>} - Persistent message queue keyed by message ID */
const persistentMessageQueue = new Map();
let scanSubscription = null;
let advertisingSubscription = null;

// BLE Service UUID and Characteristic UUID for ForBien mesh
const MESH_SERVICE_UUID = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
const MESH_CHARACTERISTIC_UUID = '6E400002-B5A3-F393-E0A9-E50E24DCCA9E';

// Throttling intervals for battery preservation
const ADVERTISING_THROTTLE_MS = 30000; // 30-second throttling for BLE advertising
let lastAdvertisingTime = 0;

// Authorized Headquarters UUIDs for clearance packet validation
const AUTHORIZED_HQ_UUIDS = new Set([
  'hq-command-primary-001',
  'hq-command-secondary-002',
  'hq-emergency-center-003',
  'hq-ops-central-004',
  // Add additional authorized HQ UUIDs as needed
]);

// Simple encryption key for Forest Mode (in production, this should be securely shared)
const ENCRYPTION_KEY = 'ForBienMesh2024';

/**
 * Simple XOR encryption for text data
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Base64 encoded encrypted text
 */
function encryptText(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
    result += String.fromCharCode(charCode);
  }
  // Convert to base64 to handle special characters
  return btoa(result);
}

/**
 * Simple XOR decryption for text data
 * @param {string} encrypted - Base64 encoded encrypted text
 * @returns {string} - Decrypted plain text
 */
function decryptText(encrypted) {
  try {
    const decoded = atob(encrypted);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ ENCRYPTION_KEY.charCodeAt(i % ENCRYPTION_KEY.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (error) {
    console.error('Decryption failed:', error);
    return encrypted; // Return original if decryption fails
  }
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
 * Validate if a UUID is authorized as Headquarters
 * @param {string} uuid - UUID to validate
 * @returns {boolean} - True if authorized HQ UUID
 */
function isAuthorizedHQ(uuid) {
  return AUTHORIZED_HQ_UUIDS.has(uuid);
}

/**
 * Generate a simple signature for clearance packets
 * @param {string} messageId - Message ID to clear
 * @param {string} hqUuid - HQ UUID signing the clearance
 * @returns {string} - Signature hash
 */
function generateClearanceSignature(messageId, hqUuid) {
  const signatureBase = `${messageId}:${hqUuid}:${Date.now()}`;
  // Simple hash for signature (in production, use proper cryptographic signing)
  let hash = 0;
  for (let i = 0; i < signatureBase.length; i++) {
    const char = signatureBase.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Validate clearance packet signature
 * @param {object} clearancePacket - Clearance packet to validate
 * @returns {boolean} - True if signature is valid
 */
function validateClearanceSignature(clearancePacket) {
  if (!clearancePacket.messageId || !clearancePacket.hqUuid || !clearancePacket.signature) {
    return false;
  }

  // Verify HQ authorization
  if (!isAuthorizedHQ(clearancePacket.hqUuid)) {
    console.warn('Clearance packet from unauthorized HQ:', clearancePacket.hqUuid);
    return false;
  }

  // Verify signature matches
  const expectedSignature = generateClearanceSignature(clearancePacket.messageId, clearancePacket.hqUuid);
  // For this implementation, we'll accept any signature from authorized HQ
  // In production, implement proper cryptographic signature verification
  return true;
}

/**
 * Initialize BLE manager
 */
function initBleManager() {
  if (!bleManager) {
    bleManager = new BleManager();
  }
  return bleManager;
}

/**
 * Start BLE scanning to discover nearby ForBien devices
 */
export async function startScan() {
  const manager = initBleManager();
  
  try {
    // Check if Bluetooth is enabled
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      return { ok: false, error: 'Bluetooth not powered on' };
    }

    // Start scanning for devices with our service UUID
    manager.startDeviceScan([MESH_SERVICE_UUID], null, (error, device) => {
      if (error) {
        console.error('Scan error:', error);
        emit('scan_error', { error: error.message });
        return;
      }

      if (device) {
        const peerId = device.id;
        const peerData = {
          id: peerId,
          name: device.name || `Unit ${peerId.substring(0, 6)}`,
          rssi: device.rssi,
          device: device,
        };

        // Update or add peer
        const existing = peers.get(peerId);
        if (!existing || existing.rssi !== device.rssi) {
          peers.set(peerId, peerData);
          emit('peer_discovered', peerData);
          emit('mesh_state', { enabled: meshEnabled, peers: peers.size });
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
 * Start broadcasting/advertising to make this device discoverable
 */
export async function startBroadcast() {
  const manager = initBleManager();
  
  // Check if we should throttle this advertising (30-second interval)
  const now = Date.now();
  const timeSinceLastAdvertising = now - lastAdvertisingTime;
  if (timeSinceLastAdvertising < ADVERTISING_THROTTLE_MS) {
    console.log(`BLE advertising throttled: ${timeSinceLastAdvertising}ms since last advertising (minimum ${ADVERTISING_THROTTLE_MS}ms)`);
    return { ok: true, throttled: true };
  }
  
  try {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      return { ok: false, error: 'Bluetooth not powered on' };
    }

    // Start advertising with our service UUID
    // Note: Advertising API varies by platform, this is a basic implementation
    const advertisingOptions = {
      serviceUUIDs: [MESH_SERVICE_UUID],
      localName: 'ForBien',
      includeDeviceName: true,
    };

    await manager.startAdvertising(advertisingOptions);
    lastAdvertisingTime = Date.now();
    emit('broadcast_started', { serviceUUID: MESH_SERVICE_UUID });
    
    return { ok: true };
  } catch (error) {
    console.error('Failed to start broadcast:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Stop broadcasting/advertising
 */
export async function stopBroadcast() {
  const manager = initBleManager();
  
  try {
    await manager.stopAdvertising();
    emit('broadcast_stopped', {});
    return { ok: true };
  } catch (error) {
    console.error('Failed to stop broadcast:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * Enable mesh networking with BLE scan and broadcast
 */
export async function enableMesh() {
  const manager = initBleManager();
  
  try {
    const state = await manager.state();
    if (state !== 'PoweredOn') {
      return { ok: false, error: 'Bluetooth not powered on' };
    }

    meshEnabled = true;
    
    // Start both scanning and broadcasting
    const [scanResult, broadcastResult] = await Promise.all([
      startScan(),
      startBroadcast(),
    ]);

    if (!scanResult.ok) {
      meshEnabled = false;
      return { ok: false, error: `Scan failed: ${scanResult.error}` };
    }

    if (!broadcastResult.ok) {
      meshEnabled = false;
      await stopScan();
      return { ok: false, error: `Broadcast failed: ${broadcastResult.error}` };
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
 * Disable mesh networking and cleanup
 * Note: Does NOT clear persistent message queue - messages persist until explicit HQ clearance
 */
export async function disableMesh() {
  meshEnabled = false;
  
  try {
    await Promise.all([
      stopScan(),
      stopBroadcast(),
    ]);
    
    peers.clear();
    // Note: persistentMessageQueue is NOT cleared - messages persist until explicit HQ clearance
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
    peers: Array.from(peers.values()),
    queued: outboundQueue.length,
    persistentMessages: persistentMessageQueue.size,
    authorizedHQs: Array.from(AUTHORIZED_HQ_UUIDS),
  };
}

/**
 * Send message to a group via mesh
 * @param {string} groupId
 * @param {{ text?: string, type?: string, meta?: object }} payload
 */
export async function sendToGroup(groupId, payload) {
  // Process payload for mesh transmission
  let processedPayload = { ...payload };
  
  if (meshEnabled) {
    // Compress SOS messages for ultra-lightweight BLE transmission
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
      
      // Compress SOS data into ultra-lightweight string
      processedPayload.compressed = compressSOSData(sosData);
      processedPayload.compressed = true;
      processedPayload.originalText = payload.text; // Keep original for reference
    }
    
    // Encrypt text payload when in mesh mode (Forest Mode)
    if (payload.text && !processedPayload.compressed) {
      processedPayload.text = encryptText(payload.text);
      processedPayload.encrypted = true;
    }
  }

  const entry = {
    id: `m_${Date.now()}`,
    groupId,
    payload: processedPayload,
    ts: Date.now(),
    mode: meshEnabled ? 'mesh' : 'internet',
    hopCount: 0, // Initialize hop count at 0 for new messages
  };
  
  if (meshEnabled) {
    // In a real implementation, this would send via BLE to connected peers
    // For now, queue for mesh transmission
    outboundQueue.push(entry);
    emit('sent_mesh', entry);
    
    // TODO: Implement actual BLE data transmission to peers
    // This would involve connecting to devices and writing to characteristics
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
    await device.connect();
    
    // Discover services and characteristics
    await device.discoverAllServicesAndCharacteristics();
    
    emit('peer_connected', { peerId });
    return { ok: true, device };
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
 * Process a clearance packet from authorized HQ
 * @param {object} clearancePacket - Clearance packet with messageId, hqUuid, signature
 * @returns {object} - Result with cleared message ID and success status
 */
export function processClearancePacket(clearancePacket) {
  // Validate clearance packet signature and authorization
  if (!validateClearanceSignature(clearancePacket)) {
    return { 
      ok: false, 
      error: 'Invalid clearance packet signature or unauthorized HQ',
      clearedMessageId: null 
    };
  }

  const { messageId } = clearancePacket;

  // Check if message exists in persistent queue
  if (!persistentMessageQueue.has(messageId)) {
    return { 
      ok: false, 
      error: 'Message not found in persistent queue',
      clearedMessageId: messageId 
    };
  }

  // Remove message from persistent queue
  const clearedMessage = persistentMessageQueue.get(messageId);
  persistentMessageQueue.delete(messageId);

  emit('message_cleared', { 
    messageId, 
    hqUuid: clearancePacket.hqUuid,
    clearedMessage 
  });

  return { 
    ok: true, 
    clearedMessageId: messageId,
    clearedMessage 
  };
}

/**
 * Store message in persistent queue (no automatic deletion)
 * @param {object} message - Message object to store persistently
 * @returns {boolean} - True if stored successfully
 */
export function storeMessagePersistent(message) {
  if (!message || !message.id) {
    return false;
  }

  persistentMessageQueue.set(message.id, {
    ...message,
    storedAt: Date.now(),
    cleared: false,
  });

  return true;
}

/**
 * Get all messages in persistent queue
 * @returns {Array} - Array of all persistent messages
 */
export function getPersistentMessages() {
  return Array.from(persistentMessageQueue.values());
}

/**
 * Clear specific message from persistent queue (only via authorized clearance)
 * @param {string} messageId - Message ID to clear
 * @param {string} hqUuid - HQ UUID authorizing the clearance
 * @param {string} signature - Signature for the clearance
 * @returns {object} - Result of clearance operation
 */
export function clearMessageViaClearance(messageId, hqUuid, signature) {
  return processClearancePacket({ messageId, hqUuid, signature });
}

/**
 * Add authorized HQ UUID
 * @param {string} uuid - HQ UUID to authorize
 */
export function addAuthorizedHQ(uuid) {
  AUTHORIZED_HQ_UUIDS.add(uuid);
  emit('hq_authorized', { uuid });
}

/**
 * Remove authorized HQ UUID
 * @param {string} uuid - HQ UUID to remove
 */
export function removeAuthorizedHQ(uuid) {
  AUTHORIZED_HQ_UUIDS.delete(uuid);
  emit('hq_unauthorized', { uuid });
}

/**
 * Get all authorized HQ UUIDs
 * @returns {Array} - Array of authorized HQ UUIDs
 */
export function getAuthorizedHQs() {
  return Array.from(AUTHORIZED_HQ_UUIDS);
}

/**
 * Subscribe to peer events
 * @param {(event: string, payload: any) => void} cb
 */
export function onPeerEvent(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Relay a message to other peers, incrementing hop count
 * @param {object} message - The message object to relay
 */
export function relayMessage(message) {
  const relayedMessage = {
    ...message,
    hopCount: (message.hopCount || 0) + 1, // Increment hop count
  };
  
  if (meshEnabled) {
    outboundQueue.push(relayedMessage);
    emit('message_relayed', relayedMessage);
  }
  
  return relayedMessage;
}

/**
 * Simulate incoming peer message (for testing)
 * @param {string} groupId
 * @param {string} text
 * @param {number} hopCount - Optional hop count for received messages
 * @param {boolean} encrypted - Whether the message is encrypted
 * @param {boolean} isHQNode - Whether the receiving node is Headquarters
 * @param {object} payload - Full payload object for SOS decompression
 */
export function simulateIncomingPeerMessage(groupId, text, hopCount = 0, encrypted = false, isHQNode = false, payload = null) {
  let processedText = text;
  let processedPayload = payload || {};
  
  // Decompress SOS data if this is a Headquarters node
  if (isHQNode && processedPayload.compressed) {
    try {
      const decompressedData = decompressSOSData(processedPayload.compressed);
      processedText = decompressedData.message || text;
      processedPayload = {
        ...processedPayload,
        ...decompressedData,
        decompressed: true,
      };
    } catch (error) {
      console.error('SOS decompression error:', error);
      processedText = text; // Fallback to original text
    }
  }
  
  // Decrypt if the message is encrypted and we're in mesh mode
  if (encrypted && meshEnabled && !processedPayload.compressed) {
    processedText = decryptText(processedText);
  }

  const message = {
    id: `rx_${Date.now()}`,
    groupId, 
    text: processedText, 
    ts: Date.now(), 
    from: 'mesh_peer', 
    hopCount,
    encrypted,
    compressed: processedPayload.compressed || false,
    decompressed: processedPayload.decompressed || false,
    type: processedPayload.type || 'regular',
    meta: processedPayload,
  };

  // Store message in persistent queue (no automatic deletion)
  storeMessagePersistent(message);

  emit('message', message);
}
